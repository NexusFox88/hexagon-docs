import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {openDatabase} from '../storage/database.js';
import {SecretCipher,SecretStore} from '../credentials/secret-store.js';
import {SandboxLifecycle} from './lifecycle.js';
import {ResourceOperations} from './operations.js';
import type {SandboxConnector} from './connector.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Cloud operation review',()=>{
 it('backs off uncertain results, preserves acknowledgement and tenant isolation, and reconciles without another create',async()=>{
  const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant=randomUUID(),session=randomUUID();
  const secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,7)));
  const connector={create:vi.fn().mockRejectedValue(new Error('lost response')),findByOperation:vi.fn().mockResolvedValue([]),inspect:vi.fn(),destroy:vi.fn()} as unknown as SandboxConnector;
  const lifecycle=new SandboxLifecycle(pool,secrets,()=>connector),operations=new ResourceOperations(pool,lifecycle);
  try{
   await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);
   const secret=await secrets.save(tenant,'connection:sandbox','fixture');
   await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,secret_id,status,enabled) VALUES($1,'sandbox','sandbox','fixture','fixture',$2,'ready',true),($1,'model','model','fixture','fixture',NULL,'ready',true)",[tenant,secret]);
   await pool.query("INSERT INTO agents(tenant_id,id,name,definition) VALUES($1,'agent','fixture','{}')",[tenant]);
   await pool.query("INSERT INTO sessions(tenant_id,id,agent_id,sandbox_connection_id,model_connection_id,definition) VALUES($1,$2,'agent','sandbox','model',$3)",[tenant,session,{resources:{timeout_seconds:600},network:{mode:'unrestricted',allowed_hosts:[]},connections:[{id:'sandbox',provider:'fixture',config:{}}]}]);
   await expect(lifecycle.provision(tenant,session)).rejects.toMatchObject({code:'sandbox_creation_unconfirmed'});
   const first=(await operations.list(tenant)).operations[0];
   expect(first).toMatchObject({state:'unknown',attempt_count:1,review_state:'automatic'});
   expect(new Date(first.next_check_at).getTime()).toBeGreaterThan(Date.now());
   await expect(lifecycle.provision(tenant,session,true)).rejects.toMatchObject({code:'resource_reconciliation_scheduled'});
   expect(connector.findByOperation).not.toHaveBeenCalled();
   await expect(operations.review('foreign',first.id,{action:'acknowledge'})).rejects.toMatchObject({code:'resource_operation_not_found'});
   expect((await operations.list('foreign')).operations).toEqual([]);
   for(let i=0;i<2;i++)await operations.review(tenant,first.id,{action:'reconcile',note:'Provider reports no matching resource; absence is inconclusive.'});
   expect(await operations.get(tenant,first.id)).toMatchObject({state:'unknown',attempt_count:3,review_state:'needs_review'});
   const ack=await operations.review(tenant,first.id,{action:'acknowledge',note:'Follow up with provider.'});
   expect(ack).toMatchObject({state:'unknown',review_state:'acknowledged'});expect(ack.reviews).toHaveLength(3);
   expect((await pool.query('SELECT state FROM sessions WHERE tenant_id=$1',[tenant])).rows[0].state).toBe('open');
   await expect(lifecycle.provision(tenant,session,true)).rejects.toMatchObject({code:'resource_review_required'});
   vi.mocked(connector.findByOperation).mockResolvedValue([{id:'candidate-a',state:'running'},{id:'candidate-b',state:'running'}]);
   expect(await operations.review(tenant,first.id,{action:'reconcile'})).toMatchObject({state:'unknown',reason:'multiple_resources'});
   expect((await pool.query('SELECT sandbox FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,session])).rows[0].sandbox).toBeNull();
   expect(connector.create).toHaveBeenCalledTimes(1);
   vi.mocked(connector.findByOperation).mockResolvedValue([{id:'late-resource',state:'running'}]);
   expect(await operations.review(tenant,first.id,{action:'reconcile'})).toMatchObject({state:'completed',provider_resource_id:'late-resource'});
   expect(connector.create).toHaveBeenCalledTimes(1);
   await expect(operations.review(tenant,first.id,{action:'acknowledge'})).rejects.toMatchObject({code:'resource_operation_not_pending'});
  }finally{
   for(const table of ['resource_operation_reviews','resource_operations','sessions','agents','connections','secrets','tenants'])await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);
   await pool.end();
  }
 });
});


describe('Snapshot operation reconciliation routing',()=>{
 it.each(['checkpoint','restore'])('reconciles %s without provisioning a fresh Session',async(kind)=>{
  const operation={id:'operation',session_id:'session',kind,state:'unknown'};
  const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT * FROM resource_operations')?[operation]:sql.startsWith('SELECT state FROM sessions')?[{state:kind==='checkpoint'?'pausing':'resuming'}]:[]}));
  const db={query,release:vi.fn()},pool={query,connect:async()=>db} as any;
  const lifecycle={pause:vi.fn(),resume:vi.fn(),provision:vi.fn(),close:vi.fn()} as any;
  const operations=new ResourceOperations(pool,lifecycle);
  vi.spyOn(operations,'get').mockResolvedValue(operation as any);
  await operations.review('tenant','operation',{action:'reconcile'});
  expect(lifecycle.provision).not.toHaveBeenCalled();
  if(kind==='checkpoint')expect(lifecycle.pause).toHaveBeenCalledWith('tenant','session','sandbox');
  else expect(lifecycle.resume).toHaveBeenCalledWith('tenant','session');
 });
});
