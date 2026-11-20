import {it,expect,vi} from 'vitest';
import {ociAdapter} from './runtime-adapter.js';
import type {ImageDefinition} from './images.js';
const definition=(protocol:ImageDefinition['protocol']):ImageDefinition=>({id:'custom.test',name:'Test',version:'1',capabilities:['conversation','tools'],model_providers:['anthropic-compatible'],source:'oci',protocol,image:{reference:'docker.io/library/test@sha256:'+'a'.repeat(64),digest:'sha256:'+'a'.repeat(64),platform:'linux/amd64',user:'root'},command:['/image/agent'],registration_digest:'test'});
const model={base_url:'https://proxy.example/v1',model:'test-model',credential:'scoped-grant'};
it.each(['hexagon-json-v1','opencode-v1','pi-v1','aider-v1','claude-code-v1'] as const)('uses image-owned dependencies for %s and propagates scoped model access',async protocol=>{
 const adapter=ociAdapter(definition(protocol));const connector={execute:vi.fn().mockResolvedValue({exit_code:0}),write:vi.fn()};await adapter.install(connector as any,'sandbox');
 for(const args of connector.execute.mock.calls)expect(args[1]).not.toMatch(/npm install|pip install|curl/);
 const request=adapter.invocation('run','hello',model,'native-session');expect(JSON.stringify(request)).toContain('scoped-grant');
 if(protocol!=='aider-v1')expect(request.command[0]).toBe('/image/agent');
 if(protocol==='hexagon-json-v1')expect(JSON.parse(request.stdin!)).toMatchObject({native_session:'native-session',model:{model:'test-model'}});
});
it('rejects absent, malformed and duplicate custom final results',()=>{
 const a=ociAdapter(definition('hexagon-json-v1')),result=JSON.stringify({type:'hexagon.result',text:'OK',failed:false,native_session:'next'});
 expect(a.result(result)).toMatchObject({text:'OK',failed:false,native_session:'next'});
 for(const text of ['',result+'\n'+result,JSON.stringify({type:'hexagon.result',text:'OK'})])expect(a.result(text).failed).toBe(true);
});
it('requires an explicit successful Claude result and preserves native continuation',()=>{
 const a=ociAdapter(definition('claude-code-v1'));expect(a.result(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'OK',session_id:'native'}))).toEqual({text:'OK',native_session:'native',failed:false});
 expect(a.result(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'partial'})).failed).toBe(true);
 expect(a.invocation('r','hello',model,'native').command).toContain('--resume');
});
it('adapts DeepSeek headless finals, rejects incomplete/duplicate turns, and retains continuation',()=>{
 const a=ociAdapter(definition('deepseek-v1'));
 const final=JSON.stringify({type:'final',text:'OK',sessionId:'session-next',reason:{kind:'completed'}});
 expect(a.result(final)).toEqual({text:'OK',native_session:'session-next',failed:false});
 expect(a.result(final+'\n'+final).failed).toBe(true);
 expect(a.result(JSON.stringify({type:'final',text:'partial',reason:{kind:'interrupted'}})).failed).toBe(true);
 const request=a.invocation('run','hello',model,'session-next');
 expect(request.command).toEqual(['python3','/tmp/hexagon-runtime/deepseek-runner.py']);
 expect(JSON.parse(request.stdin!)).toMatchObject({native_session:'session-next',model:{model:'test-model'}});
 expect(request.env).toMatchObject({HEXAGON_MODEL_KEY:'scoped-grant',HEXAGON_DSH_COMMAND:'["/image/agent"]'});
});

it.each(['codex-v1','hermes-v1','openclaw-v1'] as const)('installs only the %s wrapper and preserves explicit state and scoped grants',async protocol=>{
 const adapter=ociAdapter(definition(protocol));const connector={execute:vi.fn(),write:vi.fn()};
 await adapter.install(connector as any,'sandbox');expect(connector.execute).not.toHaveBeenCalled();
 expect(connector.write).toHaveBeenCalledTimes(protocol==='openclaw-v1'?2:1);
 const request=adapter.invocation('run','hello',{...model,provider:'openai-responses'},'native',{token:'tool-grant',definitions:[]});
 expect(request.command).toEqual(['python3','/tmp/hexagon-runtime/managed-cli-runner.py']);
 expect(JSON.parse(request.stdin!)).toMatchObject({adapter:protocol,native_session:'native',command:['/image/agent']});
 expect(request.stdin).not.toContain('scoped-grant');expect(request.stdin).not.toContain('tool-grant');
 expect(request.env).toEqual({HEXAGON_MODEL_KEY:'scoped-grant',HEXAGON_TOOL_TOKEN:'tool-grant'});
});
