import {inspectServerlessWorkspace} from './serverless-inspection.js';
import {verifiedWorkspaceRead,verifiedOpenClawExec} from './serverless-evidence.js';
/** Real, billable cloud acceptance. Uses configured local connections; IDs stay in private evidence. */
import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {Hexagon} from '../sdk/typescript/index.js';
const provider=process.argv[2],earlyIdle=process.argv.includes('--before-idle-deadline');
const harnessKey=process.argv[3]?.startsWith('--')? 'pi':process.argv[3]??'pi';
const reportName=provider+(harnessKey==='pi'?'':'-'+harnessKey)+(earlyIdle?'-early-idle':'');
if(!provider||provider==='daytona')throw Error('Provide a supported Sandbox provider (Daytona excluded)');
while(await access('.local/serverless-harness-pause').then(()=>true,()=>false))await new Promise(r=>setTimeout(r,1000));
const client=await Hexagon.local(),connections=(await client.listConnections()).connections;
const candidates=connections.filter((c:any)=>c.kind==='sandbox'&&c.provider===provider&&c.enabled&&c.status==='ready');
const sandbox=(provider==='e2b'&&harnessKey!=='pi'?candidates.find((c:any)=>c.config.template!=='base'):undefined)??candidates[0];
if(!sandbox)throw Error('No ready Sandbox connection for '+provider);
const catalog=await client.catalog();
const directory=resolve(harnessKey==='pi'?'.local/serverless-acceptance':'.local/serverless-harness-acceptance');await mkdir(directory,{recursive:true,mode:0o700});
const report:any={provider,harness:harnessKey,before_idle_deadline:earlyIdle,started_at:new Date().toISOString(),journeys:[]};
const save=()=>writeFile(resolve(directory,reportName+'.json'),JSON.stringify(report,null,2),{mode:0o600});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const terminal=(state:string)=>['completed','failed','cancelled'].includes(state);
for(const language of ['typescript','python']){
 const id=harnessKey.startsWith('oci-')?`custom.matrix-${language}-${harnessKey}`:harnessKey;
 const harness=catalog.harnesses.find((h:any)=>h.id===id);
 const preferred=language==='python'?'openai-compatible':'anthropic-compatible';
 const protocol=harness?.model_providers.includes(preferred)?preferred:harness?.model_providers[0]??preferred;
 const model=connections.find((c:any)=>c.kind==='model'&&c.provider===protocol&&c.config.model==='MiniMax-M3'&&c.enabled&&c.status==='ready');
 const row:any={language,protocol};report.journeys.push(row);await save();
 const invoke=async(method:string,args:any[]=[],kwargs:any={}):Promise<any>=>{
  if(language==='typescript')return (client as any)[method](...args);
  const source='import json,sys\nfrom hexagon import Hexagon\nc=Hexagon.local()\nm,a,k=json.loads(sys.argv[1])\nprint(json.dumps(getattr(c,m)(*a,**k)))';
  return JSON.parse((await promisify(execFile)('python3',['-c',source,JSON.stringify([method,args,kwargs])],{env:{...process.env,PYTHONPATH:resolve('sdk/python')},maxBuffer:8*1024*1024})).stdout);
 };
 const waitRun=async(id:string)=>{for(let n=0;n<600;n++){const r=await invoke('run',[id]);if(terminal(r.state))return r;await delay(1000);}throw Error('run_timeout');};
 try{
  if(!harness)throw Error('harness_not_registered');
  if(harness.image&&!catalog.connections.find((c:any)=>c.kind==='sandbox'&&c.provider===provider)?.capabilities.includes('oci_image')){row.status='unsupported_oci_provider';continue;}
  if(!model)throw Error('No ready MiniMax-M3 '+protocol+' connection');
  const definition={name:(earlyIdle?'Early standby acceptance · ':'Serverless acceptance · ')+provider+' · '+language,harness:{id:harness.id,version:harness.version},sandbox_connection_id:sandbox.id,model_connection_id:model.id,resources:{timeout_seconds:900,idle_timeout_seconds:earlyIdle?180:15}};
  row.preflight=language==='typescript'?await client.preflightSession(definition):await invoke('preflight_session',[],definition);
  const session=language==='typescript'?await client.createSession(definition):await invoke('create_session',[],definition);row.session=session.id;await save();
  const passphrase='MEMORY-'+randomUUID().slice(0,8),cache='FILE-'+randomUUID().slice(0,8);
  const first=await invoke('submit',[session.id,`Our conversation password is ${passphrase}. Separately, the file code is ${cache}. These are DIFFERENT values. Use bash to write only the file code into hexagon-workspace-file in the working directory. Reply with the conversation password.`,randomUUID()]);row.first=first.id;await save();
  const one=await waitRun(first.id);if(one.state!=='completed')throw Error(one.error?.code??'first_failed');
  row.first_completed=true;
  if(harnessKey!=='pi'){const before=await inspectServerlessWorkspace(session.id);if(before.file!==cache)throw Error('first_file_mismatch');row.native_before=before.native_session;if(!row.native_before)throw Error('missing_native_session');}
row.original_resource=(await invoke('session',[session.id])).sandbox.id;
  if(earlyIdle){
   if(row.preflight.lifecycle.mode!=='provider_managed')throw Error('early_standby_requires_automatic_provider');
   await delay(60000);row.state_before_new_task=(await invoke('session',[session.id])).state;
   if(row.state_before_new_task!=='open')throw Error('early_standby_session_already_paused');
  }else{
  for(let n=0;n<180;n++){if((await invoke('session',[session.id])).state==='paused'){row.auto_slept=true;break;}await delay(1000);}
  if(!row.auto_slept)throw Error('idle_did_not_sleep');await save();
  if(row.preflight.lifecycle.mode==='provider_managed')await delay(45000);
  }
  await save();
  const second=await invoke('submit',[session.id,'Recall the conversation password (the MEMORY marker) from the previous turn. It is DIFFERENT from the FILE code. Use bash to cat hexagon-workspace-file without rewriting it. Reply with both values, labeling the conversation password and file code separately.',randomUUID()]);row.second=second.id;await save();
  const two=await waitRun(second.id);if(two.state!=='completed'||!two.output?.text.includes(passphrase)||!two.output?.text.includes(cache))throw Error(two.error?.code??'continuation_failed');
  // Verify actual native tool output, not only the final answer's claim.
  if(harnessKey==='pi')row.file_verified=await verifiedWorkspaceRead((id,after)=>invoke('events',[id,after]),second.id,cache);
  else{const after=await inspectServerlessWorkspace(session.id);row.file_verified=after.file===cache;row.native_after=after.native_session;row.native_reused=!!row.native_before&&row.native_before===after.native_session;if(!row.native_reused)throw Error('native_session_changed');}
  if(!row.file_verified)throw Error('missing_real_file_read');
  if(harnessKey==='oci-openclaw'){row.shell_verified=await verifiedOpenClawExec((id,after)=>invoke('events',[id,after]),second.id);if(!row.shell_verified)throw Error('restored_shell_not_usable');}
  row.restored_resource=(await invoke('session',[session.id])).sandbox.id;row.context_retained=true;row.auto_woke=true;row.passed=true;row.status='passed';await save();
 }catch(e:any){row.status='failed';row.error=e.code??e.message;process.exitCode=1;await save();}
 finally{
  if(row.session){try{for(const id of [row.first,row.second].filter(Boolean)){if(!terminal((await invoke('run',[id])).state)){await invoke('cancel',[id]);await waitRun(id);}}await invoke('close',[row.session]);row.cleanup=(await invoke('session',[row.session])).state;}catch(e:any){row.cleanup_error=e.code??e.message;process.exitCode=1;}}
  await save();console.log(JSON.stringify({provider,language,passed:row.passed??false,file_verified:row.file_verified??false,error:row.error,cleanup:row.cleanup}));
 }
}
console.log('Private evidence: '+resolve(directory,reportName+'.json'));
