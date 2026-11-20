import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {SandboxConnector,SandboxRequest,SandboxResource} from './connector.js';
import {ExecutionError} from '../execution/runs.js';

/** Native filesystem snapshots with durable intent; an ambiguous snapshot is never repeated. */
export async function checkpointTransition(db:pg.PoolClient,row:any,connector:SandboxConnector,resume:boolean):Promise<SandboxResource>{
 const tenant=row.tenant_id,session=row.id;
 if(!resume){
  let op=(await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='checkpoint' AND detail->>'source_id'=$3 ORDER BY created_at DESC LIMIT 1",[tenant,session,row.sandbox.id])).rows[0];
  if(!op){
   op={id:randomUUID(),provider_resource_id:null};
   await db.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,detail) VALUES($1,$2,$3,'checkpoint',$4)",[tenant,op.id,session,{source_id:row.sandbox.id}]);
   try{
    op.provider_resource_id=await connector.snapshot!(row.sandbox.id,{operation_id:op.id,record:async imageId=>{await db.query("UPDATE resource_operations SET provider_resource_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,op.id,imageId]);}});
    await db.query("UPDATE resource_operations SET provider_resource_id=$3,state='completed',updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,op.id,op.provider_resource_id]);
   }catch{
    await db.query("UPDATE resource_operations SET state='unknown',review_state='needs_review',detail=detail || '{\"reason\":\"snapshot_unconfirmed\"}'::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,op.id]);
    throw new ExecutionError('sandbox_checkpoint_unconfirmed',409);
   }
  }
  if(!op.provider_resource_id)throw new ExecutionError('sandbox_checkpoint_unconfirmed',409);
  // Deleting the exact source is idempotent; the verified checkpoint is already durable.
  if(await connector.inspect(row.sandbox.id))await connector.destroy(row.sandbox.id);
  if(await connector.inspect(row.sandbox.id))throw new ExecutionError('session_transition_pending',409);
  return {...row.sandbox,state:'paused',checkpoint:op.provider_resource_id};
 }
 const checkpoint=row.sandbox.checkpoint;
 if(!checkpoint)throw new ExecutionError('sandbox_checkpoint_missing',409);
 let op=(await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='restore' AND detail->>'checkpoint'=$3 ORDER BY created_at DESC LIMIT 1",[tenant,session,checkpoint])).rows[0];
 let resource:SandboxResource|undefined;
 if(!op){
  op={id:randomUUID()};
  await db.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,detail) VALUES($1,$2,$3,'restore',$4)",[tenant,op.id,session,{checkpoint}]);
  const request:SandboxRequest={operation_id:op.id,session_id:session,timeout_seconds:row.definition.resources.timeout_seconds,network:row.definition.network};
  try{resource=await connector.restore!(checkpoint,request);}catch{/* Reconcile the unique operation name below; never issue another create. */}
 }
 if(!resource){
  const matches=await connector.findByOperation(op.id);
  if(matches.length===1)resource=matches[0];
 }
 if(!resource){await db.query("UPDATE resource_operations SET state='unknown',detail=detail || '{\"reason\":\"restore_unconfirmed\"}'::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,op.id]);throw new ExecutionError('sandbox_restore_unconfirmed',409);}
 await db.query("UPDATE resource_operations SET state='completed',provider_resource_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,op.id,resource.id]);
 return resource;
}
