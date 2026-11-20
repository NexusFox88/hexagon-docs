import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { SecretStore } from './secret-store.js';
import { transaction } from '../storage/database.js';
import { ExecutionError } from '../execution/runs.js';

const value = z.string().min(1).max(32768).refine(v => !v.includes('\0'), 'invalid_secret_value');
export const secretInput = z.object({ name: z.string().min(1).max(200), value }).strict();
export const secretPatch = z.object({ name: z.string().min(1).max(200).optional(), value: value.optional(), enabled: z.boolean().optional() }).strict();
const fields = 'id,name,version,enabled,created_at,updated_at';
export class ManagedSecrets {
  constructor(private pool: pg.Pool, private store: SecretStore) {}
  async list(tenant: string) { return (await this.pool.query(`SELECT ${fields} FROM managed_secrets WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [tenant])).rows; }
  async get(tenant: string, id: string) {
    const row = (await this.pool.query(`SELECT ${fields} FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [tenant,id])).rows[0];
    if (!row) throw new ExecutionError('secret_not_found',404);
    row.connections = (await this.pool.query('SELECT id,name,kind FROM connections WHERE tenant_id=$1 AND managed_secret_id=$2 AND deleted_at IS NULL ORDER BY id',[tenant,id])).rows;
    row.harnesses=(await this.pool.query('SELECT id,version FROM harness_images WHERE tenant_id=$1 AND registry_secret_id=$2 ORDER BY id,version',[tenant,id])).rows;
    row.sessions=(await this.pool.query(`SELECT s.id,s.state,s.definition->>'name' AS name,c.id AS connection_id,c.name AS connection_name,c.kind,
      rev.created_at AS revoked_at FROM sessions s JOIN connections c ON c.tenant_id=s.tenant_id
      LEFT JOIN session_connection_revocations rev ON rev.tenant_id=s.tenant_id AND rev.session_id=s.id AND rev.connection_id=c.id
      WHERE s.tenant_id=$1 AND c.managed_secret_id=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.definition->'connections') p WHERE p->>'id'=c.id)
      ORDER BY s.created_at DESC LIMIT 200`,[tenant,id])).rows;
    return row;
  }
  async create(tenant: string, input: unknown) {
    const parsed=secretInput.parse(input), id=randomUUID();
    await transaction(this.pool,async db=>{
      const encrypted=await this.store.save(tenant,`managed:${id}`,parsed.value,db);
      await db.query('INSERT INTO managed_secrets(tenant_id,id,name,secret_id) VALUES($1,$2,$3,$4)',[tenant,id,parsed.name,encrypted]);
    });
    return this.get(tenant,id);
  }
  async copyForConnection(tenant: string, id: string, connection: string, db: pg.PoolClient) {
    const row=(await db.query('SELECT * FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,id])).rows[0];
    if(!row) throw new ExecutionError('secret_not_found',404);
    if(!row.enabled) throw new ExecutionError('secret_disabled',409);
    return this.store.save(tenant,`connection:${connection}`,await this.store.read(tenant,row.secret_id,`managed:${id}`,db),db);
  }
  async patch(tenant:string,id:string,input:unknown) {
    const change=secretPatch.parse(input);
    await transaction(this.pool,async db=>{
      const row=(await db.query('SELECT * FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,id])).rows[0];
      if(!row) throw new ExecutionError('secret_not_found',404);
      const encrypted=change.value===undefined?row.secret_id:await this.store.save(tenant,`managed:${id}`,change.value,db);
      await db.query('UPDATE managed_secrets SET name=$3,secret_id=$4,enabled=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,id,change.name??row.name,encrypted,change.enabled??row.enabled]);
      if(change.value!==undefined || change.enabled!==undefined) {
        const connections=(await db.query('SELECT id,secret_id FROM connections WHERE tenant_id=$1 AND managed_secret_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE',[tenant,id])).rows;
        for(const c of connections) {
          const secret=change.value===undefined?c.secret_id:await this.store.save(tenant,`connection:${c.id}`,change.value,db);
          await db.query("UPDATE connections SET secret_id=$3,enabled=false,status='draft',validation=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,c.id,secret]);
        }
      }
    });
    return this.get(tenant,id);
  }
  async remove(tenant:string,id:string) {
    await transaction(this.pool,async db=>{
      const row=await db.query('SELECT id FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,id]);
      if(!row.rowCount)throw new ExecutionError('secret_not_found',404);
      if((await db.query('SELECT 1 FROM connections WHERE tenant_id=$1 AND managed_secret_id=$2 AND deleted_at IS NULL LIMIT 1',[tenant,id])).rowCount)throw new ExecutionError('secret_in_use',409);
      if((await db.query('SELECT 1 FROM harness_images WHERE tenant_id=$1 AND registry_secret_id=$2 LIMIT 1',[tenant,id])).rowCount)throw new ExecutionError('secret_in_use',409);
      await db.query('UPDATE managed_secrets SET deleted_at=now(),enabled=false,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,id]);
    });
  }
}
