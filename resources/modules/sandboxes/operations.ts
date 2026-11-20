import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {transaction} from '../storage/database.js';
import {ExecutionError} from '../execution/runs.js';
import type {SandboxLifecycle} from './lifecycle.js';
export const reviewInput=z.object({action:z.enum(['acknowledge','reopen','reconcile']),note:z.string().trim().max(2000).default('')}).strict();
export class ResourceOperations {
  constructor(private pool:pg.Pool,private lifecycle:SandboxLifecycle){}
  async list(tenant:string,limit=50,offset=0){
    const result=await this.pool.query(`SELECT o.id,o.session_id,o.kind,o.state,o.provider_resource_id,o.attempt_count,o.review_state,o.last_checked_at,o.next_check_at,o.created_at,o.updated_at,
      o.detail->>'reason' AS reason,o.detail->'failure' AS failure,o.detail->>'provider_operation_id' AS provider_operation_id,o.detail->>'build_id' AS provider_build_id,c.provider,s.state AS session_state
      FROM resource_operations o JOIN sessions s ON s.tenant_id=o.tenant_id AND s.id=o.session_id
      JOIN connections c ON c.tenant_id=s.tenant_id AND c.id=s.sandbox_connection_id
      WHERE o.tenant_id=$1 ORDER BY o.updated_at DESC,o.id LIMIT $2 OFFSET $3`,[tenant,limit+1,offset]);
    return {operations:result.rows.slice(0,limit),next_offset:result.rows.length>limit?offset+limit:null};
  }
  async get(tenant:string,id:string){
    const row=(await this.pool.query('SELECT id,session_id,kind,state,provider_resource_id,attempt_count,review_state,last_checked_at,next_check_at,created_at,updated_at,detail->>\'reason\' AS reason,detail->\'failure\' AS failure,detail->>\'provider_operation_id\' AS provider_operation_id,detail->>\'build_id\' AS provider_build_id FROM resource_operations WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];
    if(!row)throw new ExecutionError('resource_operation_not_found',404);
    return {...row,reviews:(await this.pool.query('SELECT id,action,note,created_at FROM resource_operation_reviews WHERE tenant_id=$1 AND operation_id=$2 ORDER BY created_at DESC LIMIT 50',[tenant,id])).rows};
  }
  async review(tenant:string,id:string,input:unknown){
    const parsed=reviewInput.parse(input);
    const operation=await transaction(this.pool,async db=>{
      const row=(await db.query('SELECT * FROM resource_operations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
      if(!row)throw new ExecutionError('resource_operation_not_found',404);
      if(row.state!=='unknown')throw new ExecutionError('resource_operation_not_pending',409);
      await db.query('INSERT INTO resource_operation_reviews(tenant_id,id,operation_id,action,note) VALUES($1,$2,$3,$4,$5)',[tenant,randomUUID(),id,parsed.action,parsed.note]);
      await db.query("UPDATE resource_operations SET review_state=$3,next_check_at=CASE WHEN $3='automatic' THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,id,parsed.action==='acknowledge'?'acknowledged':'automatic']);
      return row;
    });
    if(parsed.action==='reconcile'){
      const session=(await this.pool.query('SELECT state FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,operation.session_id])).rows[0];
      try {if(session?.state==='closing'||operation.kind==='delete')await this.lifecycle.close(tenant,operation.session_id);else if(operation.kind==='checkpoint')await this.lifecycle.pause(tenant,operation.session_id,'sandbox');else if(operation.kind==='restore')await this.lifecycle.resume(tenant,operation.session_id);else await this.lifecycle.provision(tenant,operation.session_id);}
      catch(error){if(!(error instanceof ExecutionError))throw error;return {...await this.get(tenant,id),reconciliation_error:error.code};}
    }
    return this.get(tenant,id);
  }
}
