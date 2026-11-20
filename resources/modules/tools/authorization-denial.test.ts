import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { tokenDigest } from '../credentials/api-auth.js';
import { Connections, type ConnectionAdapter } from '../connections/connections.js';
import { Sessions } from '../execution/sessions.js';
import { Runs } from '../execution/runs.js';
import { SandboxLifecycle } from '../sandboxes/lifecycle.js';
import { httpToolConnection } from '../../integrations/tools/http-json.js';
import { createServer } from '../../apps/control-plane/server.js';
const { Hexagon } = await import(process.env.HEXAGON_TEST_TS_MODULE || '../../sdk/typescript/index.js') as typeof import('../../sdk/typescript/index.js');
import { ToolBroker } from './broker.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Per-invocation authorization refusal', () => {
  it('delivers a durable error through both SDKs without external writes or credential changes', async () => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = `deny-${randomUUID()}`, other = `other-${randomUUID()}`;
    const token = randomUUID(), otherToken = randomUUID();
    const secrets = new SecretStore(pool, new SecretCipher(randomBytes(32)));
    const service = Fastify(); let writes = 0;
    service.post('/write', async () => { writes++; return { saved: true }; });
    const adapters: ConnectionAdapter[] = ['sandbox', 'model'].map(kind => ({ kind: kind as 'sandbox' | 'model', provider: 'fixture', config: z.object({}), capabilities: [], async validate() { return { operations: [] }; } }));
    const connections = new Connections(pool, secrets, [...adapters, httpToolConnection]);
    const sessions = new Sessions(pool, connections, [{ id: 'fixture', version: '1', capabilities: ['tools'], model_providers: ['fixture'] }]);
    const lifecycle = new SandboxLifecycle(pool, secrets, () => { throw new Error('No cloud calls expected'); });
    const app = createServer(pool, { connections, sessions, lifecycle });
    const runs = new Runs(pool), broker = new ToolBroker(pool, secrets);
    try {
      const target = await service.listen({ host: '127.0.0.1', port: 0 });
      for (const [id, key] of [[tenant, token], [other, otherToken]]) {
        await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [id]);
        await pool.query("INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,'test')", [tokenDigest(key!), id]);
      }
      const base = await app.listen({ host: '127.0.0.1', port: 0 });
      const client = new Hexagon(base, token), foreign = new Hexagon(base, otherToken);
      const ids: Record<string, string> = {};
      for (const kind of ['sandbox', 'model'] as const) {
        const row = await connections.create(tenant, { kind, name: kind, provider: 'fixture', credential: 'fixture' });
        await connections.validate(tenant, row.id); await connections.patch(tenant, row.id, { enabled: true }); ids[kind] = row.id;
      }
      const tool = await connections.create(tenant, { kind: 'tool', name: 'Unconnected reports', provider: 'http-json', config: { base_url: target, operations: { write: { path: '/write', method: 'POST', description: 'Report write', approval: true } } } });
      const before = await connections.get(tenant, tool.id);
      const agent = await sessions.createAgent(tenant, { name: 'deny', harness: { id: 'fixture', version: '1' }, tools: [{ name: 'reports', required_at_start: false }] });
      const session = await sessions.create(tenant, { agent_id: agent.id, sandbox_connection_id: ids.sandbox!, model_connection_id: ids.model!, tools: { reports: tool.id } });
      const run = await runs.submit(tenant, session.id, 'first', 'Write report');
      const lease = await runs.claim('deny-worker');
      await runs.advance(lease, 'provisioning'); await runs.advance(lease, 'running');
      const call = { id: randomUUID(), binding: 'reports', operation: 'write', arguments: {} };
      expect((await broker.process(lease, call)).state).toBe('waiting_authorization');
      const hash = (await client.toolCalls(run.id)).calls[0].request_hash;
      await expect(foreign.denyToolAuthorization(run.id, call.id, hash)).rejects.toMatchObject({ code: 'run_not_found' });
      await expect(client.denyToolAuthorization(run.id, call.id, '0'.repeat(64))).rejects.toMatchObject({ code: 'tool_call_conflict' });
      const lock = await pool.connect();
      try {
        await lock.query('SELECT pg_advisory_lock(hashtextextended($1,1))', [JSON.stringify([tenant, run.id, call.id])]);
        await expect(client.denyToolAuthorization(run.id, call.id, hash)).rejects.toMatchObject({ code: 'tool_call_in_flight' });
      } finally { await lock.query('SELECT pg_advisory_unlock_all()'); lock.release(); }
      const denied = await client.denyToolAuthorization(run.id, call.id, hash);
      expect(denied.result).toMatchObject({ isError: true, code: 'tool_authorization_denied' });
      expect(await client.denyToolAuthorization(run.id, call.id, hash)).toEqual(denied);
      expect((await client.run(run.id)).state).toBe('running');
      expect((await broker.process(lease, call)).result).toEqual(denied.result);
      // A new invocation is independent; Python exercises the successful API path.
      const second = { ...call, id: randomUUID() };
      expect((await broker.process(lease, second)).state).toBe('waiting_authorization');
      const secondHash = (await client.toolCalls(run.id)).calls.find((item: any) => item.id === second.id).request_hash;
      await python({ base, token, run: run.id, call: second.id, hash: secondHash });
      expect((await broker.process(lease, second)).result).toMatchObject({ code: 'tool_authorization_denied' });
      const third = { ...call, id: randomUUID() };
      await broker.process(lease, third);
      await runs.cancel(tenant, run.id);
      await expect(client.denyToolAuthorization(run.id, third.id, hash)).rejects.toMatchObject({ code: 'tool_run_not_active' });
      expect((await client.run(run.id)).state).toBe('cancelling');
      await runs.advance(lease, 'cancelled');
      expect(await client.denyToolAuthorization(run.id, call.id, hash)).toEqual(denied);
      expect((await client.run(run.id)).state).toBe('cancelled');
      expect(await connections.get(tenant, tool.id)).toEqual(before);
      expect(writes).toBe(0);
      const events = await runs.events(tenant, run.id);
      expect(events.filter(event => event.type === 'authorization.denied')).toHaveLength(2);
      expect(events.filter(event => event.type === 'tool.completed')).toHaveLength(2);
      expect((await pool.query('SELECT * FROM approvals WHERE tenant_id=$1', [tenant])).rowCount).toBe(0);
    } finally {
      await app.close(); await service.close();
      for (const table of ['tool_calls', 'events', 'approvals', 'runs', 'session_tools', 'sessions', 'agents', 'connections', 'secrets', 'api_keys', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=ANY($1::text[])`, [[tenant, other]]);
      await pool.end();
    }
  }, 20000);
});

function python(config: unknown): Promise<void> {
  const script = `import json,sys
from hexagon import Hexagon
c=json.load(sys.stdin)
h=Hexagon(c['base'],c['token'])
a=h.deny_tool_authorization(c['run'],c['call'],c['hash'])
assert a['result']['code']=='tool_authorization_denied'
assert a==h.deny_tool_authorization(c['run'],c['call'],c['hash'])
assert h.run(c['run'])['state']=='running'
`;
  return new Promise((done, reject) => {
    const child = spawn('python3', ['-c', script], { env: { ...process.env, PYTHONPATH: process.env.HEXAGON_TEST_PYTHON_PATH || resolve('sdk/python') }, stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', data => { errors += data; });
    child.on('error', reject); child.on('close', code => code === 0 ? done() : reject(new Error(`Python denial failed: ${errors}`)));
    child.stdin.end(JSON.stringify(config));
  });
}
