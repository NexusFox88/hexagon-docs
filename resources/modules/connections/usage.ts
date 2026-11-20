import type pg from 'pg';
import {z} from 'zod';
export const usageQuery=z.object({section:z.enum(['agents','sessions','calls']).default('sessions'),offset:z.coerce.number().int().min(0).max(100000).default(0)});
/** Caller must authorize the connection first. Project metadata only, never arguments/results. */
export async function connectionUsage(pool:pg.Pool,tenant:string,id:string,input:unknown){
 const {section,offset}=usageQuery.parse(input);const limit=25;
 const queries={
  agents:`SELECT id,name,revision,archived_at FROM agents WHERE tenant_id=$1 AND jsonb_path_exists(definition,'$.bindings.** ? (@ == $id)',jsonb_build_object('id',$2::text)) ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $3`,
  sessions:`SELECT s.id,s.state,s.agent_id,s.definition->>'name' AS name,a.name AS agent_name,s.created_at FROM sessions s LEFT JOIN agents a ON a.tenant_id=s.tenant_id AND a.id=s.agent_id WHERE s.tenant_id=$1 AND EXISTS(SELECT 1 FROM session_tools t WHERE t.tenant_id=s.tenant_id AND t.session_id=s.id AND t.connection_id=$2) ORDER BY s.created_at DESC,s.id DESC LIMIT 26 OFFSET $3`,
  calls:`SELECT c.id,c.run_id,r.session_id,s.definition->>'name' AS session_name,(SELECT entry->'config'->'tools'->c.operation->>'name' FROM jsonb_array_elements(COALESCE(s.definition->'connections','[]'::jsonb)) entry WHERE entry->>'id'=$2 LIMIT 1) AS operation_name,s.agent_id,a.name AS agent_name,c.binding,c.operation,c.state,(c.result->>'isError')::boolean AS is_error,c.created_at FROM tool_calls c JOIN runs r ON r.tenant_id=c.tenant_id AND r.id=c.run_id JOIN sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id LEFT JOIN agents a ON a.tenant_id=s.tenant_id AND a.id=s.agent_id WHERE c.tenant_id=$1 AND (c.execution_policy->>'connection_id'=$2 OR (c.execution_policy->>'connection_id' IS NULL AND EXISTS(SELECT 1 FROM session_tools t WHERE t.tenant_id=s.tenant_id AND t.session_id=s.id AND t.name=c.binding AND t.connection_id=$2))) ORDER BY c.created_at DESC,c.run_id DESC,c.id DESC LIMIT 26 OFFSET $3`
 };
 const rows=(await pool.query(queries[section],[tenant,id,offset])).rows;
 return {section,items:rows.slice(0,limit),offset,next_offset:rows.length>limit?offset+limit:null};
}
