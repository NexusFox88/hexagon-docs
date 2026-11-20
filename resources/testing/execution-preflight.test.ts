import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase } from '../modules/storage/database.js';
import { SecretCipher, SecretStore } from '../modules/credentials/secret-store.js';
import { tokenDigest } from '../modules/credentials/api-auth.js';
import { Connections } from '../modules/connections/connections.js';
import { Sessions } from '../modules/execution/sessions.js';
import { HarnessRegistry } from '../modules/execution/harness.js';
import { SandboxLifecycle } from '../modules/sandboxes/lifecycle.js';
import { createServer } from '../apps/control-plane/server.js';
import { Hexagon } from '../sdk/typescript/index.js';
import { e2bConnection } from '../integrations/sandboxes/e2b.js';
import { instaboxConnection } from '../integrations/sandboxes/instabox.js';
import { sandboxConnections } from '../integrations/sandboxes/registry.js';
import { anthropicModelConnection } from '../integrations/models/anthropic-compatible.js';
import { httpToolConnection } from '../integrations/tools/http-json.js';
import { openCodeAdapter } from '../integrations/harnesses/opencode.js';
import { piAdapter } from '../integrations/harnesses/pi.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Execution combination preflight through public HTTP', () => {
  it('discovers capabilities, rejects unsupported combinations and preserves selected policy', async () => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = randomUUID(), token = randomUUID();
    const secrets = new SecretStore(pool, new SecretCipher(randomBytes(32)));
    // Keep the actual config schemas and declared capabilities; credential checks
    // are controlled here because this test must stop before cloud execution.
    const validate = async () => ({ operations: ['controlled_validation'] });
    const connections = new Connections(pool, secrets, [e2bConnection, instaboxConnection, anthropicModelConnection, httpToolConnection].map(a => ({ ...a, validate })).concat([
      { kind: 'model', provider: 'incompatible-fixture', config: z.object({}), capabilities: [], validate },
      { kind: 'tool', provider: 'no-approval-fixture', config: z.object({}), capabilities: [], validate },
    ]));
    const registry = new HarnessRegistry([openCodeAdapter, piAdapter, { ...openCodeAdapter, definition: { id: 'conversation-only', version: '1', capabilities: ['conversation'], model_providers: ['anthropic-compatible'] } }]);
    const sessions = new Sessions(pool, connections, registry);
    let cloudOperations = 0;
    const lifecycle = new SandboxLifecycle(pool, secrets, () => { cloudOperations++; throw new Error('Preflight must not reach provider'); });
    const app = createServer(pool, { connections, sessions, lifecycle });
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      await pool.query("INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,'test')", [tokenDigest(token), tenant]);
      const supported = new Connections(pool, secrets, sandboxConnections);
      expect(supported.catalog().filter(c => c.kind === 'sandbox')).toHaveLength(11);
      expect(supported.catalog().some(c => c.provider === 'daytona')).toBe(false);
      await expect(supported.create(tenant, {kind:'sandbox',provider:'daytona',name:'Candidate'})).rejects.toMatchObject({code:'unsupported_connection_provider'});
      const client = new Hexagon(await app.listen({ host: '127.0.0.1', port: 0 }), token);
      const catalog = await client.catalog();
      expect(catalog.harnesses.find((h:any)=>h.id===openCodeAdapter.definition.id)).toMatchObject(openCodeAdapter.definition);
      expect(catalog.harnesses.find((h:any)=>h.id===piAdapter.definition.id)).toMatchObject(piAdapter.definition);
      expect(catalog.connections.find((c: any) => c.provider === 'e2b').capabilities).toContain('network_allowlist');
      expect(catalog.connections.find((c: any) => c.provider === 'instabox').capabilities).not.toContain('network_allowlist');
      expect(catalog.connections.find((c: any) => c.provider === 'http-json').capabilities).toContain('approval');
      async function ready(kind: string, provider: string, config: unknown = {}) {
        const row = await client.createConnection({ kind, provider, name: provider, config, credential: 'controlled-fixture' });
        await client.validateConnection(row.id); return client.updateConnection(row.id, { enabled: true });
      }
      const sandbox = await ready('sandbox', 'e2b', { template: 'pinned-template' });
      const alternate = await ready('sandbox', 'instabox');
      const model = await ready('model', 'anthropic-compatible', { base_url: 'https://model.example.test', model: 'selected-model' });
      const incompatible = await ready('model', 'incompatible-fixture');
      const tool = await ready('tool', 'http-json', { base_url: 'https://tool.example.test', operations: { read: { method: 'GET', path: '/read', description: 'Read' } } });
      const unapprovedTool = await ready('tool', 'no-approval-fixture');
      const definition = { name: 'Preflight', harness: { id: 'opencode', version: '1.2.27' }, required_capabilities: ['files', 'commands', 'preview', 'conversation', 'tools', 'approval'], tools: [{ name: 'report' }], resources: { timeout_seconds: 180 }, network: { mode: 'allowlist' as const, allowed_hosts: ['model.example.test', 'tool.example.test', new URL(process.env.HEXAGON_ACCESS_URL!).hostname] } };
      const agent = await client.createAgent(definition);
      const input = { agent_id: agent.id, sandbox_connection_id: sandbox.id, model_connection_id: model.id, tools: { report: tool.id } };
      await expect(client.createAgent({ ...definition, harness: { id: 'opencode', version: 'unknown' } })).rejects.toMatchObject({ code: 'unsupported_harness' });
      await expect(client.createAgent({ ...definition, harness: { id: 'conversation-only', version: '1' } })).rejects.toMatchObject({ code: 'harness_tools_unsupported' });
      await expect(client.createSession({ ...input, model_connection_id: incompatible.id })).rejects.toMatchObject({ code: 'incompatible_model' });
      await expect(client.createSession({ ...input, sandbox_connection_id: alternate.id })).rejects.toMatchObject({ code: 'network_policy_unsupported' });
      await expect(client.createSession({ ...input, tools: { report: unapprovedTool.id } })).rejects.toMatchObject({ code: 'missing_capability' });
      await expect(client.createSession({ ...input, tools: {} })).rejects.toMatchObject({ code: 'missing_tool_binding' });
      await expect(client.createSession({ ...input, tools: { report: tool.id, undeclared: tool.id } })).rejects.toMatchObject({ code: 'undeclared_tool_binding' });
      const missing = await client.createAgent({ ...definition, required_capabilities: ['snapshot'] });
      await expect(client.createSession({ ...input, agent_id: missing.id })).rejects.toMatchObject({ code: 'missing_capability' });
      expect((await client.request('GET', '/sessions')).sessions).toEqual([]);
      const blocked = await client.createAgent({...definition,network:{mode:'allowlist',allowed_hosts:['model.example.test']}});
      await expect(client.preflightSession({...input,agent_id:blocked.id})).rejects.toMatchObject({code:'credential_proxy_not_allowed_by_network_policy'});
      const preflight = await client.preflightSession(input);
      expect(preflight).toMatchObject({ready:true,readiness:{status:'ready'},combination:{schema_version:1,compatibility:{status:'supported',reasons:[]},verification:{status:'unverified',evidence:[]}}});
      expect(Number.isFinite(Date.parse(preflight.readiness.checked_at))).toBe(true);
      expect((await client.listSessions()).sessions).toEqual([]);
      const session = await client.createSession(input);
      expect(session.definition.combination).toEqual(preflight.combination);
      expect((await client.sessionInitialization(session.id)).definition.combination).toEqual(preflight.combination);
      expect(session.definition.resources).toEqual({...definition.resources,idle_timeout_seconds:60});
      expect(session.definition.network).toEqual(definition.network);
      expect(session.definition.harness).toEqual(definition.harness);
      expect(session.definition.tool_bindings).toEqual(input.tools);
      expect(session.definition.capabilities).toEqual(expect.arrayContaining(definition.required_capabilities));
      expect(session.definition.connections.find((c: any) => c.id === sandbox.id)).toMatchObject({ version: sandbox.version, config: sandbox.config });
      expect(session.definition.connections.find((c: any) => c.id === tool.id)).toMatchObject({ version: tool.version, config: tool.config });
      const secondSession=await client.createSession(input);
      const page1=await client.listSessions({limit:1});expect(page1.sessions).toHaveLength(1);expect(page1.next_offset).toBe(1);
      const page2=await client.listSessions({limit:1,offset:page1.next_offset});expect(page2.sessions).toHaveLength(1);expect(page2.next_offset).toBe(null);expect(page1.sessions[0].id).not.toBe(page2.sessions[0].id);
      expect((await client.listSessions({search:session.id,state:'open'})).sessions.map((s:any)=>s.id)).toEqual([session.id]);
      expect((await client.listSessions({state:'closed'})).sessions).toEqual([]);
      expect(await client.overview()).toMatchObject({open_sessions:2,active_runs:0});expect((await client.pending()).items).toEqual([]);
      const taskText='Find the onboarding result by readable task text';
      const listedRun=await client.submit(secondSession.id,taskText,'journey-list-query');
      const taskResults=await client.listRuns({search:'onboarding result'});
      expect(taskResults.runs).toHaveLength(1);
      expect(taskResults.runs[0]).toMatchObject({id:listedRun.id,input_preview:taskText,agent_name:definition.name});
      expect((await client.listRuns({search:definition.name})).runs.map((r:any)=>r.id)).toContain(listedRun.id);
      await pool.query("UPDATE runs SET state='completed' WHERE tenant_id=$1 AND id=$2",[tenant,listedRun.id]);
      await client.close(secondSession.id);
      const before=(await client.listAgents()).agents.length;
      const bindings={sandbox_connection_id:sandbox.id,model_connection_id:model.id,tools:{report:tool.id}};
      expect(await client.preflightAgent(definition,bindings)).toMatchObject({ready:true});
      expect((await client.listAgents()).agents).toHaveLength(before);
      const revised=await client.reviseAgent(agent.id,{...definition,name:'Revision two',resources:{timeout_seconds:300},bindings},1);
      expect(revised.revision).toBe(2);
      await expect(client.reviseAgent(agent.id,definition,1)).rejects.toMatchObject({code:'agent_revision_changed'});
      expect((await client.agent(agent.id)).revisions).toHaveLength(2);
      expect((await client.session(session.id)).agent_revision).toBe(1);
      expect((await client.session(session.id)).definition.resources.timeout_seconds).toBe(180);
      const copy=await client.copyAgent(agent.id,'Independent copy');
      expect(copy.revision).toBe(1);expect(copy.definition.bindings).toMatchObject(bindings);
      await client.archiveAgent(agent.id);
      await expect(client.createSession(input)).rejects.toMatchObject({code:'agent_archived'});
      expect((await client.session(session.id)).definition).toEqual(session.definition);
      await client.updateConnection(sandbox.id, { config: { template: 'later-template' } });
      expect((await client.session(session.id)).definition).toEqual(session.definition);
      expect(cloudOperations).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS count FROM resource_operations WHERE tenant_id=$1', [tenant])).rows[0].count).toBe(0);
      await client.close(session.id);
      // Direct sessions pin execution parameters without creating an Agent resource.
      const directInput={harness:definition.harness,sandbox_connection_id:alternate.id,model_connection_id:model.id,name:'Direct conversation',tools:{report:tool.id},optional_tools:['report']};
      const agentCount=(await client.listAgents()).agents.length;
      expect(await client.preflightSession(directInput)).toMatchObject({ready:true});
      await expect(client.createSession({...directInput,agent_id:copy.id})).rejects.toMatchObject({code:'invalid_request'});
      await expect(client.createSession({...directInput,optional_tools:['missing']})).rejects.toMatchObject({code:'invalid_request'});
      const direct=await client.createSession(directInput);
      expect(direct).toMatchObject({agent_id:null,agent_revision:null});
      expect(direct.definition).toMatchObject({name:'Direct conversation',harness:definition.harness,tool_bindings:{report:tool.id}});
      expect((await client.listAgents()).agents).toHaveLength(agentCount);
      expect((await client.listSessions({search:'Direct conversation'})).sessions.map((s:any)=>s.id)).toEqual([direct.id]);
      expect((await client.listSessions({search:secondSession.id})).sessions[0].latest_run).toMatchObject({id:listedRun.id,state:'completed',input_preview:taskText});
      await client.close(direct.id);
    } finally {
      await app.close();
      for (const table of ['events','runs','session_tools', 'sessions', 'agents', 'connections', 'secrets', 'api_keys', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
      await pool.end();
    }
  });
});
