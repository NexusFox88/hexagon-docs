import { createServer } from '../../apps/control-plane/server.js';
import { tokenDigest } from '../credentials/api-auth.js';
import { ToolReconciliation } from './reconciliation.js';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { Connections, type ConnectionAdapter } from '../connections/connections.js';
import { Sessions } from '../execution/sessions.js';
import { Runs } from '../execution/runs.js';
import { httpToolConnection } from '../../integrations/tools/http-json.js';
import { ToolBroker } from './broker.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Tool broker with real HTTP side effects', () => {
  it('waits for credentials and approval, deduplicates results, and never replays an uncertain unsafe write', async () => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = `broker-${randomUUID()}`;
    const secrets = new SecretStore(pool, new SecretCipher(randomBytes(32)));
    const fixture = Fastify();
    const app = createServer(pool);
    const access = randomUUID();
    let writes = 0;
    let uncertainWrites = 0;
    let acceptedCredential = 'valid-fixture-key';
    let authenticationFailures = 0;
    fixture.addHook('onRequest', async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${acceptedCredential}`) {
        authenticationFailures++; return reply.code(401).send({ error: 'invalid' });
      }
    });
    fixture.get('/auth/check', async () => ({ ok: true }));
    fixture.post('/reports', async request => { writes++; return { id: 'report-1', body: request.body }; });
    fixture.post('/uncertain', async (_request, reply) => { uncertainWrites++; return reply.code(503).send({ error: 'response unavailable after write' }); });
    const adapters: ConnectionAdapter[] = ['sandbox', 'model'].map(kind => ({ kind: kind as 'sandbox' | 'model', provider: 'fixture', config: z.object({}).strict(), capabilities: [], async validate() { return { operations: [] }; } }));
    const connections = new Connections(pool, secrets, [...adapters, httpToolConnection]);
    const sessions = new Sessions(pool, connections, [{ id: 'fixture', version: '1', capabilities: ['tools'], model_providers: ['fixture'] }]);
    try {
      const base = await fixture.listen({ host: '127.0.0.1', port: 0 });
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      await pool.query("INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,'reconciliation-test')", [tokenDigest(access), tenant]);
      const ids: Record<string, string> = {};
      for (const kind of ['sandbox', 'model'] as const) {
        const row = await connections.create(tenant, { kind, provider: 'fixture', name: kind, credential: 'fixture' });
        await connections.validate(tenant, row.id); await connections.patch(tenant, row.id, { enabled: true }); ids[kind] = row.id;
      }
      const report = await connections.create(tenant, { kind: 'tool', provider: 'http-json', name: 'Report service', config: { base_url: base, operations: { write: { path: '/reports', method: 'POST', description: 'Write a report', approval: true, input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } }, uncertain: { path: '/uncertain', method: 'POST', description: 'Unsafe fixture', approval: false } } } });
      const agent = await sessions.createAgent(tenant, { name: 'fixture', harness: { id: 'fixture', version: '1' }, tools: [{ name: 'reports', required_at_start: false }] });
      const session = await sessions.create(tenant, { agent_id: agent.id, sandbox_connection_id: ids.sandbox!, model_connection_id: ids.model!, tools: { reports: report.id } });
      const run = randomUUID();
      const lease = { tenant_id: tenant, id: run, generation: 1, lease_owner: 'fixture-worker' };
      await pool.query("INSERT INTO runs(tenant_id,id,session_id,idempotency_key,request_hash,input,state,lease_owner,lease_until,generation) VALUES($1,$2,$3,'first','fixture','fixture','running','fixture-worker',now()+interval '5 minutes',1)", [tenant, run, session.id]);
      const broker = new ToolBroker(pool, secrets);
      const runs = new Runs(pool);
      const invalid = await broker.process(lease, { id: randomUUID(), binding: 'reports', operation: 'write', arguments: { summary: 123 } });
      expect(invalid).toMatchObject({ state: 'completed', result: { isError: true } });
      expect(writes).toBe(0);
      expect((await pool.query('SELECT id FROM approvals WHERE tenant_id=$1', [tenant])).rowCount).toBe(0);
      const call = { id: randomUUID(), binding: 'reports', operation: 'write', arguments: { summary: 'actual report fixture' } };
      expect((await broker.process(lease, call)).state).toBe('waiting_authorization');
      expect((await runs.get(tenant, run)).state).toBe('waiting_authorization');
      expect(writes).toBe(0);
      await connections.patch(tenant, report.id, { credential: 'valid-fixture-key' });
      await connections.validate(tenant, report.id); await connections.patch(tenant, report.id, { enabled: true });
      expect((await broker.process(lease, call)).state).toBe('waiting_approval');
      expect(writes).toBe(0);
      const approval = (await pool.query('SELECT id FROM approvals WHERE tenant_id=$1 AND run_id=$2', [tenant, run])).rows[0].id;
      await runs.decide(tenant, approval, true);
      // Revoke the remote service credential after local validation/approval.
      acceptedCredential = 'rotated-fixture-key';
      expect((await broker.process(lease, call)).state).toBe('waiting_authorization');
      expect(authenticationFailures).toBe(1);
      expect(writes).toBe(0);
      expect(await connections.get(tenant, report.id)).toMatchObject({ status: 'invalid', enabled: false });
      expect((await runs.get(tenant, run)).state).toBe('waiting_authorization');
      expect((await broker.process(lease, call)).state).toBe('waiting_authorization');
      expect(authenticationFailures).toBe(1); // Do not keep sending a known-bad credential.
      await connections.patch(tenant, report.id, { credential: 'still-invalid' });
      expect((await connections.validate(tenant, report.id)).status).toBe('invalid');
      await expect(connections.patch(tenant, report.id, { enabled: true })).rejects.toMatchObject({ code: 'validation_required' });
      expect((await broker.process(lease, call)).state).toBe('waiting_authorization');
      await connections.patch(tenant, report.id, { credential: acceptedCredential });
      expect((await connections.validate(tenant, report.id)).status).toBe('ready');
      await connections.patch(tenant, report.id, { enabled: true });
      expect((await broker.process(lease, call)).state).toBe('waiting_approval');
      expect(writes).toBe(0);
      const newApproval = (await pool.query('SELECT approval_id FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [tenant, run, call.id])).rows[0].approval_id;
      expect(newApproval).not.toBe(approval);
      await expect(runs.decide(tenant, approval, true)).rejects.toMatchObject({ code: 'stale_approval' });
      await runs.decide(tenant, newApproval, true);
      const completed = await broker.process(lease, call);
      expect(completed.state).toBe('completed');
      expect(writes).toBe(1);
      expect(await broker.process(lease, call)).toEqual(completed);
      expect(writes).toBe(1);
      await expect(broker.process(lease, { ...call, arguments: { summary: 'changed' } })).rejects.toMatchObject({ code: 'tool_call_conflict' });
      const refused = { ...call, id: randomUUID() };
      expect((await broker.process(lease, refused)).state).toBe('waiting_approval');
      const refusedApproval = (await pool.query('SELECT approval_id FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [tenant, run, refused.id])).rows[0].approval_id;
      await runs.decide(tenant, refusedApproval, false);
      const refusal = await broker.process(lease, refused);
      expect(refusal).toMatchObject({ state: 'completed', result: { isError: true } });
      expect(await broker.process(lease, refused)).toEqual(refusal);
      expect(writes).toBe(1);
      const unsafe = { id: randomUUID(), binding: 'reports', operation: 'uncertain', arguments: {} };
      expect((await broker.process(lease, unsafe)).state).toBe('unknown');
      expect((await broker.process(lease, unsafe)).state).toBe('unknown');
      expect(uncertainWrites).toBe(1);
      const reconciliation = new ToolReconciliation(pool);
      const callsResponse = await app.inject({ url: `/v1/runs/${run}/tool-calls`, headers: { authorization: `Bearer ${access}` } });
      expect(callsResponse.statusCode).toBe(200);
      const unknown = callsResponse.json<{ calls: Array<{ id: string; request_hash: string }> }>().calls.find(item => item.id === unsafe.id)!;
      const resolution = { request_hash: unknown.request_hash, outcome: 'completed', text: 'Remote report verified as saved', evidence: 'Fixture write counter and report record verified' };
      await expect(reconciliation.list('other-tenant', run)).rejects.toMatchObject({ code: 'run_not_found' });
      await expect(reconciliation.resolve('other-tenant', run, unsafe.id, resolution)).rejects.toMatchObject({ code: 'run_not_found' });
      await expect(reconciliation.resolve(tenant, run, unsafe.id, { ...resolution, request_hash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'tool_call_conflict' });
      const inFlight = await pool.connect();
      try {
        await inFlight.query('SELECT pg_advisory_lock(hashtextextended($1,1))', [JSON.stringify([tenant, run, unsafe.id])]);
        await expect(reconciliation.resolve(tenant, run, unsafe.id, resolution)).rejects.toMatchObject({ code: 'tool_call_in_flight' });
      } finally {
        await inFlight.query('SELECT pg_advisory_unlock(hashtextextended($1,1))', [JSON.stringify([tenant, run, unsafe.id])]); inFlight.release();
      }
      // Changing the live connection cannot retroactively authorize replay.
      const changed = structuredClone((await connections.get(tenant, report.id)).config);
      changed.operations.uncertain.replay = 'idempotency_key';
      await connections.patch(tenant, report.id, { config: changed });
      await connections.validate(tenant, report.id); await connections.patch(tenant, report.id, { enabled: true });
      expect((await broker.process(lease, unsafe)).state).toBe('unknown');
      expect(uncertainWrites).toBe(1);
      expect((await app.inject({ method: 'POST', url: `/v1/runs/${run}/tool-calls/${unsafe.id}/resolve`, headers: { authorization: `Bearer ${access}` }, payload: resolution })).json().state).toBe('completed');
      expect((await reconciliation.resolve(tenant, run, unsafe.id, resolution)).state).toBe('completed');
      await expect(reconciliation.resolve(tenant, run, unsafe.id, { ...resolution, outcome: 'failed' })).rejects.toMatchObject({ code: 'tool_resolution_conflict' });
      expect((await broker.process(lease, unsafe)).result).toMatchObject({ content: [{ text: resolution.text }] });
      expect(uncertainWrites).toBe(1);
      expect((await runs.get(tenant, run)).state).toBe('running');
      expect((await runs.events(tenant, run)).filter(e => e.type === 'tool.outcome_resolved')).toHaveLength(1);
      const failedCall = { ...unsafe, id: randomUUID() };
      expect((await broker.process(lease, failedCall)).state).toBe('unknown');
      const failedRow = (await reconciliation.list(tenant, run)).find(item => item.id === failedCall.id)!;
      await reconciliation.resolve(tenant, run, failedCall.id, { ...resolution, request_hash: failedRow.request_hash, outcome: 'failed', text: 'Remote result could not be accepted; no retry requested' });
      const writesAtResolution = uncertainWrites;
      expect((await broker.process(lease, failedCall)).result).toMatchObject({ isError: true });
      expect(uncertainWrites).toBe(writesAtResolution);
      const another = { ...unsafe, id: randomUUID() };
      expect((await broker.process(lease, another)).state).toBe('unknown');
      const pending = (await reconciliation.list(tenant, run)).find(item => item.id === another.id)!;
      await runs.cancel(tenant, run);
      await expect(reconciliation.resolve(tenant, run, another.id, { ...resolution, request_hash: pending.request_hash })).rejects.toMatchObject({ code: 'tool_run_not_active' });
      await expect(broker.process(lease, { ...call, id: randomUUID() })).rejects.toMatchObject({ code: 'tool_run_not_active' });
      expect(writes).toBe(1);
    } finally {
      await app.close();
      await fixture.close();
      for (const table of ['tool_calls', 'events', 'approvals', 'runs', 'session_tools', 'sessions', 'agents', 'connections', 'secrets', 'api_keys', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
      await pool.end();
    }
  });
});
