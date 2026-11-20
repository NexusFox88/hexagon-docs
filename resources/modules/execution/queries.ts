import type pg from 'pg';
import {z} from 'zod';
export const listQuery=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0),search:z.string().max(200).default(''),state:z.string().max(40).default('')});
/** Read models expose separate execution/resource states, always scoped by tenant. */
export class ExecutionQueries {
 constructor(private pool:pg.Pool){}
 async list(tenant:string,kind:'sessions'|'runs',input:unknown){
  const q=listQuery.parse(input),table=kind==='sessions'?'sessions':'runs';
  const fields=kind==='sessions'?'s.id,s.agent_id,s.agent_revision,s.definition,s.env_names,s.state,s.sandbox,s.created_at,s.updated_at,s.definition->\'harness\' AS harness,rt.state AS runtime_state,latest.run AS latest_run':"s.id,s.session_id,s.state,s.created_at,s.updated_at,s.error,left(s.input,240) AS input_preview,ss.definition->>'name' AS agent_name";
  const join=kind==='sessions'?"LEFT JOIN session_runtimes rt ON rt.tenant_id=s.tenant_id AND rt.session_id=s.id LEFT JOIN LATERAL (SELECT json_build_object('id',r.id,'state',r.state,'input_preview',left(r.input,240)) AS run FROM runs r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) latest ON true":'JOIN sessions ss ON ss.tenant_id=s.tenant_id AND ss.id=s.session_id';
  const rows=(await this.pool.query(`SELECT ${fields} FROM ${table} s ${join} WHERE s.tenant_id=$1 AND ($2='' OR s.state=$2) AND ($3='' OR strpos(lower(s.id),lower($3))>0 ${kind==='runs'?"OR strpos(lower(s.session_id),lower($3))>0 OR strpos(lower(s.input),lower($3))>0 OR strpos(lower(ss.definition->>'name'),lower($3))>0":"OR strpos(lower(s.agent_id),lower($3))>0 OR strpos(lower(s.definition->>'name'),lower($3))>0"}) ORDER BY s.created_at DESC,s.id DESC LIMIT $4 OFFSET $5`,[tenant,q.state,q.search,q.limit+1,q.offset])).rows;
  return {[kind]:rows.slice(0,q.limit),next_offset:rows.length>q.limit?q.offset+q.limit:null,offset:q.offset};
 }
 async activity(tenant:string,period:'24h'|'7d'){
  const hours=period==='7d'?168:24,step=period==='7d'?24:1;
  const stats=(await this.pool.query(`SELECT
    count(*) FILTER (WHERE s.state IN ('open','paused','pausing','resuming') AND EXISTS(SELECT 1 FROM runs r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id AND r.state NOT IN ('completed','failed','cancelled')))::int AS active_sessions,
    count(*) FILTER (WHERE s.state='open' AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id AND r.state NOT IN ('completed','failed','cancelled')))::int AS idle_sessions,
    count(*) FILTER (WHERE s.state='paused')::int AS paused_sessions
    FROM sessions s WHERE s.tenant_id=$1`,[tenant])).rows[0];
  const buckets=(await this.pool.query(`WITH bins AS (
    SELECT b AS start,b+make_interval(hours=>$3::int) AS finish FROM generate_series(
      now()-make_interval(hours=>$2::int),now()-make_interval(hours=>$3::int),make_interval(hours=>$3::int)) b)
    SELECT start, count(DISTINCT r.session_id)::int AS active_sessions FROM bins
    LEFT JOIN runs r ON r.tenant_id=$1 AND r.created_at<bins.finish AND
      (CASE WHEN r.state IN ('completed','failed','cancelled') THEN r.updated_at ELSE now() END)>=bins.start
    GROUP BY start ORDER BY start`,[tenant,hours,step])).rows;
  return {...stats,period,buckets,checked_at:new Date().toISOString()};
 }
 async overview(tenant:string){
  const result=await this.pool.query(`SELECT
   (SELECT count(*)::int FROM connections WHERE tenant_id=$1 AND deleted_at IS NULL AND enabled AND status='ready') AS ready_connections,
   (SELECT count(*)::int FROM sessions WHERE tenant_id=$1 AND state='open') AS open_sessions,
   (SELECT count(*)::int FROM runs WHERE tenant_id=$1 AND state NOT IN ('completed','failed','cancelled')) AS active_runs,
   (SELECT count(*)::int FROM approvals WHERE tenant_id=$1 AND state='pending') AS pending_approvals,
   (SELECT count(*)::int FROM tool_calls WHERE tenant_id=$1 AND state='waiting_authorization') AS pending_authorizations,
   (SELECT count(*)::int FROM resource_operations WHERE tenant_id=$1 AND state='unknown') AS unknown_operations,
   (SELECT count(*)::int FROM agents WHERE tenant_id=$1 AND archived_at IS NULL) AS active_agents`,[tenant]);
  return {...result.rows[0],checked_at:new Date().toISOString()};
 }
 async pending(tenant:string,input:unknown){
  const q=listQuery.parse(input);
  const rows=(await this.pool.query(`SELECT * FROM (
   SELECT a.id,'approval' AS kind,a.state,r.session_id,a.run_id,a.created_at FROM approvals a JOIN runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE a.tenant_id=$1 AND a.state='pending'
   UNION ALL SELECT c.id,CASE WHEN c.state='unknown' THEN 'tool_outcome' ELSE 'authorization' END,c.state,r.session_id,c.run_id,c.created_at FROM tool_calls c JOIN runs r ON r.tenant_id=c.tenant_id AND r.id=c.run_id WHERE c.tenant_id=$1 AND c.state IN ('waiting_authorization','unknown')
   UNION ALL SELECT id,'resource',state,session_id,NULL,created_at FROM resource_operations WHERE tenant_id=$1 AND state='unknown' AND review_state<>'acknowledged'
  ) items ORDER BY created_at,id LIMIT $2 OFFSET $3`,[tenant,q.limit+1,q.offset])).rows;
  return {items:rows.slice(0,q.limit),next_offset:rows.length>q.limit?q.offset+q.limit:null,offset:q.offset};
 }
}
