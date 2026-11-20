import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {openDatabase} from '../storage/database.js';
import {SecretCipher,SecretStore} from '../credentials/secret-store.js';
import {SandboxLifecycle} from '../sandboxes/lifecycle.js';
import {HarnessRegistry,type HarnessAdapter} from './harness.js';
import {ExecutionWorker} from './worker.js';
import {Runs} from './runs.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Terminal model failure attribution',()=>{
 it('classifies only observed failures and preserves success after a recovered model error',async()=>{
  const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant='result-'+randomUUID(),session=randomUUID();
  const secrets=new SecretStore(pool,new SecretCipher(Buffer.alloc(32,7))),runs=new Runs(pool);
  let answer:{text:string;failed:boolean}={text:'',failed:true};
  const harness:HarnessAdapter={definition:{id:'fixture',version:'1',capabilities:[],model_providers:[]},install:async()=>{},invocation:()=>({id:'unused',command:['unused'],env:{}}),result:()=>answer};
  const worker=new ExecutionWorker(pool,secrets,new SandboxLifecycle(pool,secrets,()=>{throw Error('no cloud in deterministic test');}),new HarnessRegistry([harness]));
  try{
   await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);
   await pool.query("INSERT INTO connections(tenant_id,id,kind,provider,name,status,enabled) VALUES($1,'sandbox','sandbox','fixture','fixture','ready',true),($1,'model','model','fixture','fixture','ready',true)",[tenant]);
   const definition={harness:{id:'fixture',version:'1'}};
   await pool.query('INSERT INTO sessions(tenant_id,id,sandbox_connection_id,model_connection_id,definition) VALUES($1,$2,\'sandbox\',\'model\',$3)',[tenant,session,definition]);
   const cases=[{status:401,code:'model_authentication_failed'},{status:403,code:'model_authentication_failed'},{status:429,code:'model_rate_limited'},{status:503,code:'model_request_failed'},{status:null,code:'model_transport_failed'},{status:200,code:'harness_execution_failed'},{status:429,success:true,code:undefined}];
   for(const [index,item] of cases.entries()){
    const run=await runs.submit(tenant,session,String(index),'Task');const lease=await runs.claim('result-test');
    expect(lease.id).toBe(run.id);await runs.advance(lease,'provisioning');await runs.advance(lease,'running');
    await pool.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'model.response',$3)",[tenant,run.id,{status:item.status,transport:item.status===null?'failed':'received'}]);
    answer=item.success?{text:'Recovered result',failed:false}:{text:'',failed:true};
    await (worker as any).finish(lease,{id:session,tenant_id:tenant,definition},{state:'exited',exit_code:item.success?0:1});
    const result=await runs.get(tenant,run.id);expect(result.state).toBe(item.success?'completed':'failed');expect(result.error?.code).toBe(item.code);if(item.success)expect(result.output.text).toBe('Recovered result');
   }
  }finally{
   for(const table of ['events','runs','sessions','connections','tenants'])await pool.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);await pool.end();
  }
 });
});
