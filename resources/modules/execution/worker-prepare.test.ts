import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { SandboxLifecycle } from '../sandboxes/lifecycle.js';
import type { SandboxConnector } from '../sandboxes/connector.js';
import { HarnessRegistry, type HarnessAdapter } from './harness.js';
import { ExecutionWorker } from './worker.js';
import { RuntimeClient, RuntimeUnavailableError } from '../sandboxes/runtime-client.js';
import { Runs } from './runs.js';
const url=process.env.TEST_DATABASE_URL;
it.skipIf(!url).each(['resume','cancel','restore','auto_restore'] as const)('handles interrupted preparation: %s without duplicating launch', async(action)=>{
  const restoring=['restore','auto_restore'].includes(action);
  const pool=openDatabase(url!);const tenant=`prepare-${randomUUID()}`;const session=randomUUID();
  const secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,7)));
  const connector={inspect:vi.fn().mockResolvedValue({id:'existing',state:'running'})} as unknown as SandboxConnector;
  const harness:HarnessAdapter={definition:{id:'fixture',version:'1',capabilities:[],model_providers:[]},install:vi.fn().mockRejectedValue(new Error('harness_version_mismatch')),invocation:vi.fn(),result:vi.fn()};
  const worker=new ExecutionWorker(pool,secrets,new SandboxLifecycle(pool,secrets,()=>connector),new HarnessRegistry([harness]));
  const prepare=vi.spyOn(RuntimeClient.prototype,'prepare').mockRejectedValueOnce(new TypeError('private upload detail')).mockResolvedValue(undefined);
  const start=vi.spyOn(RuntimeClient.prototype,'start').mockResolvedValue(undefined);const runs=new Runs(pool);
  try {
    await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);
    const secret=await secrets.save(tenant,'connection:sandbox','fixture');
    await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id,status,enabled) VALUES($1,'sandbox','sandbox','fixture','fixture',$2,'ready',true),($1,'model','model','fixture','fixture',NULL,'ready',true)",[tenant,secret]);
    await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')",[tenant]);
    await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition,sandbox) VALUES($1,$2,'agent','sandbox','model',$3,$4)",[tenant,session,{capabilities:action==='auto_restore'?['automatic_standby']:[],harness:{id:'fixture',version:'1'},connections:[{id:'sandbox',provider:'fixture',config:{}}]},{id:'existing'}]);
    if(restoring){
      const runtimeSecret=await secrets.save(tenant,'runtime:'+session,'fixture-runtime');
      await pool.query("INSERT INTO session_runtimes(tenant_id,session_id,secret_id,state,native_session) VALUES($1,$2,$3,$4,'original-conversation')",[tenant,session,runtimeSecret,action==='auto_restore'?'ready':'restoring']);
    }
    const run=await runs.submit(tenant,session,'prepare','test');
    await (worker as any).execute(await runs.claim('first-worker'));
    expect((await pool.query('SELECT state FROM session_runtimes WHERE tenant_id=$1',[tenant])).rows[0].state).toBe(restoring?'restoring_preparing':'preparing');
    expect((await runs.get(tenant,run.id)).error).toEqual({code:'execution_reconciliation_required',stage:'runtime_prepare',failure:{category:'TypeError'}});
    expect(start).not.toHaveBeenCalled();
    // A previously persisted launch intent must only be probed, never replayed.
    const request=vi.spyOn(RuntimeClient.prototype,'request').mockRejectedValue(new RuntimeUnavailableError());
    await pool.query("UPDATE session_runtimes SET state=$2 WHERE tenant_id=$1",[tenant,restoring?'restoring_starting':'starting']);
    await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1",[tenant]);
    await (worker as any).execute(await runs.claim('uncertain-worker'));
    expect(request).toHaveBeenCalledWith('GET','/health');
    expect(prepare).toHaveBeenCalledTimes(1);expect(start).not.toHaveBeenCalled();
    if(action==='cancel'){
      await runs.cancel(tenant,run.id);
      await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1",[tenant]);
      request.mockClear();
      await (worker as any).execute(await runs.claim('cancellation-worker'));
      expect((await runs.get(tenant,run.id)).state).toBe('cancelled');
      expect(request).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
      return;
    }
    await pool.query("UPDATE session_runtimes SET state=$2 WHERE tenant_id=$1",[tenant,restoring?'restoring_preparing':'preparing']);
    await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1",[tenant]);
    await (worker as any).execute(await runs.claim('recovered-worker'));
    expect(prepare).toHaveBeenCalledTimes(2);expect(start).toHaveBeenCalledTimes(1);
    if(restoring){
      expect(harness.install).not.toHaveBeenCalled();
      expect(request.mock.calls.some(call=>call[1]==='/inputs')).toBe(false);
      expect((await pool.query('SELECT state,native_session FROM session_runtimes WHERE tenant_id=$1',[tenant])).rows[0]).toEqual({state:'ready',native_session:'original-conversation'});
    }else expect((await runs.get(tenant,run.id)).error.code).toBe('harness_version_mismatch');
  } finally {
    vi.restoreAllMocks();
    for(const table of ['events','runs','session_runtimes','sessions','agents','connections','secrets','tenants']) await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);
    await pool.end();
  }
});
