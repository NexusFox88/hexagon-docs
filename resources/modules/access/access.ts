import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { SecretStore } from '../credentials/secret-store.js';
import { ExecutionError } from '../execution/runs.js';
import { httpConnectionConfig } from './policy.js';
export function accessOrigin() {
  const value=process.env.HEXAGON_ACCESS_URL;
  if(!value)throw new ExecutionError('credential_proxy_not_configured',409);
  let u:URL;try{u=new URL(value);}catch{throw new ExecutionError('credential_proxy_url_invalid',409);}
  if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.pathname!=='/')throw new ExecutionError('credential_proxy_url_invalid',409);
  return u.origin;
}
export const grantDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
export class ConnectionAccess {
  constructor(private pool:pg.Pool,private secrets:SecretStore){}
  configuration() {
    try{return {state:'configured',origin:accessOrigin(),protocols:['https'],authentication:['bearer','header']};}
    catch(error){return {state:'not_configured',code:error instanceof ExecutionError?error.code:'credential_proxy_configuration_invalid'};}
  }
  async issue(tenant:string,sessionId:string,connectionId:string,db:Pick<pg.PoolClient,'query'>=this.pool,runId?:string) {
    const origin=accessOrigin();
    const session=(await db.query("SELECT * FROM sessions WHERE tenant_id=$1 AND id=$2 AND state='open'",[tenant,sessionId])).rows[0];
    if(!session)throw new ExecutionError('session_not_found',404);
    const bound=session.model_connection_id===connectionId || (await db.query('SELECT 1 FROM session_connections WHERE tenant_id=$1 AND session_id=$2 AND connection_id=$3',[tenant,sessionId,connectionId])).rowCount;
    if(!bound)throw new ExecutionError('connection_not_bound',403);
    if((await db.query('SELECT 1 FROM session_connection_revocations WHERE tenant_id=$1 AND session_id=$2 AND connection_id=$3',[tenant,sessionId,connectionId])).rowCount)throw new ExecutionError('access_denied',403);
    const c=(await db.query("SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND enabled AND status='ready'",[tenant,connectionId])).rows[0];
    if(!c || !['model','http'].includes(c.kind))throw new ExecutionError('connection_not_ready',409);
    const pinned=session.definition.connections.find((x:any)=>x.id===connectionId);
    if(!pinned || pinned.version!==c.version)throw new ExecutionError('session_connection_changed',409);
    const id=randomUUID(),token=randomBytes(32).toString('hex');
    // Bound each grant independently; Session and Run state are checked on every use.
    const deadline=Date.now()+Math.min(3600,session.definition.resources?.timeout_seconds??600)*1000;
    if(deadline<=Date.now())throw new ExecutionError('session_access_expired',409);
    await db.query('INSERT INTO access_grants(tenant_id,id,session_id,connection_id,connection_version,token_hash,expires_at,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,id,sessionId,connectionId,c.version,grantDigest(token),new Date(deadline),runId??null]);
    return {id,base_url:`${origin}/access/${id}`,token,expires_at:new Date(deadline).toISOString(),implementation:'external_proxy' as const};
  }
  async authorize(id:string,token:string) {
    const row=(await this.pool.query(`SELECT g.*,c.config,c.kind,c.provider,c.secret_id FROM access_grants g
      JOIN sessions s ON s.tenant_id=g.tenant_id AND s.id=g.session_id
      JOIN connections c ON c.tenant_id=g.tenant_id AND c.id=g.connection_id
      WHERE g.id=$1 AND g.token_hash=$2 AND g.revoked_at IS NULL AND g.expires_at>now()
      AND (g.run_id IS NULL OR EXISTS(SELECT 1 FROM runs r WHERE r.tenant_id=g.tenant_id AND r.id=g.run_id AND r.session_id=g.session_id AND r.state IN ('provisioning','running','waiting_authorization','waiting_approval')))
      AND NOT EXISTS(SELECT 1 FROM session_connection_revocations rev WHERE rev.tenant_id=g.tenant_id AND rev.session_id=g.session_id AND rev.connection_id=g.connection_id)
      AND s.state='open' AND c.deleted_at IS NULL AND c.enabled AND c.status='ready' AND c.version=g.connection_version
      AND NOT EXISTS(SELECT 1 FROM managed_secrets m WHERE m.tenant_id=c.tenant_id AND m.id=c.managed_secret_id AND (NOT m.enabled OR m.deleted_at IS NOT NULL))`,[id,grantDigest(token)])).rows[0];
    if(!row)throw new ExecutionError('access_denied',403);
    const policy=row.kind==='http'?httpConnectionConfig.parse(row.config):httpConnectionConfig.parse({endpoint:row.config.base_url,authentication:['openai-compatible','openai-responses'].includes(row.provider)?{type:'bearer'}:{type:'header',name:'x-api-key'},access:{rules:[{methods:['POST'],path:row.provider==='openai-responses'?'/v1/responses':row.provider==='openai-compatible'?'/v1/chat/completions':'/v1/messages'}]}});
    const credential=await this.secrets.read(row.tenant_id,row.secret_id,`connection:${row.connection_id}`);
    if(/[\r\n\0]/.test(credential))throw new ExecutionError('invalid_credential',409);
    return {policy,credential,kind:row.kind,tenant_id:row.tenant_id,run_id:row.run_id,connection_id:row.connection_id,connection_version:row.connection_version};
  }
  /** Persist only authenticated model/protected-API transport facts, never headers, prompts or response bodies. */
  async recordModelOutcome(grant:{kind:string;tenant_id:string;run_id:string|null;connection_id:string;connection_version?:number},status:number|null){
    if(!['model','http'].includes(grant.kind)||!grant.run_id)return;
    await this.pool.query("INSERT INTO events(tenant_id,run_id,type,data) SELECT $1,$2,$4,$3 WHERE EXISTS(SELECT 1 FROM runs WHERE tenant_id=$1 AND id=$2)",[grant.tenant_id,grant.run_id,{connection_id:grant.connection_id,status,transport:status===null?'failed':'received',connection_version:grant.connection_version},grant.kind==='model'?'model.response':'protected_api.response']);
  }
  async list(tenant:string,sessionId:string) {
    if(!(await this.pool.query('SELECT 1 FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,sessionId])).rowCount)throw new ExecutionError('session_not_found',404);
    return (await this.pool.query('SELECT id,session_id,connection_id,run_id,expires_at,revoked_at,created_at FROM access_grants WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at',[tenant,sessionId])).rows;
  }
  async revoke(tenant:string,id:string){
    const result=await this.pool.query('UPDATE access_grants SET revoked_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id',[tenant,id]);
    if(!result.rowCount)throw new ExecutionError('access_not_found',404);
  }
}
