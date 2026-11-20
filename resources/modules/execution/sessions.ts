import {SessionConfiguration} from './session-configuration.js';
import { resolveCombination } from './compatibility.js';
import {behaviorFields,compileInitialization} from './initialization.js';
import { accessOrigin } from '../access/access.js';
import { environmentInput } from './environment.js';
import type { SecretStore } from '../credentials/secret-store.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { Connections } from '../connections/connections.js';
import { transaction } from '../storage/database.js';
import { ExecutionError } from './runs.js';

import { HarnessRegistry } from './harness.js';
import type { HarnessDefinition } from './harness.js';
export type { HarnessDefinition } from './harness.js';
export const agentBindings = z.object({sandbox_connection_id:z.string().uuid(),model_connection_id:z.string().uuid(),tools:z.record(z.string().uuid()).default({}),connections:z.record(z.string().uuid()).default({})}).strict();
export const agentInput = z.object({
  ...behaviorFields,
  bindings: agentBindings.optional(),
  variables: environmentInput.optional(),
  env: environmentInput.default({}),
  name: z.string().min(1).max(200), harness: z.object({ id: z.string(), version: z.string() }).strict(),
  required_capabilities: z.array(z.string()).default([]),
  tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]*$/), required_at_start: z.boolean().default(true) }).strict()).default([]),
  resources: z.object({ idle_timeout_seconds:z.number().int().min(15).max(3600).default(60), timeout_seconds: z.number().int().min(60).max(3600).default(600) }).strict().default({}),
  network: z.object({ mode: z.enum(['unrestricted', 'allowlist']).default('unrestricted'), allowed_hosts: z.array(z.string().min(1)).default([]) }).strict().default({}),
}).strict();
export const sessionInput = z.object({
  ...behaviorFields,
  agent_revision:z.number().int().positive().optional(),
  variables: environmentInput.optional(),
  env: environmentInput.default({}),
  agent_id: z.string().uuid().optional(),
  harness: agentInput.shape.harness.optional(), name: z.string().min(1).max(200).optional(),
  resources: agentInput.shape.resources.optional(), network: agentInput.shape.network.optional(),
  required_capabilities: z.array(z.string()).optional(),
  optional_tools: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
  sandbox_connection_id: z.string().uuid(), model_connection_id: z.string().uuid(),
  tools: z.record(z.string().uuid()).default({}),
  connections: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),z.string().uuid()).default({}),
}).strict().superRefine((value,ctx)=>{
  if(Boolean(value.agent_id)===Boolean(value.harness))ctx.addIssue({code:z.ZodIssueCode.custom,path:['harness'],message:'Supply either harness or agent_id'});
  if(value.agent_revision&&!value.agent_id)ctx.addIssue({code:z.ZodIssueCode.custom,path:['agent_revision'],message:'Agent revision requires agent_id'});
  if(value.agent_id&&(value.identity||value.instructions!==undefined||value.context||value.name||value.resources||value.network||value.required_capabilities||value.optional_tools.length))ctx.addIssue({code:z.ZodIssueCode.custom,path:['agent_id'],message:'Agent configuration cannot be overridden'});
  if(value.optional_tools.some(name=>!Object.hasOwn(value.tools,name)))ctx.addIssue({code:z.ZodIssueCode.custom,path:['optional_tools'],message:'Unknown tool binding'});
});

export class Sessions {
  constructor(private pool: pg.Pool, private connections: Connections, private harnesses: HarnessDefinition[] | HarnessRegistry, private secrets?: SecretStore, private ensureCredentials?:()=>Promise<void>) {}
  async catalog(tenant: string) { return this.harnesses instanceof HarnessRegistry ? this.harnesses.catalogForTenant(tenant) : this.harnesses; }
  private async validateAgent(tenant:string,input:z.input<typeof agentInput>){
    const { env: legacy, variables, ...definition } = agentInput.parse(input);
    if(variables && Object.keys(legacy).length)throw new ExecutionError('ambiguous_variables',400);
    const env=variables??legacy;
    const harness = (await this.catalog(tenant)).find(h => h.id === definition.harness.id && h.version === definition.harness.version);
    if (!harness) throw new ExecutionError('unsupported_harness', 400);
    if(compileInitialization(definition)&&!harness.capabilities.includes('initialization'))throw new ExecutionError('harness_initialization_unsupported',400);
    if (definition.tools.length && !harness.capabilities.includes('tools')) throw new ExecutionError('harness_tools_unsupported', 400);
    if (new Set(definition.tools.map(t => t.name)).size !== definition.tools.length) throw new ExecutionError('duplicate_tool_name', 400);
    if(definition.bindings){
      const bindings=definition.bindings;
      const ids=[...new Set([bindings.sandbox_connection_id,bindings.model_connection_id,...Object.values(bindings.tools),...Object.values(bindings.connections)])];
      const rows=(await this.pool.query('SELECT id,kind FROM connections WHERE tenant_id=$1 AND id=ANY($2::text[]) AND deleted_at IS NULL',[tenant,ids])).rows;
      if(rows.length!==ids.length)throw new ExecutionError('connection_not_found',404);
      const kind=(id:string)=>rows.find(c=>c.id===id)?.kind;
      if(kind(bindings.sandbox_connection_id)!=='sandbox'||kind(bindings.model_connection_id)!=='model'||Object.values(bindings.tools).some(id=>kind(id)!=='tool')||Object.values(bindings.connections).some(id=>kind(id)!=='http'))throw new ExecutionError('connection_kind_mismatch',400);
      if(Object.keys(bindings.tools).some(name=>!definition.tools.some(t=>t.name===name)))throw new ExecutionError('undeclared_tool_binding',400);
    }
    return {definition,env};
  }
  async createAgent(tenant:string,input:z.input<typeof agentInput>){
    const {definition,env}=await this.validateAgent(tenant,input);
    const id = randomUUID();
    return transaction(this.pool, async db => {
      const secret = Object.keys(env).length ? await this.requireSecrets().save(tenant, `agent-env:${id}`, JSON.stringify(env), db) : null;
      const agent=(await db.query('INSERT INTO agents(tenant_id,id,name,definition,env_secret_id,env_names) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,definition,env_names,revision,archived_at,created_at,updated_at', [tenant, id, definition.name, definition, secret, JSON.stringify(Object.keys(env).sort())])).rows[0];
      await db.query('INSERT INTO agent_revisions SELECT tenant_id,id,revision,name,definition,env_secret_id,env_names,updated_at FROM agents WHERE tenant_id=$1 AND id=$2',[tenant,id]);
      return agent;
    });
  }
  async getAgent(tenant:string,id:string){
    const row=(await this.pool.query('SELECT id,name,definition,env_names,revision,archived_at,created_at,updated_at FROM agents WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];
    if(!row)throw new ExecutionError('agent_not_found',404);
    const revisions=(await this.pool.query('SELECT revision,name,definition,env_names,created_at FROM agent_revisions WHERE tenant_id=$1 AND id=$2 ORDER BY revision DESC',[tenant,id])).rows;
    return {...row,revisions};
  }
  async reviseAgent(tenant:string,id:string,input:unknown){
    const parsed=z.object({expected_revision:z.number().int().positive(),definition:agentInput}).strict().parse(input);
    const {definition,env}=await this.validateAgent(tenant,parsed.definition);
    return transaction(this.pool,async db=>{
      const old=(await db.query('SELECT * FROM agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
      if(!old)throw new ExecutionError('agent_not_found',404);
      if(old.archived_at)throw new ExecutionError('agent_archived',409);
      if(old.revision!==parsed.expected_revision)throw new ExecutionError('agent_revision_changed',409);
      const supplied=(input as {definition:Record<string,unknown>}).definition;
      const replacesEnv=Object.hasOwn(supplied,'variables')||Object.hasOwn(supplied,'env');
      const secret=replacesEnv?(Object.keys(env).length?await this.requireSecrets().save(tenant,`agent-env:${id}`,JSON.stringify(env),db):null):old.env_secret_id;
      const names=replacesEnv?Object.keys(env).sort():old.env_names;
      const row=(await db.query('UPDATE agents SET name=$3,definition=$4,env_secret_id=$5,env_names=$6,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,name,definition,env_names,revision,archived_at,created_at,updated_at',[tenant,id,definition.name,definition,secret,JSON.stringify(names)])).rows[0];
      await db.query('INSERT INTO agent_revisions SELECT tenant_id,id,revision,name,definition,env_secret_id,env_names,updated_at FROM agents WHERE tenant_id=$1 AND id=$2',[tenant,id]);
      return row;
    });
  }
  async archiveAgent(tenant:string,id:string){
    const row=(await this.pool.query('UPDATE agents SET archived_at=COALESCE(archived_at,now()),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,revision,archived_at',[tenant,id])).rows[0];
    if(!row)throw new ExecutionError('agent_not_found',404);return row;
  }
  async copyAgent(tenant:string,id:string,name:string){
    const source=(await this.pool.query('SELECT definition,env_secret_id FROM agents WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];
    if(!source)throw new ExecutionError('agent_not_found',404);
    const variables=source.env_secret_id?JSON.parse(await this.requireSecrets().read(tenant,source.env_secret_id,`agent-env:${id}`)):{};
    return this.createAgent(tenant,{...source.definition,name,variables});
  }
  async preflightDefinition(tenant:string,input:unknown){
    const parsed=z.object({definition:agentInput,bindings:agentBindings}).strict().parse(input);
    return this.create(tenant,{...parsed.bindings,agent_id:randomUUID()},true,parsed.definition);
  }
  private requireSecrets() { if (!this.secrets) throw new Error('environment_secret_store_unavailable'); return this.secrets; }
  async listAgents(tenant: string) {
    return (await this.pool.query('SELECT id,name,definition,env_names,revision,archived_at,created_at,updated_at FROM agents WHERE tenant_id=$1 ORDER BY created_at', [tenant])).rows;
  }
  async create(tenant: string, input: z.input<typeof sessionInput>, preflight=false, inline?:z.input<typeof agentInput>) {
    const parsed = sessionInput.parse(input);
    await this.ensureCredentials?.();
    const direct=parsed.harness?{name:parsed.name??'Session',identity:parsed.identity,instructions:parsed.instructions,context:parsed.context,harness:parsed.harness,resources:parsed.resources,network:parsed.network,required_capabilities:parsed.required_capabilities,tools:Object.keys(parsed.tools).map(name=>({name,required_at_start:!parsed.optional_tools.includes(name)}))}:undefined;
    const draft=inline||direct?await this.validateAgent(tenant,inline??direct!):undefined;
    return transaction(this.pool, async db => {
      const agent = draft?{definition:draft.definition,revision:null,env_secret_id:null}: (await db.query('SELECT definition,env_secret_id,revision,archived_at FROM agents WHERE tenant_id=$1 AND id=$2 FOR SHARE', [tenant, parsed.agent_id])).rows[0];
      if (!agent) throw new ExecutionError('agent_not_found', 404);
      if(agent.archived_at)throw new ExecutionError('agent_archived',409);
      if(parsed.agent_revision){const revision=(await db.query('SELECT definition,env_secret_id,revision FROM agent_revisions WHERE tenant_id=$1 AND id=$2 AND revision=$3',[tenant,parsed.agent_id,parsed.agent_revision])).rows[0];if(!revision)throw new ExecutionError('agent_revision_not_found',404);Object.assign(agent,revision);}
      const { env: _unused, variables: _variables, ...definition } = agentInput.parse(agent.definition);
      const harness = (await this.catalog(tenant)).find(h => h.id === definition.harness.id && h.version === definition.harness.version);
      if (!harness) throw new ExecutionError('unsupported_harness', 400);
      if (definition.tools.length && !harness.capabilities.includes('tools')) throw new ExecutionError('harness_tools_unsupported', 400);
      if (Object.keys(parsed.tools).some(name => !definition.tools.some(t => t.name === name))) throw new ExecutionError('undeclared_tool_binding', 400);
      if (definition.tools.some(t => !parsed.tools[t.name])) throw new ExecutionError('missing_tool_binding', 400);
      const ids = [...new Set([parsed.sandbox_connection_id, parsed.model_connection_id, ...Object.values(parsed.tools), ...Object.values(parsed.connections)])].sort();
      // Lock all bindings in a stable order against concurrent disable/delete/rotation.
      const rows = (await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=ANY($2::text[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE', [tenant, ids])).rows;
      if (rows.length !== ids.length) throw new ExecutionError('connection_not_found', 404);
      const sandbox = rows.find(c => c.id === parsed.sandbox_connection_id)!;
      const model = rows.find(c => c.id === parsed.model_connection_id)!;
      if (sandbox.kind !== 'sandbox' || model.kind !== 'model') throw new ExecutionError('connection_kind_mismatch', 400);
      for (const c of [sandbox, model]) if (!c.enabled || c.status !== 'ready') throw new ExecutionError('connection_not_ready', 409);
      for (const tool of definition.tools) {
        const c = rows.find(c => c.id === parsed.tools[tool.name])!;
        if (c.kind !== 'tool') throw new ExecutionError('connection_kind_mismatch', 400);
        if (tool.required_at_start && (!c.enabled || c.status !== 'ready')) throw new ExecutionError('tool_not_ready', 409);
      }
      if (!harness.model_providers.includes(model.provider)) throw new ExecutionError('incompatible_model', 400);
      for(const id of Object.values(parsed.connections)){const c=rows.find(c=>c.id===id);if(!c || c.kind!=='http')throw new ExecutionError('connection_kind_mismatch',400);if(!c.enabled||c.status!=='ready')throw new ExecutionError('connection_not_ready',409);}
      const provider = this.connections.adapter('sandbox', sandbox.provider);
      if(harness.image&&!provider.capabilities.includes('oci_image'))throw new ExecutionError('sandbox_oci_image_unsupported',400);
      if(harness.image?.registry_secret_id&&!provider.capabilities.includes('private_oci_image'))throw new ExecutionError('sandbox_private_image_unsupported',400);
      if(harness.image?.registry_secret_id){
        const secret=(await db.query('SELECT enabled FROM managed_secrets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[tenant,harness.image.registry_secret_id])).rows[0];
        if(!secret)throw new ExecutionError('secret_not_found',404);
        if(!secret.enabled)throw new ExecutionError('secret_disabled',409);
      }
      const initialization=compileInitialization(definition);
      const combination=resolveCombination({harness,sandboxCapabilities:provider.capabilities,
        modelProvider:model.provider,toolCapabilities:definition.tools.map(tool=>this.connections.adapter('tool',rows.find(c=>c.id===parsed.tools[tool.name])!.provider).capabilities),
        requiredCapabilities:definition.required_capabilities,initialization:Boolean(initialization),
        network:definition.network,credentialHost:new URL(accessOrigin()).hostname});
      if(combination.compatibility.reasons.length)throw new ExecutionError(combination.compatibility.reasons[0]!,400);
      const lifecycle={mode:provider.capabilities.includes('pause_resume')?'serverless':provider.capabilities.includes('automatic_standby')?'provider_managed':'retained',preservation:provider.capabilities.includes('filesystem_resume')?'filesystem':provider.capabilities.includes('pause_resume')?'memory':provider.capabilities.includes('automatic_standby')?'provider_managed':'none',automatic_wake:true,idle_timeout_seconds:Math.min(definition.resources.idle_timeout_seconds,definition.resources.timeout_seconds-10)};
      if(initialization&&!harness.capabilities.includes('initialization'))throw new ExecutionError('harness_initialization_unsupported',400);
      const pinned = { ...definition, ...(initialization?{initialization:{schema_version:1,digest:initialization.digest}}:{}), message_policy:'reject_if_busy', lifecycle, ...(harness.image?{harness_image:harness.image}:{}), credential_boundary:'external-v1', combination, capabilities: combination.capabilities, tool_bindings: parsed.tools, protected_api_bindings: parsed.connections, connections: rows.map(c => ({ id: c.id, name: c.name, kind: c.kind, provider: c.provider, version: c.version, config: c.config, ...(c.kind==='tool'&&c.validation?.account?{account:c.validation.account}:{}) })) };
      const id = randomUUID();
      const defaults = agent.env_secret_id ? JSON.parse(await this.requireSecrets().read(tenant, agent.env_secret_id, `agent-env:${parsed.agent_id}`, db)) : (draft?.env??{});
      if(parsed.variables && Object.keys(parsed.env).length)throw new ExecutionError('ambiguous_variables',400);
      const env = environmentInput.parse({ ...defaults, ...(parsed.variables??parsed.env) });
      if(preflight)return {ready:true,combination,readiness:{status:'ready',checked_at:new Date().toISOString()},lifecycle,connections:Object.fromEntries(['model',...Object.keys(parsed.connections)].map(name=>[name,{implementation:provider.capabilities.includes('native_credential_auth')?'external_proxy_with_native_auth':'external_proxy',raw_secret_in_sandbox:false,delegated_token_in_sandbox:!provider.capabilities.includes('native_credential_auth')}]))};
      const envSecret = Object.keys(env).length ? await this.requireSecrets().save(tenant, `session-env:${id}`, JSON.stringify(env), db) : null;
      const row = (await db.query('INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition,env_secret_id,env_names,agent_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,agent_id,agent_revision,definition,env_names,state,sandbox,created_at,updated_at', [tenant, id, parsed.agent_id??null, sandbox.id, model.id, pinned, envSecret, JSON.stringify(Object.keys(env).sort()),agent.revision])).rows[0];
      for (const [name, connection] of Object.entries(parsed.tools)) await db.query('INSERT INTO session_tools(tenant_id,session_id,name,connection_id) VALUES($1,$2,$3,$4)', [tenant, id, name, connection]);
      for(const [name,connection] of Object.entries(parsed.connections))await db.query('INSERT INTO session_connections(tenant_id,session_id,name,connection_id) VALUES($1,$2,$3,$4)',[tenant,id,name,connection]);
      return row;
    });
  }
  async get(tenant: string, id: string) {
    const result = await this.pool.query('SELECT id,agent_id,agent_revision,definition,env_names,state,pause_scope,sandbox,created_at,updated_at FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, id]);
    if (!result.rowCount) throw new ExecutionError('session_not_found', 404);
    return result.rows[0];
  }
  environment(tenant:string,id:string){return new SessionConfiguration(this.pool,this.requireSecrets()).environment(tenant,id);}
  authorization(tenant:string,id:string){return new SessionConfiguration(this.pool,this.requireSecrets()).authorization(tenant,id);}
  revokeConnection(tenant:string,id:string,connection:string){return new SessionConfiguration(this.pool,this.requireSecrets()).revoke(tenant,id,connection);}
  /** Historical effective initialization only; never resolves current Agent/connection configuration. */
  async initialization(tenant:string,id:string) {
    const session=await this.get(tenant,id);
    const bindings=session.definition.protected_api_bindings??Object.fromEntries((await this.pool.query(
      'SELECT name,connection_id FROM session_connections WHERE tenant_id=$1 AND session_id=$2',[tenant,id]
    )).rows.map(row=>[row.name,row.connection_id]));
    return {schema_version:1,session_id:session.id,created_at:session.created_at,
      source:{kind:session.agent_id?'agent':'direct',agent_id:session.agent_id,agent_revision:session.agent_revision},
      definition:{...session.definition,protected_api_bindings:bindings},
      environment:{names:session.env_names,values_redacted:true}};
  }
  async fleet(tenant: string) {
    return (await this.pool.query(`SELECT s.id,s.agent_id,s.definition,s.env_names,s.state,s.sandbox,s.created_at,s.updated_at,
      CASE WHEN s.state='closed' THEN 'stopped' ELSE rt.state END AS runtime_state,
      CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'state',r.state,'updated_at',r.updated_at) END AS latest_run,
      COALESCE(ops.items, '[]'::jsonb) AS resource_operations
      FROM sessions s LEFT JOIN session_runtimes rt ON rt.tenant_id=s.tenant_id AND rt.session_id=s.id
      LEFT JOIN LATERAL (SELECT id,state,updated_at FROM runs WHERE tenant_id=s.tenant_id AND session_id=s.id ORDER BY created_at DESC LIMIT 1) r ON true
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'state',state,'provider_resource_id',provider_resource_id,'reason',CASE WHEN state IN ('unknown','rejected') THEN detail->>'reason' ELSE NULL END,'updated_at',updated_at) ORDER BY created_at,id) AS items FROM resource_operations WHERE tenant_id=s.tenant_id AND session_id=s.id) ops ON true
      WHERE s.tenant_id=$1 ORDER BY s.created_at DESC LIMIT 200`, [tenant])).rows;
  }
  async list(tenant: string) {
    return (await this.pool.query('SELECT id,agent_id,agent_revision,definition,env_names,state,sandbox,created_at,updated_at FROM sessions WHERE tenant_id=$1 ORDER BY created_at DESC', [tenant])).rows;
  }
}
