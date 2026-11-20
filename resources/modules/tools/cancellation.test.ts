import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { Connections, type ConnectionAdapter } from '../connections/connections.js';
import { Sessions } from '../execution/sessions.js';
import { Runs } from '../execution/runs.js';
import { httpToolConnection } from '../../integrations/tools/http-json.js';
import { ToolBroker } from './broker.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe.skipIf(!process.env.TEST_DATABASE_URL)('Cancellation during an approved external request', () => {
  it.each([200, 503, 401])('preserves the %s response outcome without resuming or redispatching', async status => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = `cancel-${randomUUID()}`;
    const secrets = new SecretStore(pool, new SecretCipher(randomBytes(32)));
    const entered = deferred(), release = deferred();
    const service = Fastify();
    let requests = 0;
    service.get('/auth/check', async () => ({ ok: true }));
    service.post('/write', async (_req, reply) => { requests++; entered.resolve(); await release.promise; return reply.code(status).send({ saved: status === 200 }); });
    const adapters: ConnectionAdapter[] = ['sandbox', 'model'].map(kind => ({ kind: kind as 'sandbox' | 'model', provider: 'fixture', config: z.object({}), capabilities: [], async validate() { return { operations: [] }; } }));
    const connections = new Connections(pool, secrets, [...adapters, httpToolConnection]);
    const sessions = new Sessions(pool, connections, [{ id: 'fixture', version: '1', capabilities: ['tools'], model_providers: ['fixture'] }]);
    const runs = new Runs(pool), broker = new ToolBroker(pool, secrets);
    let dispatched: Promise<unknown> | undefined;
    try {
      const base = await service.listen({ host: '127.0.0.1', port: 0 });
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      const ids: Record<string, string> = {};
      for (const kind of ['sandbox', 'model', 'tool'] as const) {
        const connection = await connections.create(tenant, { kind, name: kind, provider: kind === 'tool' ? 'http-json' : 'fixture', credential: 'controlled-fixture', config: kind === 'tool' ? { base_url: base, operations: { write: { path: '/write', method: 'POST', description: 'Controlled write', approval: true } } } : {} });
        await connections.validate(tenant, connection.id); await connections.patch(tenant, connection.id, { enabled: true }); ids[kind] = connection.id;
      }
      const agent = await sessions.createAgent(tenant, { name: 'cancel', harness: { id: 'fixture', version: '1' }, tools: [{ name: 'reports' }] });
      const session = await sessions.create(tenant, { agent_id: agent.id, sandbox_connection_id: ids.sandbox!, model_connection_id: ids.model!, tools: { reports: ids.tool! } });
      const run = await runs.submit(tenant, session.id, 'first', 'Write report');
      const lease = await runs.claim('cancel-worker');
      await runs.advance(lease, 'provisioning'); await runs.advance(lease, 'running');
      const call = { id: randomUUID(), binding: 'reports', operation: 'write', arguments: {} };
      expect((await broker.process(lease, call)).state).toBe('waiting_approval');
      const approval = (await pool.query('SELECT approval_id FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [tenant, run.id, call.id])).rows[0].approval_id;
      await runs.decide(tenant, approval, true);
      dispatched = broker.process(lease, call);
      await entered.promise; // The service has received the request; no timing assumption.
      await runs.cancel(tenant, run.id);
      await runs.cancel(tenant, run.id);
      expect((await runs.get(tenant, run.id)).state).toBe('cancelling');
      release.resolve(); await dispatched;
      const row = (await pool.query('SELECT state,result FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [tenant, run.id, call.id])).rows[0];
      expect(row.state).toBe(status === 200 ? 'completed' : status === 401 ? 'waiting_authorization' : 'unknown');
      if (status === 200) expect(row.result.content[0].text).toContain('"saved":true');
      expect((await runs.get(tenant, run.id)).state).toBe('cancelling');
      await expect(broker.process(lease, call)).rejects.toMatchObject({ code: 'tool_run_not_active' });
      await expect(broker.process(lease, { ...call, id: randomUUID() })).rejects.toMatchObject({ code: 'tool_run_not_active' });
      expect(requests).toBe(1);
      await runs.advance(lease, 'cancelled');
      expect((await runs.get(tenant, run.id)).state).toBe('cancelled');
      const events = await runs.events(tenant, run.id);
      expect(events.filter(event => event.type === 'run.cancelling')).toHaveLength(1);
      expect(events.filter(event => event.type === 'run.cancelled')).toHaveLength(1);
      if (status !== 200) {
        expect(events.filter(event => event.type === 'tool.result_after_cancellation')).toHaveLength(1);
        expect(events.filter(event => event.type === 'authorization.required')).toHaveLength(0);
      }
      if (status === 200) {
        const next = await runs.submit(tenant, session.id, 'before-approval', 'Do not dispatch after cancellation');
        const nextLease = await runs.claim('cancel-before-approval');
        await runs.advance(nextLease, 'provisioning'); await runs.advance(nextLease, 'running');
        const nextCall = { ...call, id: randomUUID() };
        expect((await broker.process(nextLease, nextCall)).state).toBe('waiting_approval');
        const pending = (await pool.query('SELECT approval_id FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [tenant, next.id, nextCall.id])).rows[0].approval_id;
        await runs.cancel(tenant, next.id);
        for (const decision of [true, false]) await expect(runs.decide(tenant, pending, decision)).rejects.toMatchObject({ code: 'stale_approval' });
        await expect(broker.process(nextLease, nextCall)).rejects.toMatchObject({ code: 'tool_run_not_active' });
        expect(requests).toBe(1);
        await runs.advance(nextLease, 'cancelled');
      }
    } finally {
      release.resolve(); await dispatched?.catch(() => {});
      await service.close();
      for (const table of ['tool_calls', 'events', 'approvals', 'runs', 'session_tools', 'sessions', 'agents', 'connections', 'secrets', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
      await pool.end();
    }
  });
});
