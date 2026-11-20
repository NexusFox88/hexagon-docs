import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { Runs } from './runs.js';
import { createServer } from '../../apps/control-plane/server.js';
import { tokenDigest } from '../credentials/api-auth.js';
import { SessionInputs } from './inputs.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('Run transactions against PostgreSQL', () => {
  const pool = openDatabase(url ?? '');
  const runs = new Runs(pool);
  const inputs = new SessionInputs(pool);
  const tenant = `test-${randomUUID()}`;
  const session = randomUUID();
  const token = randomUUID();
  beforeAll(async () => {
    await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
    await pool.query("INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,'test')", [tokenDigest(token), tenant]);
    await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name) VALUES($1,'sandbox','sandbox','fixture','fixture'),($1,'model','model','fixture','fixture')", [tenant]);
    await pool.query("UPDATE connections SET status='ready',enabled=true WHERE tenant_id=$1", [tenant]);
    await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')", [tenant]);
    await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition) VALUES($1,$2,'agent','sandbox','model','{}')", [tenant, session]);
  });
  afterAll(async () => {
    for (const table of ['events', 'approvals', 'runs', 'session_inputs', 'session_runtimes', 'sessions', 'agents', 'connections', 'secrets', 'api_keys', 'tenants']) {
      await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
    }
    await pool.end();
  });

  it('validates context file bytes and scope before any Run is accepted',async()=>{
    const sid=randomUUID(),bytes=Buffer.from('reference data'),sha=createHash('sha256').update(bytes).digest('hex');
    const definition={context:{files:[{path:'brief.txt',sha256:sha}]}};
    await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition) VALUES($1,$2,'agent','sandbox','model',$3)",[tenant,sid,definition]);
    await expect(runs.submit(tenant,sid,'missing','Task')).rejects.toMatchObject({code:'context_file_missing'});
    await inputs.upload(tenant,sid,{files:[{path:'brief.txt',content_base64:Buffer.from('different').toString('base64')}]});
    await expect(runs.submit(tenant,sid,'changed','Task')).rejects.toMatchObject({code:'context_file_changed'});
    await inputs.upload(tenant,sid,{files:[{path:'brief.txt',content_base64:bytes.toString('base64')}]});
    await expect(runs.submit('foreign',sid,'foreign','Task')).rejects.toMatchObject({code:'session_not_found'});
    await expect(runs.submit(tenant,sid,'too-large','\u4e2d'.repeat(41000))).rejects.toMatchObject({code:'input_too_large'});
    const origin={message_id:'message',channel:'test'},run=await runs.submit(tenant,sid,'valid','Task',origin,{key_id:'trusted'});
    expect(run.execution_identity.principal).toEqual({key_id:'trusted'});
    expect((await runs.submit(tenant,sid,'valid','Task',origin)).id).toBe(run.id);
    await expect(runs.submit(tenant,sid,'valid','Task',{message_id:'changed'})).rejects.toMatchObject({code:'idempotency_conflict'});
    await runs.cancel(tenant,run.id);
  });

  it('serializes concurrent submissions, fences workers, and expires stale approval', async () => {
    const bytes = Buffer.from('actual project input\n');
    await inputs.upload(tenant, session, { files: [{ path: 'src/example.txt', content_base64: bytes.toString('base64') }] });
    expect((await inputs.readForProvisioning(tenant, session))[0]!.content.equals(bytes)).toBe(true);
    await expect(inputs.upload(tenant, session, { files: [{ path: '../escape', content_base64: '' }] })).rejects.toThrow();
    await expect(inputs.list('other-tenant', session)).rejects.toMatchObject({ status: 404 });
    const [first, retry] = await Promise.all([
      runs.submit(tenant, session, 'first', 'Implement the filter'),
      runs.submit(tenant, session, 'first', 'Implement the filter'),
    ]);
    expect(first.id).toBe(retry.id);
    await expect(inputs.upload(tenant, session, { files: [{ path: 'src/example.txt', content_base64: '' }] })).rejects.toMatchObject({ code: 'workspace_already_started' });
    await expect(runs.submit(tenant, session, 'first', 'Different task')).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(runs.submit(tenant, session, 'second', 'Another task')).rejects.toMatchObject({ code: 'session_busy' });
    await expect(runs.get('other-tenant', first.id)).rejects.toMatchObject({ status: 404 });
    await expect(runs.events('other-tenant', first.id)).rejects.toMatchObject({ status: 404 });

    const lease = await runs.claim(`worker-${tenant}`);
    expect(lease.id).toBe(first.id);
    await runs.advance(lease, 'provisioning');
    await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenant, first.id]);
    const recovered = await runs.claim(`recovery-${tenant}`);
    expect(recovered.generation).toBe(lease.generation + 1);
    await expect(runs.advance(lease, 'running')).rejects.toMatchObject({ code: 'lease_lost' });
    await runs.advance(recovered, 'running');
    const runtimeEvents = [{ cursor: 120, type: 'harness.stdout', data: { text: 'fixture output' } }];
    await runs.ingest(recovered, runtimeEvents);
    await runs.ingest(recovered, runtimeEvents);
    expect((await runs.events(tenant, first.id)).filter(e => e.type === 'harness.stdout')).toHaveLength(1);
    expect((await runs.get(tenant, first.id)).runtime_cursor).toBe('120');
    const approval = await runs.requestApproval(recovered, { tool: 'report', operation: 'write' });
    await runs.cancel(tenant, first.id);
    await expect(runs.decide(tenant, approval, true)).rejects.toMatchObject({ code: 'stale_approval' });
    const cancelling = await runs.claim(`cleanup-${tenant}`);
    await runs.advance(cancelling, 'cancelled');
    const all = await runs.events(tenant, first.id);
    expect(all.at(-1)?.type).toBe('run.cancelled');
    const cursor = all[2]!.id;
    expect(await runs.events(tenant, first.id, cursor)).toEqual(all.slice(3));
    expect((await runs.get(tenant, first.id)).state).toBe('cancelled');
  });

  it('persists approval decisions and final output for a subsequent Run', async () => {
    const next = await runs.submit(tenant, session, 'follow-up', 'Summarize the changes');
    const lease = await runs.claim(`worker-${tenant}`);
    await runs.advance(lease, 'provisioning');
    await runs.advance(lease, 'running');
    const approval = await runs.requestApproval(lease, { tool: 'report', operation: 'write' });
    await runs.decide(tenant, approval, true);
    await runs.decide(tenant, approval, true);
    await expect(runs.decide(tenant, approval, false)).rejects.toMatchObject({ code: 'stale_approval' });
    const resumed = await runs.claim(`resume-${tenant}`);
    const output = { role: 'assistant', text: 'Fixture result; no real agent executed.' };
    await runs.advance(resumed, 'completed', output);
    expect((await runs.get(tenant, next.id)).output).toEqual(output);
    expect((await runs.events(tenant, next.id)).filter(e => e.type === 'approval.decided')).toHaveLength(1);
    expect((await runs.cancel(tenant, next.id)).state).toBe('completed');
  });

  it('recovers waiting Runs and permits failure when the waiting harness exits', async () => {
    for (const state of ['waiting_authorization', 'waiting_approval']) {
      const run = await runs.submit(tenant, session, state, 'Wait for an external action');
      const lease = await runs.claim(`initial-${tenant}`);
      await runs.advance(lease, 'provisioning');
      await runs.advance(lease, 'running');
      await pool.query("UPDATE runs SET state=$3,lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenant, run.id, state]);
      const recovered = await runs.claim(`recovered-${tenant}`);
      expect(recovered.id).toBe(run.id);
      expect(recovered.state).toBe(state);
      await expect(runs.advance(lease, 'failed')).rejects.toMatchObject({ code: 'lease_lost' });
      await runs.advance(recovered, 'failed', { code: 'harness_execution_failed' });
      expect((await runs.get(tenant, run.id)).state).toBe('failed');
    }
  });

  it('rejects new Runs on disabled bindings while preserving idempotent retries', async () => {
    const first = await runs.submit(tenant, session, 'disable-boundary', 'Original task');
    await runs.cancel(tenant, first.id);
    for (const connection of ['sandbox', 'model']) {
      await pool.query('UPDATE connections SET enabled=false WHERE tenant_id=$1 AND id=$2', [tenant, connection]);
      try {
        expect((await runs.submit(tenant, session, 'disable-boundary', 'Original task')).id).toBe(first.id);
        await expect(runs.submit(tenant, session, `disabled-${connection}`, 'New task')).rejects.toMatchObject({ code: 'connection_not_ready', status: 409 });
        expect((await pool.query('SELECT 1 FROM runs WHERE tenant_id=$1 AND idempotency_key=$2', [tenant, `disabled-${connection}`])).rowCount).toBe(0);
      } finally { await pool.query('UPDATE connections SET enabled=true WHERE tenant_id=$1 AND id=$2', [tenant, connection]); }
    }
  });

  it('records known image preparation once and fences released worker leases',async()=>{
    const run=await runs.submit(tenant,session,'image-wait','Wait for image');
    const lease=await runs.claim('image-worker');await runs.advance(lease,'provisioning');
    await expect(runs.waitForImage({...lease,generation:lease.generation+1})).rejects.toMatchObject({code:'lease_lost'});
    await runs.waitForImage(lease);
    expect((await runs.get(tenant,run.id)).error).toBeNull();
    await expect(runs.heartbeat(lease)).rejects.toMatchObject({code:'lease_lost'});
    expect(await runs.claim('too-early')).toBeNull();
    await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",[tenant,run.id]);
    const recovered=await runs.claim('next-image-worker');await runs.waitForImage(recovered);
    expect((await runs.events(tenant,run.id)).filter(item=>item.type==='sandbox.image_building')).toHaveLength(1);
    await pool.query("UPDATE runs SET state='cancelled' WHERE tenant_id=$1 AND id=$2",[tenant,run.id]);
  });

  it('fences Runtime readiness and persists a single input verification receipt', async () => {
    const secret = await new SecretStore(pool, new SecretCipher(randomBytes(32))).save(tenant, `runtime:${session}`, 'controlled-runtime-token');
    await pool.query('INSERT INTO session_runtimes(tenant_id,session_id,secret_id) VALUES($1,$2,$3)', [tenant, session, secret]);
    const run = await runs.submit(tenant, session, 'input-receipt', 'Input receipt fixture');
    const lease = await runs.claim(`input-worker-${tenant}`);
    await runs.advance(lease, 'provisioning');
    const files = [{ path: 'src/example.txt', sha256: 'a'.repeat(64), size: 20 }];
    await expect(runs.markRuntimeReady({ ...lease, generation: lease.generation + 1 }, session, files)).rejects.toMatchObject({ code: 'lease_lost' });
    await expect(runs.markRuntimeReady(lease, randomUUID(), files)).rejects.toMatchObject({ code: 'runtime_session_mismatch' });
    expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('reserved');
    expect((await runs.events(tenant, run.id)).some(event => event.type === 'workspace.inputs_verified')).toBe(false);
    await runs.markRuntimeReady(lease, session, files);
    await runs.markRuntimeReady(lease, session, files);
    expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('ready');
    const receipts = (await runs.events(tenant, run.id)).filter(event => event.type === 'workspace.inputs_verified');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.data).toEqual({ session_id: session, files });
    await expect(runs.recordRecoveryNeeded({ ...lease, generation: lease.generation + 1 }, true)).rejects.toMatchObject({ code: 'lease_lost' });
    await runs.recordRecoveryNeeded(lease, true);
    expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('unreachable');
    await expect(runs.recordRuntimeReachable({ ...lease, generation: lease.generation + 1 })).rejects.toMatchObject({ code: 'lease_lost' });
    await runs.recordRuntimeReachable(lease);
    await runs.recordRuntimeReachable(lease);
    expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('ready');
    expect((await runs.get(tenant, run.id)).error).toBeNull();
    expect((await runs.events(tenant, run.id)).filter(event => event.type === 'runtime.reconnected')).toHaveLength(1);
    await runs.advance(lease, 'failed', { code: 'controlled_fixture_end' });
  });

  it('serves authenticated API operations without exposing lease internals', async () => {
    const app = createServer(pool);
    try {
      expect((await app.inject({ url: '/v1/health' })).statusCode).toBe(401);
      const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'http' };
      const submitted = await app.inject({ method: 'POST', url: `/v1/sessions/${session}/runs`, headers, payload: { input: 'API fixture' } });
      expect(submitted.statusCode).toBe(202);
      const run = submitted.json();
      expect(run.lease_owner).toBeUndefined();
      expect(run.tenant_id).toBeUndefined();
      const history = (await app.inject({ url: `/v1/sessions/${session}/runs`, headers })).json().runs;
      expect(history[0].id).toBe(run.id);
      expect(history.every((item: any) => !('lease_owner' in item) && !('tenant_id' in item))).toBe(true);
      expect((await app.inject({ url: `/v1/sessions/${randomUUID()}/runs`, headers })).statusCode).toBe(404);
      const events = await app.inject({ url: `/v1/runs/${run.id}/events`, headers });
      expect(events.json().events[0].type).toBe('run.queued');
      expect((await app.inject({ method: 'POST', url: `/v1/runs/${run.id}/cancel`, headers })).json().state).toBe('cancelled');
      const stream = await app.inject({ url: `/v1/runs/${run.id}/stream`, headers });
      expect(stream.statusCode).toBe(200);
      expect(stream.body).toContain('event: run.cancelled');
      expect(stream.body).toContain('event: stream.end');
      expect(stream.body.match(/event: run.queued/g)).toHaveLength(1);
    } finally { await app.close(); }
  });
});
