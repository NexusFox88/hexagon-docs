/** Project only observable, bounded activity; never infer or expose hidden reasoning. */
export function harnessActivity(data:unknown):{type:string;data:Record<string,unknown>}|undefined{
 const text=(data as any)?.text;if(typeof text!=='string'||text.length>65536||!text.endsWith('\n'))return;
 let e;try{e=JSON.parse(text);}catch{return;}
 if(!e||typeof e!=='object')return;
 if(e.type==='hexagon.openclaw.activity'&&['start','result'].includes(e.phase)&&typeof e.name==='string')return {type:e.phase==='start'?'agent.activity.started':'agent.activity.completed',data:{kind:'tool',name:e.name.slice(0,256),...(typeof e.id==='string'?{id:e.id.slice(0,512)}:{}),...(typeof e.is_error==='boolean'?{is_error:e.is_error}:{})}};
 const item=e.item;
 if(['item.started','item.completed'].includes(e.type)&&['command_execution','mcp_tool_call','file_change'].includes(item?.type))return {type:e.type==='item.started'?'agent.activity.started':'agent.activity.completed',data:{kind:item.type,...(typeof item.id==='string'?{id:item.id.slice(0,512)}:{}),...(typeof item.tool==='string'?{name:item.tool.slice(0,256)}:{})}};
 if(['tool_use','tool_result'].includes(e.type)&&typeof e.name==='string')return {type:e.type==='tool_use'?'agent.activity.started':'agent.activity.completed',data:{kind:'tool',name:e.name.slice(0,256),...(typeof e.is_error==='boolean'?{is_error:e.is_error}:{})}};
 // Text is already redacted by Runtime. These are user-visible assistant messages, not reasoning.
 if(e.type==='item.completed'&&item?.type==='agent_message'&&typeof item.text==='string')return {type:'agent.message',data:{text:item.text.slice(0,32768)}};
 if(e.type==='text'&&typeof e.text==='string')return {type:'agent.message.delta',data:{text:e.text.slice(0,32768)}};
}
