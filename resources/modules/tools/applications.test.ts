import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi,afterEach} from 'vitest';
import {z} from 'zod';
import {openDatabase} from '../storage/database.js';
import {SecretStore,SecretCipher} from '../credentials/secret-store.js';
import {Connections,type ConnectionAdapter} from '../connections/connections.js';
import {Sessions} from '../execution/sessions.js';
import {Runs} from '../execution/runs.js';
import {ToolBroker} from './broker.js';
afterEach(()=>vi.unstubAllGlobals());
it.skipIf(!process.env.TEST_DATABASE_URL).each(['todoist','linear','feishu','lark'])('journals %s writes, requires approval, and never replays uncertain effects',async provider=>{
 const isLark=['feishu','lark'].includes(provider);
 const operation=isLark?'send_chat_message':provider==='linear'?'create_issue':'create_task';
 const args=isLark?{chat_id:'fixture-chat',text:'Disposable fixture'}:provider==='linear'?{team_id:'team',title:'Disposable fixture'}:{content:'Disposable fixture'};
 const pool=openDatabase(process.env.TEST_DATABASE_URL!),tenant=`app-broker-${randomUUID()}`;const secrets=new SecretStore(pool,new SecretCipher(randomBytes(32)));
 const adapters:ConnectionAdapter[]=['sandbox','model'].map(kind=>({kind:kind as 'sandbox'|'model',provider:'fixture',config:z.object({}),capabilities:[],async validate(){return {operations:[]};}}));
 const connections=new Connections(pool,secrets,adapters);const sessions=new Sessions(pool,connections,[{id:'fixture',version:'1',capabilities:['tools'],model_providers:['fixture']}]);
 let writes=0,lost=false;vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{if(String(url).endsWith('/internal'))return new Response(JSON.stringify({code:0,tenant_access_token:'app-private'}));if(String(url).includes('/chats?')||String(url).endsWith('/chats'))return new Response(JSON.stringify({code:0,data:{items:[]}}));if(String(url).endsWith('/user')||JSON.parse(init.body??'{}').query?.includes('viewer'))return new Response(JSON.stringify({email:'fixture@example.test'}));expect(init.headers.Authorization).toBe('Bearer app-private');writes++;return new Response(JSON.stringify(isLark?{code:lost?999999:0,data:{message_id:'fixture-message'}}:provider==='linear'?{data:{issueCreate:{success:true,issue:{id:'task-1'}}},...(lost?{errors:[{message:'response resolver failed'}]}:{})}:{id:'task-1'}),{status:lost&&provider==='todoist'?503:200});}));
 try{
 await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)',[tenant]);const ids:any={};
 for(const kind of ['sandbox','model'] as const){const c=await connections.create(tenant,{kind,provider:'fixture',name:kind,credential:'fixture'});await connections.validate(tenant,c.id);await connections.patch(tenant,c.id,{enabled:true});ids[kind]=c.id;}
 const tool=await connections.create(tenant,{kind:'tool',provider,name:'Tasks',credential:isLark?JSON.stringify({app_id:'fixture-app',app_secret:'fixture-secret'}):'app-private',config:{operations:[operation]}});await connections.validate(tenant,tool.id);await connections.patch(tenant,tool.id,{enabled:true});
 const agent=await sessions.createAgent(tenant,{name:'Agent',harness:{id:'fixture',version:'1'},tools:[{name:'tasks',required_at_start:true}]});const session=await sessions.create(tenant,{agent_id:agent.id,sandbox_connection_id:ids.sandbox,model_connection_id:ids.model,tools:{tasks:tool.id}});
 const run=randomUUID(),lease={tenant_id:tenant,id:run,generation:1,lease_owner:'worker'};await pool.query("INSERT INTO runs(tenant_id,id,session_id,idempotency_key,request_hash,input,state,lease_owner,lease_until,generation) VALUES($1,$2,$3,'key','hash','input','running','worker',now()+interval '5 minutes',1)",[tenant,run,session.id]);
 const broker=new ToolBroker(pool,secrets),runs=new Runs(pool);const call={id:randomUUID(),binding:'tasks',operation,arguments:args};
 expect((await broker.process(lease,call)).state).toBe('waiting_approval');expect(writes).toBe(0);const approval=(await pool.query('SELECT id FROM approvals WHERE tenant_id=$1 ORDER BY created_at',[tenant])).rows[0];await runs.decide(tenant,approval.id,true);
 expect((await broker.process(lease,call)).state).toBe('completed');expect((await broker.process(lease,call)).state).toBe('completed');expect(writes).toBe(1);
 lost=true;const second={...call,id:randomUUID()};expect((await broker.process(lease,second)).state).toBe('waiting_approval');const next=(await pool.query("SELECT id FROM approvals WHERE tenant_id=$1 AND state='pending'",[tenant])).rows[0];await runs.decide(tenant,next.id,true);expect((await broker.process(lease,second)).state).toBe('unknown');expect((await new ToolBroker(pool,secrets).process(lease,second)).state).toBe('unknown');expect(writes).toBe(2);
 const stored=(await pool.query('SELECT result,execution_policy FROM tool_calls WHERE tenant_id=$1',[tenant])).rows;expect(JSON.stringify(stored)).not.toContain('app-private');
 }finally{await pool.end();}
});
