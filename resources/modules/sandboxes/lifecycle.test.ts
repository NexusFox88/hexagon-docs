import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database.js';
import { SecretCipher, SecretStore } from '../credentials/secret-store.js';
import { SandboxLifecycle } from './lifecycle.js';
import type { SandboxConnector } from './connector.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Associated cloud resource cleanup', () => {
  it('persists an asynchronous deletion handle and resumes it after a control-plane reconstruction', async () => {
    const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant=`purge-${randomUUID()}`,session=randomUUID();
    const secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,9)));
    const reconcileDeletion=vi.fn().mockImplementationOnce(async (_id, context) => {
      await context.record('provider-purge-123');
      throw new Error('poll_connection_lost');
    }).mockImplementationOnce(async (_id, context) => {
      expect(context.provider_operation_id).toBe('provider-purge-123');
    });
    const connector={inspect:vi.fn().mockResolvedValue(null),destroy:vi.fn(),reconcileDeletion} as unknown as SandboxConnector;
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);
      const secret=await secrets.save(tenant,'connection:sandbox','fixture');
      await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id) VALUES($1,'sandbox','sandbox','fixture','fixture',$2),($1,'model','model','fixture','fixture',NULL)",[tenant,secret]);
      await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')",[tenant]);
      await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition,sandbox) VALUES($1,$2,'agent','sandbox','model',$3,$4)",[tenant,session,{connections:[{id:'sandbox',provider:'fixture',config:{}}]},{id:'pending-purge',state:'running'}]);
      await expect(new SandboxLifecycle(pool,secrets,()=>connector).close(tenant,session)).rejects.toMatchObject({code:'sandbox_deletion_unconfirmed'});
      const pending=(await pool.query('SELECT state,detail FROM resource_operations WHERE tenant_id=$1',[tenant])).rows[0];
      expect(pending).toMatchObject({state:'unknown',detail:{provider_operation_id:'provider-purge-123'}});
      expect((await pool.query('SELECT state FROM sessions WHERE tenant_id=$1',[tenant])).rows[0].state).toBe('closing');
      expect(await new SandboxLifecycle(pool,secrets,()=>connector).close(tenant,session)).toEqual({state:'closed'});
      expect(reconcileDeletion).toHaveBeenCalledTimes(2);
      expect(connector.destroy).not.toHaveBeenCalled();
    } finally {
      for(const table of ['resource_operations','sessions','agents','connections','secrets','tenants'])await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);
      await pool.end();
    }
  });

  it('keeps close pending when endpoints survive expired compute, then reconciles without another compute deletion', async () => {
    const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant=`endpoint-${randomUUID()}`,session=randomUUID();
    const secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,9)));
    const cleanup=vi.fn().mockRejectedValueOnce(new Error('endpoint_delete_response_lost')).mockResolvedValue(undefined);
    const connector={inspect:vi.fn().mockResolvedValue(null),destroy:vi.fn(),cleanupAssociatedResources:cleanup} as unknown as SandboxConnector;
    const lifecycle=new SandboxLifecycle(pool,secrets,()=>connector);
    try{
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);
      const secret=await secrets.save(tenant,'connection:sandbox','fixture');
      await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id) VALUES($1,'sandbox','sandbox','fixture','fixture',$2),($1,'model','model','fixture','fixture',NULL)",[tenant,secret]);
      await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')",[tenant]);
      await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition,sandbox) VALUES($1,$2,'agent','sandbox','model',$3,$4)",[tenant,session,{connections:[{id:'sandbox',provider:'fixture',config:{}}]},{id:'expired-compute',state:'running'}]);
      await expect(lifecycle.close('foreign',session)).rejects.toMatchObject({code:'session_not_found'});
      expect(cleanup).not.toHaveBeenCalled();
      await expect(lifecycle.close(tenant,session)).rejects.toMatchObject({code:'sandbox_deletion_unconfirmed'});
      expect((await pool.query('SELECT state FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,session])).rows[0].state).toBe('closing');
      expect((await pool.query('SELECT state FROM resource_operations WHERE tenant_id=$1',[tenant])).rows[0].state).toBe('unknown');
      expect(await lifecycle.close(tenant,session)).toEqual({state:'closed'});
      expect(cleanup).toHaveBeenCalledTimes(2);expect(cleanup).toHaveBeenLastCalledWith('expired-compute');
      expect(connector.destroy).not.toHaveBeenCalled();
      const operations=(await pool.query('SELECT state FROM resource_operations WHERE tenant_id=$1',[tenant])).rows;
      expect(operations).toEqual([{state:'completed'}]);
    }finally{
      for(const table of ['resource_operations','sessions','agents','connections','secrets','tenants'])await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);
      await pool.end();
    }
  });
});
it.skipIf(!process.env.TEST_DATABASE_URL)('does not delete the source of an unknown checkpoint during close',async()=>{
 const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant='checkpoint-close-'+randomUUID(),session=randomUUID(),secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,9)));
 const connector={inspect:vi.fn(async()=>({id:'source',state:'running'})),destroy:vi.fn()} as unknown as SandboxConnector;
 try{
 await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);const secret=await secrets.save(tenant,'connection:s','fixture');
 await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id) VALUES($1,'s','sandbox','fixture','s',$2),($1,'m','model','fixture','m',NULL)",[tenant,secret]);
 await pool.query("INSERT INTO sessions(tenant_id,id,sandbox_connection_id,model_connection_id,definition,sandbox) VALUES($1,$2,'s','m',$3,$4)",[tenant,session,{connections:[{id:'s',provider:'fixture',config:{}}]},{id:'source',state:'running'}]);
 await pool.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,state,detail) VALUES($1,$2,$3,'checkpoint','unknown',$4)",[tenant,randomUUID(),session,{source_id:'source'}]);
 await expect(new SandboxLifecycle(pool,secrets,()=>connector).close(tenant,session)).rejects.toMatchObject({code:'sandbox_checkpoint_unconfirmed'});
 expect(connector.destroy).not.toHaveBeenCalled();expect((await pool.query('SELECT state FROM sessions WHERE tenant_id=$1',[tenant])).rows[0].state).toBe('closing');
 }finally{for(const table of ['resource_operations','sessions','connections','secrets','tenants'])await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);await pool.end();}
});
