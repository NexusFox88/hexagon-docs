import {protocolNames,protocolContract} from './protocols.js';
import type pg from 'pg';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {transaction} from '../storage/database.js';
import type {SecretStore} from '../credentials/secret-store.js';
import {ExecutionError} from '../execution/runs.js';
import type {HarnessAdapter,HarnessDefinition} from '../execution/harness.js';
import {resolveImage, type RegistryCredential} from './registry.js';
import {ociAdapter} from './runtime-adapter.js';
export const imageRegistration=z.object({
 id:z.string().regex(/^custom\.[a-z0-9][a-z0-9.-]{0,79}$/).optional(),name:z.string().min(1).max(100).optional(),
 version:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/).optional(),image:z.string().min(1).max(512),
 protocol:z.enum(protocolNames).optional(),
 command:z.array(z.string().min(1).max(65536).refine(s=>!s.includes('\0'))).min(1).max(32).optional(),
 capabilities:z.array(z.enum(['conversation','tools','initialization'])).min(1).max(3).default(['conversation']),
 registry_secret_id:z.string().uuid().optional(),
}).strict();
export type ImageDefinition=HarnessDefinition&{name:string;source:'oci';protocol:NonNullable<z.infer<typeof imageRegistration>['protocol']>;image:{reference:string;digest:string;platform:'linux/amd64';user:string;registry_secret_id?:string};command:string[];registration_digest:string};
export class HarnessImages{
 constructor(private pool:pg.Pool,private secrets?:SecretStore,private resolve=resolveImage){}
 async register(tenant:string,input:unknown){
  const value=imageRegistration.parse(input);let credential:RegistryCredential|undefined;
  if(value.registry_secret_id)credential=await this.credential(tenant,value.registry_secret_id);
  const resolved=await this.resolve(value.image,credential);
  const protocol=value.protocol??z.enum(protocolNames).parse(resolved.labels['ai.hexagon.harness.protocol']??'hexagon-json-v1');
  const id=value.id??`custom.${resolved.reference.split('/').at(-1)!.split('@')[0]!.replace(/[^a-z0-9.-]/g,'-').slice(0,70)}`;
  const version=value.version??resolved.digest.slice(7,23),command=value.command??resolved.command;
  if(!command.length)throw new ExecutionError('harness_entrypoint_missing',400);
  if(value.capabilities.includes('initialization')&&['aider-v1','deepseek-v1'].includes(protocol))throw new ExecutionError('harness_initialization_unsupported',400);
  if(!protocolContract(protocol).tools&&value.capabilities.includes('tools'))throw new ExecutionError('harness_tools_unsupported',400);
  const definition={id,version,name:value.name??id,capabilities:[...new Set(value.capabilities)].sort(),model_providers:protocolContract(protocol).model_providers,source:'oci' as const,protocol,
   image:{reference:resolved.reference,digest:resolved.digest,platform:resolved.platform,user:resolved.user,...(value.registry_secret_id?{registry_secret_id:value.registry_secret_id}:{})},command};
  const digest=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  return transaction(this.pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenant,id,version])]);
   if(value.registry_secret_id){const row=(await db.query('SELECT enabled FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',[tenant,value.registry_secret_id])).rows[0];if(!row)throw new ExecutionError('secret_not_found',404);if(!row.enabled)throw new ExecutionError('secret_disabled',409);}
   if((await db.query('SELECT 1 FROM harness_packages WHERE tenant_id=$1 AND id=$2 AND version=$3',[tenant,id,version])).rowCount)throw new ExecutionError('harness_version_conflict',409);
   await db.query('INSERT INTO harness_images(tenant_id,id,version,definition,registry_secret_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenant,id,version,{...definition,registration_digest:digest},value.registry_secret_id??null]);
   const existing=(await db.query('SELECT definition FROM harness_images WHERE tenant_id=$1 AND id=$2 AND version=$3',[tenant,id,version])).rows[0].definition;
   if(existing.registration_digest!==digest)throw new ExecutionError('harness_version_conflict',409);return {...existing,capabilities:ociAdapter(existing).definition.capabilities} as ImageDefinition;
  });
 }
 async credential(tenant:string,id:string){
  const row=(await this.pool.query('SELECT secret_id,enabled FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[tenant,id])).rows[0];
  if(!row)throw new ExecutionError('secret_not_found',404);if(!row.enabled)throw new ExecutionError('secret_disabled',409);
  if(!this.secrets)throw new ExecutionError('secret_store_unavailable',503);
  try{return z.object({username:z.string().min(1),password:z.string().min(1)}).strict().parse(JSON.parse(await this.secrets.read(tenant,row.secret_id,`managed:${id}`)));}catch{throw new ExecutionError('image_registry_credential_invalid',400);}
 }
 async catalog(tenant:string):Promise<ImageDefinition[]>{return (await this.pool.query('SELECT definition FROM harness_images WHERE tenant_id=$1 ORDER BY created_at,id,version',[tenant])).rows.map(r=>({...r.definition,capabilities:ociAdapter(r.definition).definition.capabilities}));}
 async resolveForTenant(tenant:string,reference:{id:string;version:string}):Promise<HarnessAdapter|undefined>{
  const row=(await this.pool.query('SELECT definition FROM harness_images WHERE tenant_id=$1 AND id=$2 AND version=$3',[tenant,reference.id,reference.version])).rows[0];return row?ociAdapter(row.definition):undefined;
 }
}
