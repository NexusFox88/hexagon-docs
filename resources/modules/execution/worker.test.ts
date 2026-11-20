import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { SandboxLifecycle } from '../sandboxes/lifecycle.js';
import { SandboxCreationRejected, SandboxPrerequisiteError, type SandboxConnector } from '../sandboxes/connector.js';
import { HarnessRegistry, type HarnessAdapter } from './harness.js';
import { ExecutionWorker } from './worker.js';
import { RuntimeClient, RuntimeUnavailableError } from '../sandboxes/runtime-client.js';
import { ToolBroker } from '../tools/broker.js';
import { Runs } from './runs.js';
import { Sessions } from './sessions.js';
import { Connections } from '../connections/connections.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('Worker recovery with persisted provider resource', () => {
  it.each(['quota', 'prerequisite', 'absent', 'unreachable', 'disabled', 'interrupted', 'interrupted-cancelling', 'automatic-interrupted', 'runtime-unreachable'] as const)('distinguishes %s resources without creating a replacement', async outcome => {
    const pool = openDatabase(url!);
    const tenant = `worker-test-${randomUUID()}`;
    const session = randomUUID();
    const secrets = new SecretStore(pool, new SecretCipher(Buffer.alloc(32, 7)));
    const refused = outcome === 'quota' || outcome === 'prerequisite';
    const interrupted = outcome.startsWith('interrupted')||outcome==='automatic-interrupted';
    const prepare=vi.spyOn(RuntimeClient.prototype,'prepare');
    const start=vi.spyOn(RuntimeClient.prototype,'start');
    const request = vi.spyOn(RuntimeClient.prototype, 'request').mockImplementation(async (_method, path) => {
      if (outcome === 'runtime-unreachable') throw new RuntimeUnavailableError();
      if (path.endsWith('/events?after=0')) return { events: [] };
      if (path === '/runs' || /^\/runs\/[^/]+(?:\/cancel)?$/.test(path)) return { state: 'interrupted' };
      throw new Error('unexpected_runtime_request');
    });
    const processTool = vi.spyOn(ToolBroker.prototype, 'process');
    const connector: SandboxConnector = {
      inspect: interrupted || outcome === 'runtime-unreachable' ? vi.fn().mockResolvedValue({ id: 'existing-resource', state: 'running' }) : outcome === 'absent' ? vi.fn().mockResolvedValue(null) : vi.fn().mockRejectedValue(new Error('transport unavailable')),
      ...(outcome==='interrupted'?{configureCredentialAccess:vi.fn().mockResolvedValue(undefined)}:{}),
      preflight: outcome === 'prerequisite' ? vi.fn().mockRejectedValue(new SandboxPrerequisiteError()) : undefined,
      create: outcome === 'quota' ? vi.fn().mockRejectedValue(new SandboxCreationRejected()) : vi.fn(), findByOperation: vi.fn(), destroy: vi.fn(), execute: vi.fn(), write: vi.fn(), read: vi.fn(), preview: vi.fn(),
    };
    const harness: HarnessAdapter = { definition: { id: 'fixture', version: '1', capabilities: [], model_providers: [] }, install: vi.fn(), invocation: vi.fn(), result: vi.fn() };
    const worker = new ExecutionWorker(pool, secrets, new SandboxLifecycle(pool, secrets, () => connector), new HarnessRegistry([harness]));
    const runs = new Runs(pool);
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      const secret = await secrets.save(tenant, 'connection:sandbox', 'fixture-key');
      await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id) VALUES($1,'sandbox','sandbox','fixture','fixture',$2),($1,'model','model','fixture','fixture',NULL)", [tenant, secret]);
      await pool.query("UPDATE connections SET status='ready',enabled=true WHERE tenant_id=$1", [tenant]);
      await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')", [tenant]);
      const definition = { capabilities:outcome==='automatic-interrupted'?['automatic_standby']:[], resources: {timeout_seconds:600}, network:{mode:'unrestricted',allowed_hosts:[]}, harness: { id: 'fixture', version: '1' }, connections: [{ id: 'sandbox', provider: 'fixture', config: {} }] };
      await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition,sandbox) VALUES($1,$2,'agent','sandbox','model',$3,$4)", [tenant, session, definition, { id: 'existing-resource', state: 'running' }]);
      const run = await runs.submit(tenant, session, 'task', 'Resume the existing workspace');
      if (refused) await pool.query('UPDATE sessions SET sandbox=NULL WHERE tenant_id=$1 AND id=$2', [tenant, session]);
      if (outcome === 'disabled') {
        await pool.query('UPDATE sessions SET sandbox=NULL WHERE tenant_id=$1 AND id=$2', [tenant, session]);
        await pool.query("UPDATE connections SET enabled=false WHERE tenant_id=$1 AND id='sandbox'", [tenant]);
      }
      const firstLease = await runs.claim('previous-worker');
      await runs.advance(firstLease, 'provisioning');
      await runs.advance(firstLease, 'running');
      await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenant, run.id]);
      if (interrupted || outcome === 'runtime-unreachable') {
        const runtimeSecret = await secrets.save(tenant, `runtime:${session}`, 'fixture-runtime-token');
        await pool.query("INSERT INTO session_runtimes(tenant_id,session_id,secret_id,state) VALUES($1,$2,$3,'ready')", [tenant, session, runtimeSecret]);
        const invocationSecret = await secrets.save(tenant, `invocation:${run.id}`, JSON.stringify({ id: run.id, command: ['fixture'],credential_boundary:'external-v1',...(outcome==='interrupted'?{native_credential_access:[{base_url:'https://credentials.test/access/test',token:'delegated-test-grant'}]}:{}) }));
        await pool.query('INSERT INTO run_invocations(tenant_id,run_id,secret_id) VALUES($1,$2,$3)', [tenant, run.id, invocationSecret]);
        if (outcome === 'interrupted-cancelling') await pool.query("UPDATE runs SET state='cancelling' WHERE tenant_id=$1 AND id=$2", [tenant, run.id]);
      }
      worker.start();
      await vi.waitFor(async () => {
        const current = await runs.get(tenant, run.id);
        expect(current.error?.code).toBe(outcome === 'quota' ? 'sandbox_quota_exceeded' : outcome === 'prerequisite' ? 'sandbox_openssh_unavailable' : interrupted ? 'runtime_interrupted' : outcome === 'absent' ? 'sandbox_lost' : outcome === 'disabled' ? 'connection_not_ready' : 'execution_reconciliation_required');
        expect(current.state).toBe(outcome.includes('unreachable') ? 'running' : 'failed');
      }, { timeout: 5000, interval: 30 });
      await worker.stop();
      if (outcome === 'quota') {
        const sessions = new Sessions(pool, new Connections(pool, secrets, []), new HarnessRegistry([harness]));
        const fleet = await sessions.fleet(tenant);
        expect(fleet.find(item => item.id === session)?.resource_operations).toEqual([
          expect.objectContaining({kind:'create',state:'rejected',reason:'sandbox_quota_exceeded'}),
        ]);
        expect(await sessions.fleet(`foreign-${tenant}`)).toEqual([]);
        expect(connector.create).toHaveBeenCalledTimes(1);
        const recreated=new SandboxLifecycle(pool,secrets,()=>connector);
        await expect(recreated.provision(tenant,session)).rejects.toMatchObject({code:'sandbox_quota_exceeded'});
        expect(connector.create).toHaveBeenCalledTimes(1);
        expect(connector.findByOperation).not.toHaveBeenCalled();
        expect(await recreated.close(tenant,session)).toEqual({state:'closed'});
      } else expect(connector.create).not.toHaveBeenCalled();
      if (outcome === 'prerequisite') expect((await pool.query('SELECT id FROM resource_operations WHERE tenant_id=$1',[tenant])).rowCount).toBe(0);
      expect(harness.install).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
      if(outcome==='interrupted'){
        expect(connector.configureCredentialAccess).toHaveBeenCalledTimes(1);
        const posted=request.mock.calls.find(([method,path])=>method==='POST'&&path==='/runs')?.[2];
        expect(posted).toBeDefined();expect(JSON.stringify(posted)).not.toContain('delegated-test-grant');expect(posted).not.toHaveProperty('native_credential_access');
      }
      if (interrupted) {
        expect(processTool).not.toHaveBeenCalled();
        expect(request.mock.calls.some(([, path]) => path.endsWith('/tools') || path.endsWith('/artifacts'))).toBe(false);
        expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('interrupted');
        expect(harness.invocation).not.toHaveBeenCalled();
      }
      if (outcome === 'runtime-unreachable') expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [tenant, session])).rows[0].state).toBe('unreachable');
      const events = await runs.events(tenant, run.id);
      expect(events.at(-1)?.type).toBe(outcome.includes('unreachable') ? 'run.recovery_needed' : 'run.failed');
      expect(events.filter(event => event.type === 'run.claimed').at(-1)?.data.recovery).toBe(true);
    } finally {
      await worker.stop();
      vi.restoreAllMocks();
      for (const table of ['resource_operations', 'events', 'run_invocations', 'runs', 'session_runtimes', 'sessions', 'agents', 'connections', 'secrets', 'tenants']) {
        await pool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=$1`, [tenant]);
      }
      await pool.end();
    }
  });
});
