import {initializationInput} from '../execution/initialization.js';
import {managedCliProtocols,managedCliResult} from './managed-cli.js';
import {readFile} from 'node:fs/promises';
import type {HarnessAdapter} from '../execution/harness.js';
import type {ImageDefinition} from './images.js';
import {openCodeAdapter} from '../../integrations/harnesses/opencode.js';
import {piAdapter} from '../../integrations/harnesses/pi.js';
import {artifactDelivery} from '../../integrations/harnesses/artifact-delivery.js';
/** OCI owns dependencies. Adapters translate protocols without reinstalling a Harness. */
export function ociAdapter(definition:ImageDefinition):HarnessAdapter{
 const protocol=definition.protocol;
 return {definition:{...definition,capabilities:[...new Set([...definition.capabilities,...(['opencode-v1','pi-v1','codex-v1','hermes-v1','claude-code-v1','openclaw-v1'].includes(protocol)?['initialization']:[])])]},async install(connector,sandbox){
  if(managedCliProtocols.includes(protocol))await connector.write(sandbox,'/tmp/hexagon-runtime/managed-cli-runner.py',await readFile(new URL('./managed-cli-runner.py',import.meta.url)));
  if(protocol==='openclaw-v1')await connector.write(sandbox,'/tmp/hexagon-runtime/openclaw-observer.mjs',await readFile(new URL('./openclaw-observer.mjs',import.meta.url)));
  if(protocol==='pi-v1'){
   const result=await connector.execute(sandbox,'mkdir -p /tmp/hexagon-pi');if(result.exit_code!==0)throw new Error('harness_install_failed');
   await connector.write(sandbox,'/tmp/hexagon-pi/hexagon-extension.mjs',await readFile(new URL('../../integrations/harnesses/pi-extension.mjs',import.meta.url)));
  }
  if(protocol==='deepseek-v1')await connector.write(sandbox,'/tmp/hexagon-runtime/deepseek-runner.py',await readFile(new URL('./deepseek-runner.py',import.meta.url)));
  if(protocol==='aider-v1')await connector.write(sandbox,'/tmp/hexagon-runtime/aider-runner.py',await readFile(new URL('./aider-runner.py',import.meta.url)));
 },invocation(id,input,model,nativeSession,tools,initialization){
  if(managedCliProtocols.includes(protocol))return {id,command:['python3','/tmp/hexagon-runtime/managed-cli-runner.py'],stdin:JSON.stringify({adapter:protocol,command:definition.command,run_id:id,initialization,input:`${input}\n\n${artifactDelivery(id)}`,model:{provider:model.provider,base_url:model.base_url,model:model.model},native_session:nativeSession,tools:tools?.definitions??[]}),env:{HEXAGON_MODEL_KEY:model.credential,HEXAGON_TOOL_TOKEN:tools?.token??''},...(tools?{tools}:{})};
  if(protocol==='opencode-v1'){const request=openCodeAdapter.invocation(id,input,model,nativeSession,tools,initialization);return {...request,command:[...definition.command,...request.command.slice(1)]};}
  if(protocol==='pi-v1'){const request=piAdapter.invocation(id,input,model,nativeSession,tools,initialization);return {...request,command:[...definition.command,...request.command.slice(2)]};}
  if(protocol==='claude-code-v1'){
   input=initializationInput(input,nativeSession,initialization);
   const mcp=tools?{mcpServers:{hexagon:{command:'python3',args:['/tmp/hexagon-runtime/tool_bridge.py'],env:{HEXAGON_RUN_ID:id,HEXAGON_TOOL_TOKEN:tools.token,HEXAGON_TOOLS:JSON.stringify(tools.definitions)}}}}:undefined;
   return {id,...(tools?{tools}:{}),command:[...definition.command,'-p','--output-format','json','--model',model.model,'--bare',...(initialization?.system?['--append-system-prompt',initialization.system]:[]),'--permission-mode','dontAsk','--allowedTools','Bash,Read,Write,Edit,Glob,Grep,mcp__hexagon__*',...(nativeSession?['--resume',nativeSession]:[]),...(mcp?['--strict-mcp-config','--mcp-config',JSON.stringify(mcp)]:[]),'--',`${input}\n\n${artifactDelivery(id)}`],env:{ANTHROPIC_API_KEY:model.credential,ANTHROPIC_BASE_URL:model.base_url.replace(/\/+$/,'').replace(/\/v1$/,''),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}};
  }
  return {id,command:protocol==='deepseek-v1'?['python3','/tmp/hexagon-runtime/deepseek-runner.py']:protocol==='aider-v1'?['/venv/bin/python','/tmp/hexagon-runtime/aider-runner.py']:definition.command,stdin:JSON.stringify({protocol:'hexagon-json-v1',run_id:id,initialization,input:['aider-v1','deepseek-v1'].includes(protocol)?`${input}\n\n${artifactDelivery(id)}`:input,model:{base_url:model.base_url,model:model.model},native_session:nativeSession,artifact_directory:`artifacts/${id}`,tools:tools?.definitions??[]}),env:{...(protocol==='deepseek-v1'?{HEXAGON_DSH_COMMAND:JSON.stringify(definition.command)}:{}),HEXAGON_MODEL_KEY:model.credential,HEXAGON_TOOL_TOKEN:tools?.token??''},...(tools?{tools}:{})};
 },result(stdout){
  if(managedCliProtocols.includes(protocol))return managedCliResult(protocol,stdout);
  if(protocol==='opencode-v1')return openCodeAdapter.result(stdout);
  if(protocol==='pi-v1')return piAdapter.result(stdout);
  let result:{text:string;native_session?:string;failed:boolean}|undefined;
  for(const line of stdout.split('\n')){let event;try{event=JSON.parse(line);}catch{continue;}
   if(protocol==='deepseek-v1'&&event.type==='final'){
    if(result)return {text:'',failed:true};result={text:typeof event.text==='string'?event.text:'',native_session:typeof event.sessionId==='string'?event.sessionId:undefined,failed:event.reason?.kind!=='completed'||typeof event.text!=='string'||typeof event.sessionId!=='string'||!event.sessionId||event.sessionId.length>512};continue;
   }
   if(protocol==='claude-code-v1'&&event.type==='result'){
    if(result)return {text:'',failed:true};result={text:typeof event.result==='string'?event.result:'',native_session:typeof event.session_id==='string'?event.session_id:undefined,failed:event.is_error!==false||event.subtype!=='success'};continue;
   }
   if(protocol==='deepseek-v1'||protocol==='claude-code-v1'||event.type!=='hexagon.result')continue;
   if(result||typeof event.text!=='string'||!event.text||typeof event.failed!=='boolean'||(event.native_session!==undefined&&(typeof event.native_session!=='string'||event.native_session.length>512)))return {text:'',failed:true};result=event;
  }return result??{text:'',failed:true};
 }};
}
