import {crmApps,salesforceOrigin} from './crm.js';
import {larkApplications} from './lark.js';
import {z} from 'zod';
import type {ConnectionAdapter} from '../../modules/connections/connections.js';
import {ToolAuthenticationError} from '../tools/http-json.js';
import {todoist,notion,deepl} from './productivity.js';
import {tavily,exa} from './search.js';
import {github,slack,linear} from './collaboration.js';
import {googleCalendar,gmail,googleDrive} from './google.js';
import type {AppDefinition,RequestSpec} from './types.js';
import {microsoftApps} from './microsoft.js';
import {googleWorkspaceApps} from './google-workspace.js';
import {projectManagementApps} from './project-management.js';
import {messagingApps} from './messaging.js';
import {businessApps} from './business.js';
import {researchDevelopmentApps} from './research-development.js';
export const applications:AppDefinition[]=[notion,todoist,googleCalendar,exa,tavily,gmail,googleDrive,github,slack,linear,deepl,...microsoftApps,...googleWorkspaceApps,...projectManagementApps,...messagingApps,...businessApps,...researchDevelopmentApps,...larkApplications,...crmApps];
export const application=(provider:string)=>applications.find(app=>app.id===provider);
export function applicationConfig(app:AppDefinition){return z.object({operations:z.array(z.string()).min(1).max(100).optional(),region:z.enum(['free','paid']).optional(),instance_url:z.string().optional(),authentication:z.enum(['api_key','oauth']).default('api_key')}).strict().superRefine((c,ctx)=>{
 if(c.operations?.some(name=>!Object.hasOwn(app.operations,name)))ctx.addIssue({code:'custom',message:'unknown_application_operation',path:['operations']});
 if(c.authentication==='oauth'&&!app.oauth)ctx.addIssue({code:'custom',message:'oauth_not_supported'});
 if(app.id==='salesforce'){if(!c.instance_url||!salesforceOrigin.safeParse(c.instance_url).success)ctx.addIssue({code:'custom',message:'salesforce_instance_invalid',path:['instance_url']});}else if(c.instance_url)ctx.addIssue({code:'custom',message:'instance_not_supported'});
 if(c.region&&app.id!=='deepl')ctx.addIssue({code:'custom',message:'region_not_supported'});
 });}
export function applicationOperations(app:AppDefinition,input:Record<string,unknown>){const config=applicationConfig(app).parse(input);const selected=config.operations??Object.entries(app.operations).filter(([,op])=>!op.write).map(([name])=>name);
 return Object.fromEntries(selected.map(name=>{const op=app.operations[name]!;return [name,{description:op.description,input_schema:op.input_schema,approval:op.write,method:op.write?'POST':'GET',path:name,replay:'never' as const}];}));}
export class AppRequestError extends Error{constructor(readonly code:string,readonly status:number){super(code);}}
export async function applicationRequest(app:AppDefinition,credential:string,spec:RequestSpec,context:{write:boolean}={write:true}){
 const originalCredential=credential;
 if(app.accessToken)credential=await app.accessToken(credential);
 spec=app.authenticate?.(credential,spec)??spec;
 const url=new URL(spec.url);
 for(const [key,value]of Object.entries(spec.query??{}))if(value!==undefined)url.searchParams.set(key,typeof value==='string'?value:JSON.stringify(value));
 const response=await fetch(url,{method:spec.method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...app.headers,...spec.headers,...(app.authHeader?.(credential)??{Authorization:`Bearer ${credential}`})},body:spec.body===undefined?undefined:JSON.stringify(spec.body)});
 if(response.status===401){await response.body?.cancel();throw new ToolAuthenticationError();}
 if(!response.ok){await response.body?.cancel();if(response.status>=400&&response.status<500&&response.status!==408)throw new AppRequestError(response.status===403?'app_permission_denied':response.status===429?'app_rate_limited':'app_request_rejected',response.status);throw new Error('app_remote_outcome_unknown');}
 if(response.status===204)return {success:true};
 const reader=response.body?.getReader();if(!reader)return {success:true};const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024*1024)throw new Error('app_result_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const text=Buffer.concat(chunks).toString('utf8');const result=text?JSON.parse(text):{success:true};
 if(['feishu','lark'].includes(app.id)&&result.code!==0){if([99991661,99991663,99991664,99991665,99991668].includes(result.code))throw new ToolAuthenticationError();if(context.write)throw new Error('app_remote_outcome_unknown');throw new AppRequestError('app_permission_or_request_rejected',400);}
 if(app.id==='slack'&&result.ok===false){if(['invalid_auth','token_revoked','token_expired','not_authed'].includes(result.error))throw new ToolAuthenticationError();throw new AppRequestError(result.error==='missing_scope'?'app_permission_denied':'app_request_rejected',400);}
 if(app.id==='telegram'&&result.ok===false){if(result.error_code===401)throw new ToolAuthenticationError();throw new AppRequestError(result.error_code===429?'app_rate_limited':result.error_code===403?'app_permission_denied':'app_request_rejected',result.error_code??400);}
 if(app.id==='linear'&&result.errors?.length){
  // Resolver errors can occur after a mutation took effect, even with data:null.
  // Never turn that response into a definitive rejection that invites another write.
  if(context.write)throw new Error('app_remote_outcome_unknown');
  throw new AppRequestError('app_request_rejected',400);
 }
 return redactApplicationResult(app,originalCredential,redactApplicationResult(app,credential,result));
}
export function redactApplicationResult(app:AppDefinition,credential:string,result:unknown){
 const parts=[credential];
 if(app.credential_fields){try{const parsed=JSON.parse(credential);for(const field of app.credential_fields)if(typeof parsed[field.name]==='string')parts.push(parsed[field.name]);}catch{/* Invalid credential is handled before dispatch. */}}
 let text=JSON.stringify(result);for(const part of parts.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.replaceAll(JSON.stringify(part).slice(1,-1),'[REDACTED]').replaceAll(encodeURIComponent(part),'[REDACTED]');return JSON.parse(text);
}
export type PermissionCheck={operation:string;state:'verified'|'denied'|'unknown';basis:'scope'|'read_probe'|'object_metadata'|'not_tested'};
export class ApplicationVerificationError extends Error {
 constructor(readonly code:string,readonly verification:Record<string,unknown>){super(code);}
}
export function selectedOAuthScopes(app:AppDefinition,config:Record<string,unknown>){
 const names=Object.keys(applicationOperations(app,config));
 // Existing adapters keep their declared grant; granular adapters derive only selected scopes.
 return [...new Set([...(app.oauth?.scopes??[]),...names.flatMap(name=>app.operations[name]?.scopes??[])])];
}
export function applicationOAuth(app:AppDefinition,config:Record<string,any>){
 if(!app.oauth)return undefined;
 if(app.id!=='salesforce')return app.oauth;
 const origin=salesforceOrigin.parse(config.instance_url);
 return {...app.oauth,authorize:origin+'/services/oauth2/authorize',token:origin+'/services/oauth2/token',issuer:origin};
}
export async function verifyApplication(app:AppDefinition,config:Record<string,any>,credential:string,oauthScopes?:string){
 const result=await applicationRequest(app,credential,app.verify(config),{write:false});
 if(app.verificationActive&&!app.verificationActive(result))throw new ToolAuthenticationError();
 const identity=app.identity?.(result);
 const rawScopes=app.grantedScopes?.(result)??(oauthScopes===undefined?undefined:oauthScopes.split(' '));
 const scope=rawScopes?.filter(s=>typeof s==='string'&&s.length<200&&!s.includes(credential)&&/^[\w.:/-]+$/.test(s)).slice(0,100);
 const allowed=Object.keys(applicationOperations(app,config));const checks:PermissionCheck[]=[];
 const probes=new Map<string,any>();
 for(const name of allowed){
  const op=app.operations[name]!;let state:PermissionCheck['state']='unknown',basis:PermissionCheck['basis']='not_tested';
  if(scope&&op.scopes?.length){state=op.scopes.every(required=>scope.includes(required)||(required.endsWith(':read')&&scope.includes(required+'-write')))?'verified':'denied';basis='scope';}
  const probe=app.permissionProbe?.(name,config);
  if(state!=='denied'&&probe){
   if(probe.method!=='GET')throw new Error('unsafe_permission_probe');
   const key=JSON.stringify(probe);
   try{if(!probes.has(key))probes.set(key,await applicationRequest(app,credential,probe,{write:false}));state=app.permissionResult?(app.permissionResult(name,probes.get(key))?'verified':'denied'):'verified';basis=app.permissionResult?'object_metadata':'read_probe';}
   catch(e){if(e instanceof AppRequestError&&e.status===403){state='denied';basis='read_probe';}else throw e;}
  }
  checks.push({operation:name,state,basis});
 }
 const verification={operations:['authenticated_verification_endpoint'],allowed_operations:allowed,permission_checks:checks,permission_coverage:checks.every(c=>c.state==='verified')?'complete':'partial',...(scope?{scope,scope_source:'provider'}:{scope_source:'unknown'}),...(typeof identity==='string'&&identity.length>0&&identity.length<200&&!/[\x00-\x1f]/.test(identity)&&!identity.includes(credential)?{account:identity}: {})};
 if(checks.some(c=>c.state==='denied'))throw new ApplicationVerificationError('app_permission_denied',verification);
 return verification;
}
export const applicationConnections:ConnectionAdapter[]=applications.map(app=>({kind:'tool',provider:app.id,config:applicationConfig(app),capabilities:['credential_registration','approval',...(app.oauth?['oauth']:[])],
 validate:(config,credential)=>verifyApplication(app,config,credential)
}));
export function applicationCatalog(){return applications.map(app=>({id:app.id,name:app.name,category:app.category,evidence:{implemented:true,contract_tests:true,live_account:['exa','tavily','deepl'].includes(app.id),source:['hubspot','salesforce','attio'].includes(app.id)?'testing/evidence/2026-11-18-crm-authorization.md':larkApplications.includes(app)?'testing/evidence/2026-11-18-mcp-lark-responses.md':researchDevelopmentApps.includes(app)?'testing/evidence/2026-11-18-catalog-openai.md':'testing/evidence/2026-11-16-applications.md'},credential_url:app.credential_url,oauth:!!app.oauth,credential_fields:app.credential_fields,verification_may_charge:['exa','brave-search'].includes(app.id),operations:Object.entries(app.operations).map(([name,op])=>({name,description:op.description,write:op.write,input_schema:op.input_schema,required_scopes:op.scopes??[]}))}));}
