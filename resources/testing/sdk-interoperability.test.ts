import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
const { Hexagon } = await import(process.env.HEXAGON_TEST_TS_MODULE || '../sdk/typescript/index.js') as typeof import('../sdk/typescript/index.js');
import { openDatabase } from '../modules/storage/database.js';
import { SecretCipher, SecretStore } from '../modules/credentials/secret-store.js';
import { tokenDigest } from '../modules/credentials/api-auth.js';
import { Connections, type ConnectionAdapter } from '../modules/connections/connections.js';
import { Sessions } from '../modules/execution/sessions.js';
import { SandboxLifecycle } from '../modules/sandboxes/lifecycle.js';
import { createServer } from '../apps/control-plane/server.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Python/TypeScript public SDK interoperability', () => {
  it('shares Sessions both ways, uploads bytes and reconnects persisted SSE cursors', async () => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = `sdk-test-${randomUUID()}`;
    const token = randomUUID();
    const secrets = new SecretStore(pool, new SecretCipher(randomBytes(32)));
    const adapters: ConnectionAdapter[] = ['sandbox', 'model'].map(kind => ({ kind: kind as 'sandbox' | 'model', provider: 'fixture', config: z.object({}).strict(), capabilities: [], async validate() { return { operations: ['fixture'] }; } }));
    const connections = new Connections(pool, secrets, adapters);
    const sessions = new Sessions(pool, connections, [{ id: 'fixture', version: '1', capabilities: ['initialization'], model_providers: ['fixture'] }], secrets);
    const lifecycle = new SandboxLifecycle(pool, secrets, () => { throw new Error('No cloud operations in this protocol test'); });
    const app = createServer(pool, { connections, sessions, lifecycle });
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      await pool.query("INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,'test')", [tokenDigest(token), tenant]);
      const base = await app.listen({ host: '127.0.0.1', port: 0 });
      const client = new Hexagon(base, token);
      const catalog = await client.applications();
      expect(catalog.applications).toHaveLength(37);
      expect(catalog.applications.find((item: any) => item.id === 'trello').credential_fields.map((field: any) => field.name)).toEqual(['api_key', 'token']);
      await client.configureApplicationOAuth('notion', {client_id:'sdk-client',client_secret:'sdk-oauth-private',redirect_uri:`${base}/oauth/callback`});
      expect(JSON.stringify(await client.applications())).not.toContain('sdk-oauth-private');
      const appConnection = await client.createConnection({kind:'tool',provider:'notion',name:'SDK OAuth fixture',config:{authentication:'oauth',operations:['read_page']}});
      const appFlow = await client.authorizeConnection(appConnection.id);
      expect(new URL(appFlow.authorization_url).origin).toBe('https://api.notion.com');
      expect((await client.authorizationFlow(appFlow.id)).status).toBe('pending');
      const packageInput = { id: 'custom.sdk-fixture', version: '1', protocol: 'hexagon-json-v1', interpreter: 'python3', entrypoint: 'main.py',
        capabilities: [], model_providers: ['anthropic-compatible'], files: [{ path: 'main.py', content: '# protocol fixture only' }] };
      const registered = await client.registerHarnessPackage(packageInput);
      const ids: Record<string, string> = {};
      for (const kind of ['sandbox', 'model']) {
        const row = await client.createConnection({ kind, provider: 'fixture', name: kind, credential: 'fixture' });
        await client.validateConnection(row.id); await client.updateConnection(row.id, { enabled: true }); ids[kind] = row.id;
      }
      const managed = await client.createSecret({name:'SDK credential',value:'sdk-secret-original'});
      expect(JSON.stringify(await client.listSecrets())).not.toContain('sdk-secret-original');
      const http = await client.createConnection({kind:'http',provider:'http',name:'SDK HTTP',secret_id:managed.id,config:{endpoint:'https://example.com',authentication:{type:'bearer'},access:{rules:[{methods:['GET'],path:'/data'}]}}});
      await client.validateConnection(http.id);await client.updateConnection(http.id,{enabled:true});
      const agent = await client.createAgent({ name: 'Protocol fixture',identity:{name:'Atlas'},instructions:'Cite evidence',context:{text:'ORBIT'}, harness: { id: 'fixture', version: '1' }, env: { APP_MODE: 'default-value', DEFAULT_ONLY: 'inherited-value' } });
      const definition = { agent_id: agent.id, sandbox_connection_id: ids.sandbox!, model_connection_id: ids.model!,connections:{data:http.id} };
      expect((await client.preflightSession(definition)).ready).toBe(true);
      const session = await client.createSession({ ...definition, env: { APP_MODE: 'typescript-value' } });
      expect(session.env_names).toEqual(['APP_MODE', 'DEFAULT_ONLY']);
      expect(await client.pause(session.id)).toMatchObject({state:'paused',compute_paused:false});
      expect((await client.session(session.id)).state).toBe('paused');
      await client.resume(session.id);
      expect((await client.sessionActivity('24h')).buckets).toHaveLength(24);

      expect(await client.sessionEnvironment(session.id)).toMatchObject({env:{APP_MODE:'typescript-value',DEFAULT_ONLY:'inherited-value'}});
      expect((await client.sessionAuthorization(session.id)).connections.find((c:any)=>c.id===http.id).state).toBe('ready');
      const initialization=await client.sessionInitialization(session.id);
      expect(initialization.definition.identity).toEqual({name:'Atlas'});
      expect(initialization.definition.instructions).toBe('Cite evidence');
      expect(initialization.source).toEqual({kind:'agent',agent_id:agent.id,agent_revision:1});
      expect(initialization.environment).toEqual({names:['APP_MODE','DEFAULT_ONLY'],values_redacted:true});
      expect(initialization.definition.protected_api_bindings).toEqual({data:http.id});
      expect(initialization.definition.connections.find(c=>c.id===ids.model)?.name).toBe('model');
      expect(JSON.stringify(initialization)).not.toContain('typescript-value');
      expect(JSON.stringify(initialization)).not.toContain('sdk-secret-original');
      await client.updateConnection(ids.model!,{name:'Renamed current connection'});
      await client.reviseAgent(agent.id,{name:'Revised Agent',harness:{id:'fixture',version:'1'}},1);
      expect(await client.sessionInitialization(session.id)).toEqual(initialization);
      const historical=await client.createSession({...definition,agent_revision:1});expect(historical.definition.instructions).toBe('Cite evidence');await client.close(historical.id);
      await expect(client.createSession({...definition,agent_revision:999})).rejects.toMatchObject({code:'agent_revision_not_found'});
      // Existing sessions stored protected binding names in the immutable join table.
      await pool.query("UPDATE sessions SET definition=definition-'protected_api_bindings' WHERE tenant_id=$1 AND id=$2",[tenant,session.id]);
      expect(await client.sessionInitialization(session.id)).toEqual(initialization);
      await expect(sessions.initialization('foreign-tenant',session.id)).rejects.toMatchObject({code:'session_not_found'});

      expect(JSON.stringify(session)).not.toContain('typescript-value');
      const stored = (await pool.query('SELECT env_secret_id,definition FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, session.id])).rows[0];
      expect(JSON.parse(await secrets.read(tenant, stored.env_secret_id, `session-env:${session.id}`))).toEqual({ APP_MODE: 'typescript-value', DEFAULT_ONLY: 'inherited-value' });
      expect(JSON.stringify(stored.definition)).not.toContain('typescript-value');
      const ciphertext = (await pool.query('SELECT envelope FROM secrets WHERE tenant_id=$1 AND id=$2', [tenant, stored.env_secret_id])).rows[0].envelope;
      expect(JSON.stringify(ciphertext)).not.toContain('typescript-value');
      await expect(secrets.read('another-tenant', stored.env_secret_id, `session-env:${session.id}`)).rejects.toThrow();
      await expect(secrets.read(tenant, stored.env_secret_id, `session-env:another-session`)).rejects.toThrow();
      await expect(client.createSession({ ...definition, env: { HEXAGON_RUNTIME_TOKEN: 'not-allowed' } })).rejects.toMatchObject({ code: 'invalid_request' });
      await client.upload(session.id, [{ path: 'input.txt', content_base64: Buffer.from('TS upload').toString('base64') }]);
      const first = await client.submit(session.id, 'Protocol fixture only', 'first',{channel:'fixture',message_id:'external-message'});
      expect(first.origin).toEqual({channel:'fixture',message_id:'external-message'});expect(first.execution_identity?.tenant_id).toBe(tenant);expect(first.execution_identity?.agent_revision).toBe(1);
      const stream = client.stream(first.id);
      const head = await stream.next();
      expect(head.value?.type).toBe('run.queued');
      await stream.return(undefined);
      expect((await client.run(first.id)).state).toBe('queued');
      expect((await client.toolCalls(first.id)).calls).toEqual([]);
      await expect(client.resolveToolCall(first.id, randomUUID(), { request_hash: '0'.repeat(64), outcome: 'failed', text: 'Fixture', evidence: 'Missing call' })).rejects.toMatchObject({ code: 'tool_call_not_found' });
      await client.cancel(first.id);
      const resumed = [];
      for await (const event of client.stream(first.id, head.value!.id!)) resumed.push(event);
      expect(resumed.map(e => e.type)).toEqual(['run.cancelled', 'stream.end']);

      const result = await python({ base, token, session: session.id, run: first.id, definition, secret:managed.id, package: packageInput, app_flow:appFlow.id });
      expect((await client.authorizationFlow(appFlow.id)).status).toBe('cancelled');
      expect((await client.authorizationFlow(result.app_flow)).status).toBe('pending');
      expect((await client.cancelAuthorization(result.app_flow)).status).toBe('cancelled');
      expect(JSON.stringify(await client.applications())).not.toContain('python-oauth-private');
      expect(result.package_digest).toBe(registered.digest);
      expect(result.observed_ts_state).toBe('cancelled');
      expect(result.stream_types).toEqual(['run.queued', 'run.cancelled', 'stream.end']);
      expect((await client.session(result.session)).env_names).toEqual(['APP_MODE', 'DEFAULT_ONLY', 'PYTHON_ONLY']);
      const pythonStored = (await pool.query('SELECT env_secret_id FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, result.session])).rows[0];
      expect(JSON.parse(await secrets.read(tenant, pythonStored.env_secret_id, `session-env:${result.session}`))).toEqual({ APP_MODE: 'python-value', DEFAULT_ONLY: 'inherited-value', PYTHON_ONLY: 'python-added' });
      const continued = await client.submit(result.session, 'TS continues Python Session', 'cross-language');
      expect(continued.session_id).toBe(result.session);
      await client.cancel(continued.id);
      await client.close(result.session); await client.close(session.id);
      const changed=await client.updateSecret(managed.id,{value:'sdk-secret-rotated'});expect(changed.version).toBe(2);
      await client.deleteConnection(http.id);await client.deleteSecret(managed.id);
    } finally {
      await app.close();
      for (const table of ['session_lifecycle_events','application_oauth_flows','application_oauth_clients','access_grants','session_connections','events', 'runs', 'session_inputs', 'sessions', 'agents', 'connections', 'managed_secrets','secrets', 'api_keys', 'harness_packages', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
      await pool.end();
    }
  }, 20000);
});

function python(config: unknown): Promise<any> {
  const script = `import json,sys
from hexagon import Hexagon, HexagonError
c=json.load(sys.stdin)
h=Hexagon(c['base'],c['token'])
catalog=h.applications()
assert len(catalog['applications'])==37
assert h.authorization_flow(c['app_flow'])['status']=='pending'
assert h.cancel_authorization(c['app_flow'])['status']=='cancelled'
h.configure_application_oauth('google-calendar',client_id='python-client',client_secret='python-oauth-private',redirect_uri=c['base']+'/oauth/callback')
assert 'python-oauth-private' not in json.dumps(h.applications())
app_connection=h.create_connection(kind='tool',provider='google-calendar',name='Python OAuth fixture',config={'authentication':'oauth','operations':['list_calendars']})
app_flow=h.authorize_connection(app_connection['id'])
assert h.authorization_flow(app_flow['id'])['status']=='pending'
assert 'code_challenge=' in app_flow['authorization_url']
registered=h.register_harness_package(**c['package'])
assert h.secret(c['secret'])['name']=='SDK credential'
assert 'sdk-secret-original' not in json.dumps(h.list_secrets())
temp=h.create_secret(name='Python credential',value='python-secret')
assert h.update_secret(temp['id'],name='Renamed')['name']=='Renamed'
h.delete_secret(temp['id'])
assert h.preflight_session(**c['definition'])['ready']
grant=h.create_access(c['session'],c['definition']['connections']['data'])
assert len(grant['token'])==64
assert 'token' not in json.dumps(h.list_access(c['session']))
h.revoke_access(grant['id'])

a=h.create_agent(name='Python env fixture',harness={'id':'fixture','version':'1'},env={'PY_DEFAULT':'python-agent-default'})
assert a['env_names']==['PY_DEFAULT']
assert 'python-agent-default' not in json.dumps(a)
snapshot=h.session_initialization(c['session'])
assert h.session_environment(c['session'])['env']['APP_MODE']=='typescript-value'
assert h.session_authorization(c['session'])['session_id']==c['session']
assert snapshot['schema_version']==1
assert snapshot['source']['agent_revision']==1
assert snapshot['definition']['protected_api_bindings']=={'data':c['definition']['connections']['data']}
assert snapshot['environment']=={'names':['APP_MODE','DEFAULT_ONLY'],'values_redacted':True}
assert 'typescript-value' not in json.dumps(snapshot)
assert h.tool_calls(c['run'])['calls']==[]
try:
 h.resolve_tool_call(c['run'],'00000000-0000-4000-8000-000000000001',request_hash='0'*64,outcome='failed',text='Fixture',evidence='Missing call')
 raise AssertionError('missing call accepted')
except HexagonError as error:
 assert error.code=='tool_call_not_found'
observed=h.run(c['run'])['state']
follow=h.submit(c['session'],'Python continues TS Session','python-follow')
h.cancel(follow['id'])
s=h.create_session(**c['definition'],env={'APP_MODE':'python-value','PYTHON_ONLY':'python-added'})
assert h.pause(s['id'])['state']=='paused'
assert h.session(s['id'])['state']=='paused'
assert h.resume(s['id'])['state']=='open'
assert len(h.session_activity('7d')['buckets'])==7
assert s['env_names']==['APP_MODE','DEFAULT_ONLY','PYTHON_ONLY']
assert 'python-value' not in json.dumps(s)
h.upload(s['id'],{'python.txt':b'Python upload'})
r=h.submit(s['id'],'Python protocol fixture','first')
assert h.submit(s['id'],'Python protocol fixture','first')['id']==r['id']
h.cancel(r['id'])
events=list(h.stream(r['id']))
assert list(h.stream(r['id'],events[0]['id']))==events[1:]
print(json.dumps({'app_flow':app_flow['id'],'package_digest':registered['digest'],'session':s['id'],'observed_ts_state':observed,'stream_types':[e['type'] for e in events]}))
`;
  return new Promise((done, reject) => {
    const child = spawn('python3', ['-c', script], { env: { ...process.env, PYTHONPATH: process.env.HEXAGON_TEST_PYTHON_PATH || resolve('sdk/python') }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => { if (code !== 0) reject(new Error(`Python SDK protocol test exited ${code}`)); else { try { done(JSON.parse(output)); } catch (error) { reject(error); } } });
    child.stdin.end(JSON.stringify(config));
  });
}
