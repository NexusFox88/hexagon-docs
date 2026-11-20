import type {ConnectionAdapter} from '../../modules/connections/connections.js';
import {anthropicModelConfig} from './anthropic-compatible.js';
export const responsesModelConnection:ConnectionAdapter={kind:'model',provider:'openai-responses',config:anthropicModelConfig,capabilities:[],async validate(config,credential){
 const model=anthropicModelConfig.parse(config),base=model.base_url.replace(/\/+$/,'').replace(/\/v1$/,'');
 const response=await fetch(base+'/v1/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({model:model.model,input:'Reply OK.',max_output_tokens:64,store:false})});
 if(!response.ok){await response.body?.cancel();throw new Error('model_validation_failed');}
 const result=await response.json() as any;if(result.object!=='response'||!['completed','incomplete'].includes(result.status)||!Array.isArray(result.output))throw new Error('model_response_invalid');
 return {operations:['bounded_responses_request']};
}};
