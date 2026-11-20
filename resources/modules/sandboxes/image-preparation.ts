import {failureDiagnostic} from '../diagnostics/failure.js';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {ExecutionError} from '../execution/runs.js';
import type {SandboxConnector, SandboxRequest, PreparedSandboxImage} from './connector.js';

/** Caller holds the Session lifecycle lock. Receipts live in the existing operation ledger. */
export async function prepareSandboxImage(db:pg.PoolClient, tenant:string, session:string, connector:SandboxConnector, image:NonNullable<SandboxRequest['image']>) {
  if(!connector.prepareImage)return undefined; // Native-image connectors receive the original OCI reference.
  if(!connector.inspectImage||!connector.findImageByOperation||!connector.deleteImage)throw new ExecutionError('sandbox_image_contract_incomplete',400);
  let operation=(await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='image_prepare' ORDER BY created_at LIMIT 1",[tenant,session])).rows[0];
  const record=async(id:string,handle:PreparedSandboxImage)=>{
    await db.query("UPDATE resource_operations SET provider_resource_id=$3,detail=detail || $4::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,id,handle.id,{build_id:handle.build_id}]);
  };
  if(!operation){
    operation={id:randomUUID(),state:'pending',detail:{}};
    await db.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,state,detail) VALUES($1,$2,$3,'image_prepare','pending',$4)",[tenant,operation.id,session,{reference:image.reference}]);
    try{
      const handle=await connector.prepareImage({operation_id:operation.id,image,record:handle=>record(operation.id,handle)});
      await record(operation.id,handle);
    }catch(error){
      await db.query("UPDATE resource_operations SET state='unknown',detail=detail || $3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,operation.id,{reason:'image_preparation_unconfirmed',failure:failureDiagnostic(error)}]);
      throw new ExecutionError('sandbox_image_preparation_unconfirmed',409);
    }
    operation=(await db.query('SELECT * FROM resource_operations WHERE tenant_id=$1 AND id=$2',[tenant,operation.id])).rows[0];
  }
  if(operation.state==='unknown'&&operation.review_state!=='automatic')throw new ExecutionError('resource_review_required',409);
  if(operation.state==='rejected')throw new ExecutionError('sandbox_image_build_failed',409);
  if(operation.state==='deleted')throw new ExecutionError('sandbox_image_deleted',409);
  let handle=operation.provider_resource_id&&operation.detail.build_id?{id:operation.provider_resource_id,build_id:operation.detail.build_id}:undefined;
  if(!handle){
    handle=await connector.findImageByOperation(operation.id);
    if(!handle)throw new ExecutionError('sandbox_image_preparation_unconfirmed',409);
    await record(operation.id,handle);
  }
  const status=await connector.inspectImage(handle);
  await db.query("UPDATE resource_operations SET state=$3,detail=(detail-'reason') || $4::jsonb,attempt_count=attempt_count+1,last_checked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,operation.id,status==='ready'?'completed':status==='failed'?'rejected':'pending',status==='failed'?{reason:'image_build_failed'}:{}]);
  if(status==='failed')throw new ExecutionError('sandbox_image_build_failed',409);
  if(status!=='ready')throw new ExecutionError('sandbox_image_build_pending',409);
  return handle.id;
}

export async function cleanupSandboxImages(db:pg.PoolClient,tenant:string,session:string,connector:SandboxConnector){
  const rows=(await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='image_prepare' AND state<>'deleted'",[tenant,session])).rows;
  for(const operation of rows){
    if(!connector.deleteImage)throw new ExecutionError('sandbox_image_contract_incomplete',409);
    let handle=operation.provider_resource_id?{id:operation.provider_resource_id,build_id:operation.detail.build_id??''}:await connector.findImageByOperation?.(operation.id);
    if(!handle)throw new ExecutionError('sandbox_image_preparation_unconfirmed',409);
    // Keep a recovered receipt even if deletion subsequently loses its response.
    await db.query("UPDATE resource_operations SET provider_resource_id=$3,detail=detail || $4::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,operation.id,handle.id,{build_id:handle.build_id}]);
    await connector.deleteImage(handle);
    await db.query("UPDATE resource_operations SET state='deleted',updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,operation.id]);
  }
}
