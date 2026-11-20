import type {HarnessProtocol} from './protocols.js';
export const managedCliProtocols=['codex-v1','hermes-v1','openclaw-v1'];
const validSession=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512;
const failure=()=>({text:'',failed:true});
/** Success requires an explicit terminal record, never just a partial assistant message. */
export function managedCliResult(protocol:HarnessProtocol,stdout:string):{text:string;native_session?:string;failed:boolean}{
 if(protocol==='openclaw-v1'){
  // Native activity is NDJSON before the CLI's terminal JSON document.
  const resultText=stdout.split('\n').filter(line=>{try{return JSON.parse(line)?.type!=='hexagon.openclaw.activity';}catch{return true;}}).join('\n');
  let event;try{event=JSON.parse(resultText);}catch{return failure();}
  if(!event||typeof event!=='object'||Array.isArray(event))return failure();
  const result=event.result??event;if(!result||typeof result!=='object'||Array.isArray(result))return failure();
  const meta=result.meta;
  const text=Array.isArray(result.payloads)?result.payloads.filter((p:any)=>typeof p?.text==='string').map((p:any)=>p.text).join('\n'):'';
  const native=meta?.agentMeta?.sessionId;
  if(event.ok===false||event.status==='error'||event.status==='in_flight'||meta?.error||meta?.aborted||(Array.isArray(result.payloads)&&result.payloads.some((p:any)=>p?.isError))||!text||!validSession(native))return failure();
  return {text,native_session:native,failed:false};
 }
 let native:string|undefined,text='',terminal=0,failed=false;
 for(const line of stdout.split('\n')){
  let event;try{event=JSON.parse(line);}catch{continue;}
  if(!event||typeof event!=='object'||Array.isArray(event))continue;
  if(protocol==='codex-v1'){
   if(event.type==='thread.started'){if(!validSession(event.thread_id)||(native&&native!==event.thread_id))failed=true;else native=event.thread_id;}
   if(event.type==='item.completed'&&event.item?.type==='agent_message'&&typeof event.item.text==='string')text=event.item.text;
   if(event.type==='turn.completed')terminal++;
   if(event.type==='turn.failed'||event.type==='error')failed=true;
  }else if(protocol==='hermes-v1'&&event.type==='result'){
   terminal++;native=event.session_id;text=event.text;
   if(event.exit_code!==0||event.error)failed=true;
  }
 }
 if(terminal!==1||failed||!validSession(native)||typeof text!=='string'||!text)return failure();
 return {text,native_session:native,failed:false};
}
