import {it,expect} from 'vitest';
import {managedCliResult} from './managed-cli.js';
import {harnessActivity} from './activity.js';
import {protocolContract} from './protocols.js';
const lines=(events:unknown[])=>events.map(e=>JSON.stringify(e)).join('\n')+'\n';
it('Codex requires one completed turn and an unchanged native thread, rejecting partial output',()=>{
 const events=[{type:'thread.started',thread_id:'thread-1'},{type:'item.completed',item:{type:'agent_message',text:'answer'}},{type:'turn.completed'}];
 expect(managedCliResult('codex-v1',lines(events))).toEqual({text:'answer',native_session:'thread-1',failed:false});
 for(const invalid of [events.slice(0,2),[...events,{type:'turn.failed'}],[...events,{type:'turn.completed'}],[...events,{type:'thread.started',thread_id:'other'}]])expect(managedCliResult('codex-v1',lines(invalid)).failed).toBe(true);
});
it('Hermes fails error and duplicate terminal envelopes even when partial text exists',()=>{
 const event={type:'result',session_id:'native',text:'answer',exit_code:0};
 expect(managedCliResult('hermes-v1',lines([event])).native_session).toBe('native');
 for(const events of [[{...event,exit_code:1}],[{...event,error:'provider failed'}],[event,event],[{...event,session_id:''}]])expect(managedCliResult('hermes-v1',lines(events)).failed).toBe(true);
});
it('OpenClaw requires native state and refuses nonterminal, aborted and failed outcomes',()=>{
 const result={payloads:[{text:'answer'}],meta:{agentMeta:{sessionId:'native'}}};
 expect(managedCliResult('openclaw-v1',JSON.stringify(result))).toEqual({text:'answer',native_session:'native',failed:false});
 for(const event of [{status:'in_flight',result},{ok:false,result},{...result,meta:{...result.meta,aborted:true}},{payloads:[{text:'partial'}]}])expect(managedCliResult('openclaw-v1',JSON.stringify(event)).failed).toBe(true);
});
it('projects observable activity without copying reasoning, arguments or shell output',()=>{
 expect(harnessActivity({text:lines([{type:'item.completed',item:{id:'a',type:'reasoning',text:'private'}}])})).toBeUndefined();
 expect(harnessActivity({text:lines([{type:'tool_use',name:'search',input:{secret:'not copied'}}])})).toEqual({type:'agent.activity.started',data:{kind:'tool',name:'search'}});
 expect(harnessActivity({text:'{"type":"tool_use"'})).toBeUndefined();
});
it('OpenClaw activity preserves terminal parsing and excludes tool payloads',()=>{
 const activity={type:'hexagon.openclaw.activity',phase:'start',name:'exec',id:'call-1',arguments:{secret:'private'},result:'private'};
 expect(harnessActivity({text:lines([activity])})).toEqual({type:'agent.activity.started',data:{kind:'tool',name:'exec',id:'call-1'}});
 const result={payloads:[{text:'answer'}],meta:{agentMeta:{sessionId:'native'}}};
 expect(managedCliResult('openclaw-v1',lines([activity])+JSON.stringify(result,null,2)).failed).toBe(false);
 expect(managedCliResult('openclaw-v1',lines([activity])).failed).toBe(true);
 expect(managedCliResult('openclaw-v1',lines([activity])+JSON.stringify({...result,meta:{...result.meta,aborted:true}})).failed).toBe(true);
});
it('declares real wire protocols rather than silently translating model traffic',()=>{
 expect(protocolContract('codex-v1').model_providers).toEqual(['openai-responses']);
 expect(protocolContract('hermes-v1').model_providers).toEqual(['openai-compatible']);
 expect(protocolContract('aider-v1').tools).toBe(false);
});

it.each(['codex-v1','hermes-v1','openclaw-v1'] as const)('fails closed on malformed %s JSON values',protocol=>{
 for(const value of ['null','[]','1','"text"','{"payloads":{},"meta":{}}','{"payloads":[null]}'])expect(managedCliResult(protocol,value).failed).toBe(true);
});
