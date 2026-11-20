import type {ConnectionAdapter} from '../../modules/connections/connections.js';
import {anthropicModelConfig} from './anthropic-compatible.js';
/** Chat Completions is a wire protocol, not a vendor or model-routing gateway. */
export const openaiModelConnection:ConnectionAdapter={
 kind:'model',provider:'openai-compatible',config:anthropicModelConfig,capabilities:[],
 async validate(config,credential){
  const model=anthropicModelConfig.parse(config),base=model.base_url.replace(/\/+$/,'');
  const response=await fetch(`${base.endsWith('/v1')?base:base+'/v1'}/chat/completions`,{method:'POST',signal:AbortSignal.timeout(30000),redirect:'error',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({model:model.model,max_tokens:16,messages:[{role:'user',content:'Reply OK.'}]})});
  if(!response.ok){await response.body?.cancel();throw new Error('model_validation_failed');}
  const result=await response.json() as {choices?:{message?:{role?:string;content?:unknown}}[]};
  if(!Array.isArray(result.choices)||!result.choices.some(c=>c.message?.role==='assistant'&&typeof c.message.content==='string'))throw new Error('model_response_invalid');
  return {operations:['bounded_chat_completions_request']};
 }
};
