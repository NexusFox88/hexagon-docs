import {ToolAuthenticationError} from '../../integrations/tools/http-json.js';
import {connectionUsage} from './usage.js';
import {remoteMcpConnection,remoteMcpConfig,discoverMcp} from '../../integrations/mcp/remote.js';
import { ApplicationOAuth } from '../apps/oauth.js';
import { applicationConnections, application, verifyApplication, ApplicationVerificationError, AppRequestError } from '../../integrations/apps/registry.js';
import { SandboxPrerequisiteError } from '../sandboxes/connector.js';
import { ConnectionAccess } from '../access/access.js';
import { ManagedSecrets } from '../credentials/managed-secrets.js';
import { httpAccessConnection } from '../../integrations/tools/http-access.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { SecretStore } from '../credentials/secret-store.js';
import { ExecutionError } from '../execution/runs.js';
import { transaction } from '../storage/database.js';

export type ConnectionKind = 'sandbox' | 'model' | 'tool' | 'http';
export interface ConnectionAdapter {
  kind: ConnectionKind;
  provider: string;
  config: z.ZodTypeAny;
  capabilities: string[];
  setup_url?:string;
  evidence?:{implemented:boolean;contract_tests:boolean;live_resource:boolean;source:string};
  /** Return only safe, explicit metadata; never remote response bodies or tokens. */
  validate(config: Record<string, unknown>, credential: string): Promise<{ account?: string; scope?: string[]; operations: string[] }>;
}
export const connectionInput = z.object({
  kind: z.enum(['sandbox', 'tool', 'model', 'http']), provider: z.string().min(1), name: z.string().min(1).max(200),
  secret_id: z.string().uuid().optional(), config: z.record(z.unknown()).default({}), credential: z.string().min(1).max(32768).optional(),
}).strict();
export const connectionPatch = z.object({
  secret_id: z.string().uuid().optional(), name: z.string().min(1).max(200).optional(), config: z.record(z.unknown()).optional(),
  credential: z.string().min(1).max(32768).optional(), enabled: z.boolean().optional(),
}).strict();

const fields = 'managed_secret_id AS secret_id,id,kind,provider,name,config,status,enabled,version,validation,created_at,updated_at,(secret_id IS NOT NULL) AS has_credential';

export class Connections {
  constructor(private pool: pg.Pool, private secrets: SecretStore, private adapters: ConnectionAdapter[]) { this.adapters=[...adapters,remoteMcpConnection,...applicationConnections.filter(a=>!adapters.some(b=>b.kind===a.kind&&b.provider===a.provider))]; if (!adapters.some(a=>a.kind==='http'&&a.provider==='http')) this.adapters=[...this.adapters,httpAccessConnection]; }
  oauth() { return new ApplicationOAuth(this.pool,this.secrets); }
  access() { return new ConnectionAccess(this.pool,this.secrets); }
  managedSecrets() { return new ManagedSecrets(this.pool,this.secrets); }

  catalog() { return this.adapters.map(({ kind, provider, capabilities, evidence, setup_url }) => ({ kind, provider, capabilities,...(setup_url?{setup_url}:{}),...(evidence?{evidence}:{}) })); }
  adapter(kind: string, provider: string) {
    const adapter = this.adapters.find(a => a.kind === kind && a.provider === provider);
    if (!adapter) throw new ExecutionError('unsupported_connection_provider', 400);
    return adapter;
  }
  async dependencies(tenant:string,id:string){
    await this.get(tenant,id);
    const agents=(await this.pool.query("SELECT id,name,revision,archived_at FROM agents WHERE tenant_id=$1 AND jsonb_path_exists(definition,'$.bindings.** ? (@ == $id)',jsonb_build_object('id',$2::text)) ORDER BY created_at DESC LIMIT 100",[tenant,id])).rows;
    const sessions=(await this.pool.query(`SELECT s.id,s.state,s.agent_id FROM sessions s WHERE s.tenant_id=$1 AND s.state<>'closed' AND (s.sandbox_connection_id=$2 OR s.model_connection_id=$2 OR EXISTS(SELECT 1 FROM session_tools t WHERE t.tenant_id=s.tenant_id AND t.session_id=s.id AND t.connection_id=$2) OR EXISTS(SELECT 1 FROM session_connections c WHERE c.tenant_id=s.tenant_id AND c.session_id=s.id AND c.connection_id=$2)) ORDER BY s.created_at DESC LIMIT 100`,[tenant,id])).rows;
    return {agents,sessions,limit:100};
  }
  async usage(tenant:string,id:string,query:unknown){await this.get(tenant,id);return connectionUsage(this.pool,tenant,id,query);}
  async list(tenant: string) {
    return (await this.pool.query(`SELECT ${fields} FROM connections WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [tenant])).rows;
  }
  async get(tenant: string, id: string) {
    const result = await this.pool.query(`SELECT ${fields} FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [tenant, id]);
    if (!result.rowCount) throw new ExecutionError('connection_not_found', 404);
    return result.rows[0];
  }
  async create(tenant: string, input: z.input<typeof connectionInput>) {
    const parsed = connectionInput.parse(input);
    if(parsed.secret_id && parsed.credential)throw new ExecutionError('ambiguous_credential',400);
    const config = this.adapter(parsed.kind, parsed.provider).config.parse(parsed.config);
    const id = randomUUID();
    await transaction(this.pool, async db => {
      const secret = parsed.secret_id ? await this.managedSecrets().copyForConnection(tenant,parsed.secret_id,id,db) : parsed.credential ? await this.secrets.save(tenant, `connection:${id}`, parsed.credential, db) : null;
      await db.query('INSERT INTO connections(tenant_id,id,kind,provider,name,config,secret_id,managed_secret_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, id, parsed.kind, parsed.provider, parsed.name, config, secret, parsed.secret_id??null]);
    });
    return this.get(tenant, id);
  }
  async patch(tenant: string, id: string, input: z.input<typeof connectionPatch>) {
    const patch = connectionPatch.parse(input);
    if(patch.secret_id && patch.credential)throw new ExecutionError('ambiguous_credential',400);
    await transaction(this.pool, async db => {
      // Lock a newly referenced Secret before the Connection, matching rotation order.
      const referencedSecret = patch.secret_id ? await this.managedSecrets().copyForConnection(tenant,patch.secret_id,id,db) : undefined;
      const row = (await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [tenant, id])).rows[0];
      if (!row) throw new ExecutionError('connection_not_found', 404);
      const changed = patch.config !== undefined || patch.credential !== undefined || patch.secret_id !== undefined;
      if (patch.enabled && (changed || row.status !== 'ready')) throw new ExecutionError('validation_required', 409);
      const config = patch.config === undefined ? row.config : this.adapter(row.kind, row.provider).config.parse(patch.config);
      if(patch.enabled && row.managed_secret_id && !(await db.query('SELECT 1 FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND enabled AND deleted_at IS NULL',[tenant,row.managed_secret_id])).rowCount)throw new ExecutionError('secret_disabled',409);
      const secret = referencedSecret ?? (patch.credential ? await this.secrets.save(tenant, `connection:${id}`, patch.credential, db) : row.secret_id);
      await db.query('UPDATE connections SET managed_secret_id=$9,name=$3,config=$4,secret_id=$5,status=$6,enabled=$7,validation=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2', [tenant, id, patch.name ?? row.name, config, secret, changed ? 'draft' : row.status, changed ? false : patch.enabled ?? row.enabled, changed ? null : row.validation, patch.secret_id??(patch.credential?null:row.managed_secret_id)]);
    });
    return this.get(tenant, id);
  }
  async validate(tenant: string, id: string) {
    const row = (await this.pool.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL', [tenant, id])).rows[0];
    if (!row) throw new ExecutionError('connection_not_found', 404);
    const adapter = this.adapter(row.kind, row.provider);
    let validation: Record<string, unknown>;
    let status: string;
    try {
      if(row.managed_secret_id && !(await this.pool.query('SELECT 1 FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND enabled AND deleted_at IS NULL',[tenant,row.managed_secret_id])).rowCount)throw new Error('secret_disabled');
      if (!row.secret_id && !(row.provider==='mcp-remote'&&row.config.authentication==='none')) throw new Error('missing_credential');
      const credential = !row.secret_id||(row.provider==='mcp-remote'&&row.config.authentication==='none')?'':row.config.authentication==='oauth' ? await this.oauth().credential(tenant,id) : await this.secrets.read(tenant, row.secret_id, `connection:${id}`);
      let grantedScope:string|undefined;
      if(row.config.authentication==='oauth'){const latest=(await this.pool.query('SELECT secret_id FROM connections WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];const envelope=JSON.parse(await this.secrets.read(tenant,latest.secret_id,`connection:${id}`));grantedScope=typeof envelope.scope==='string'?envelope.scope:undefined;}
      const app=row.kind==='tool'?application(row.provider):undefined;
      const verified = app?await verifyApplication(app,row.config,credential,grantedScope):await adapter.validate(row.config, credential);
      validation = { ...verified, checked_at: new Date().toISOString(), version: row.version };
      status = 'ready';
    } catch (error) {
      validation = { ...(error instanceof ApplicationVerificationError?error.verification:{}), code: error instanceof ApplicationVerificationError || error instanceof AppRequestError ? error.code : error instanceof ToolAuthenticationError ? 'credential_reauthorization_required' : error instanceof SandboxPrerequisiteError ? error.code : row.secret_id || (row.provider==='mcp-remote'&&row.config.authentication==='none') ? 'verification_failed' : 'credential_required', checked_at: new Date().toISOString(), version: row.version };
      status = 'invalid';
    }
    // A slow remote response must never bless a newly rotated credential/configuration.
    const updated = await this.pool.query('UPDATE connections SET status=$4,validation=$5,enabled=CASE WHEN $4=\'ready\' THEN enabled ELSE false END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING id', [tenant, id, row.version, status, validation]);
    if (!updated.rowCount) throw new ExecutionError('connection_changed_during_validation', 409);
    return this.get(tenant, id);
  }
  async discoverMcp(tenant:string,id:string){
    const row=await this.get(tenant,id);if(row.kind!=='tool'||row.provider!=='mcp-remote')throw new ExecutionError('unsupported_connection_provider',400);
    const credential=await this.oauth().credential(tenant,id);
    const tools=await discoverMcp(row.config,credential).catch(()=>{throw new ExecutionError('mcp_discovery_failed',422);});
    // Discovery is a new, disabled configuration revision; it cannot silently update existing grants.
    const config=remoteMcpConfig.parse({...row.config,tools});
    const updated=await this.pool.query("UPDATE connections SET config=$4,version=version+1,status='draft',enabled=false,validation=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING id",[tenant,id,row.version,config]);
    if(!updated.rowCount)throw new ExecutionError('connection_changed_during_validation',409);
    return this.get(tenant,id);
  }
  async disconnect(tenant:string,id:string){
    await transaction(this.pool,async db=>{
      const row=(await db.query('SELECT kind FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,id])).rows[0];
      if(!row)throw new ExecutionError('connection_not_found',404);
      if(row.kind!=='tool')throw new ExecutionError('connection_kind_mismatch',400);
      await db.query("UPDATE connections SET secret_id=NULL,managed_secret_id=NULL,enabled=false,status='draft',version=version+1,validation=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,id]);
      await db.query("UPDATE application_oauth_flows SET status='cancelled' WHERE tenant_id=$1 AND connection_id=$2 AND status='pending'",[tenant,id]);
      await db.query('DELETE FROM secrets WHERE tenant_id=$1 AND purpose=$2',[tenant,`connection:${id}`]);
    });
    return {...await this.get(tenant,id),provider_revoked:false};
  }
  async remove(tenant: string, id: string) {
    await transaction(this.pool, async db => {
      const found = await db.query('SELECT id FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [tenant, id]);
      if (!found.rowCount) throw new ExecutionError('connection_not_found', 404);
      const dependencies = await db.query(`SELECT s.id FROM sessions s WHERE s.tenant_id=$1 AND s.state<>'closed' AND
        (s.sandbox_connection_id=$2 OR s.model_connection_id=$2 OR EXISTS (SELECT 1 FROM session_connections x WHERE x.tenant_id=s.tenant_id AND x.session_id=s.id AND x.connection_id=$2) OR EXISTS
        (SELECT 1 FROM session_tools t WHERE t.tenant_id=s.tenant_id AND t.session_id=s.id AND t.connection_id=$2)) LIMIT 1`, [tenant, id]);
      if (dependencies.rowCount) throw new ExecutionError('connection_in_use', 409);
      await db.query("UPDATE connections SET deleted_at=now(),enabled=false,status='deleted',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, id]);
    });
  }
}
