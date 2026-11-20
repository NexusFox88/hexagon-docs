import type pg from 'pg';
import {SecretStore} from '../credentials/secret-store.js';
import {ExecutionError} from './errors.js';
export class SessionConfiguration {
 constructor(private pool:pg.Pool,private secrets:SecretStore){}
 private async session(tenant:string,id:string){const row=(await this.pool.query('SELECT * FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(!row)throw new ExecutionError('session_not_found',404);return row;}
 async environment(tenant:string,id:string){const s=await this.session(tenant,id);return {env:s.env_secret_id?JSON.parse(await this.secrets.read(tenant,s.env_secret_id,`session-env:${id}`)):{},scope:'agent_process',mutable:false};}
 async authorization(tenant:string,id:string){const s=await this.session(tenant,id);const rows=(await this.pool.query(`SELECT c.id,c.name,c.kind,c.version,c.enabled,c.status,c.deleted_at,c.managed_secret_id,
 m.name AS secret_name,m.enabled AS secret_enabled,m.deleted_at AS secret_deleted,r.created_at AS revoked_at
 FROM connections c LEFT JOIN managed_secrets m ON m.tenant_id=c.tenant_id AND m.id=c.managed_secret_id
 LEFT JOIN session_connection_revocations r ON r.tenant_id=c.tenant_id AND r.connection_id=c.id AND r.session_id=$2
 WHERE c.tenant_id=$1 AND c.id=ANY($3::text[])`,[tenant,id,(s.definition.connections??[]).map((c:any)=>c.id)])).rows;
 return {session_id:id,connections:rows.map(c=>{const pinned=s.definition.connections.find((p:any)=>p.id===c.id);return {id:c.id,name:c.name,kind:c.kind,pinned_version:pinned.version,current_version:c.version,secret:c.managed_secret_id?{id:c.managed_secret_id,name:c.secret_name}:null,raw_secret_in_sandbox:false,revoked_at:c.revoked_at,state:c.revoked_at?'revoked':c.deleted_at?'deleted':!c.enabled||c.status!=='ready'||c.secret_enabled===false||c.secret_deleted?'unavailable':c.kind!=='tool'&&pinned.version!==c.version?'changed':'ready'};})};}
 async revoke(tenant:string,id:string,connection:string){const s=await this.session(tenant,id);const bound=s.definition.connections?.find((c:any)=>c.id===connection&&['tool','http'].includes(c.kind));if(!bound)throw new ExecutionError('connection_not_bound',403);
 await this.pool.query('INSERT INTO session_connection_revocations(tenant_id,session_id,connection_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,id,connection]);
 await this.pool.query('UPDATE access_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND session_id=$2 AND connection_id=$3',[tenant,id,connection]);
 return this.authorization(tenant,id);}
}
