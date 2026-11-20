import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {Agent,ProxyAgent,fetch as secureFetch} from 'undici';
import {lookup} from 'node:dns';
import ipaddr from 'ipaddr.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Ajv} from 'ajv';
import {endpointInput} from '../../modules/access/policy.js';
import type {ConnectionAdapter} from '../../modules/connections/connections.js';
import {ToolAuthenticationError} from '../tools/http-json.js';
import {AppRequestError} from '../apps/registry.js';
const ajv=new Ajv({strict:false,addUsedSchema:false,validateFormats:false});
const schema=z.record(z.unknown()).refine(s=>{try{return s.type==='object'&&!s.$async&&!!ajv.compile(s);}catch{return false;}},'mcp_schema_unsupported');
export const mcpTool=z.object({name:z.string().min(1).max(128),description:z.string().max(8192).default(''),input_schema:schema,approval:z.boolean().default(true)}).strict();
export const remoteMcpConfig=z.object({endpoint:endpointInput,transport:z.enum(['streamable-http','sse']).default('streamable-http'),authentication:z.enum(['none','bearer','header']).default('bearer'),header_name:z.string().regex(/^[A-Za-z0-9-]+$/).refine(s=>!['host','cookie','connection','content-length','transfer-encoding','proxy-authorization'].includes(s.toLowerCase())).default('x-api-key'),tools:z.record(z.string().regex(/^mcp_[a-f0-9]{24}$/),mcpTool).default({})}).strict();
export type RemoteMcpConfig=z.infer<typeof remoteMcpConfig>;
export const toolKey=(name:string)=>'mcp_'+createHash('sha256').update(name).digest('hex').slice(0,24);
const canonical=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function sameTool(a:z.infer<typeof mcpTool>,b:z.infer<typeof mcpTool>){return a.name===b.name&&a.description===b.description&&canonical(a.input_schema)===canonical(b.input_schema);}
export function validMcpArguments(schema:Record<string,unknown>,args:Record<string,unknown>){return ajv.compile(schema)(args);}
export function mcpOperations(config:Record<string,unknown>){const c=remoteMcpConfig.parse(config);return Object.fromEntries(Object.entries(c.tools).map(([key,t])=>[key,{description:t.description||t.name,input_schema:t.input_schema,approval:t.approval,method:'POST' as const,path:t.name,replay:'never' as const}]));}
/** Resolve at socket creation, rejecting private/mixed DNS answers; credentials are origin-bound. */
export function publicDispatcher(){return new Agent({connect:{lookup:((host:string,options:any,done:any)=>lookup(host,{all:true,verbatim:true},(error,addresses)=>{if(error)return done(error);if(!addresses.length||addresses.some(a=>!ipaddr.isValid(a.address)||ipaddr.process(a.address).range()!=='unicast'))return done(new Error('mcp_private_address_denied'));if(options.all)done(null,addresses);else done(null,addresses[0]!.address,addresses[0]!.family);})) as any}});}
/** Operators may delegate DNS enforcement to their explicitly trusted outbound proxy.
 * Same exact-host allowlist as credential egress; never derived from tool input. */
export function mcpDispatcher(endpoint:string){
 const proxy=process.env.HEXAGON_ACCESS_EGRESS_PROXY_URL;
 if(!proxy)return publicDispatcher();
 const hosts=(process.env.HEXAGON_ACCESS_EGRESS_HOSTS??'').split(',').map(h=>h.trim().toLowerCase());
 if(!hosts.includes(new URL(endpoint).hostname.toLowerCase()))return publicDispatcher();
 if(!['http:','https:'].includes(new URL(proxy).protocol))throw new Error('credential_egress_proxy_invalid');
 return new ProxyAgent(proxy);
}
export async function withMcp<T>(config:RemoteMcpConfig,credential:string,fn:(client:Client)=>Promise<T>,testFetch?:typeof fetch):Promise<T>{
 const origin=new URL(config.endpoint).origin,dispatcher=testFetch?undefined:mcpDispatcher(config.endpoint),deadline=AbortSignal.timeout(45000);
 const transportFetch:typeof fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(url.origin!==origin||url.username||url.password||url.protocol!=='https:')throw new Error('mcp_origin_denied');
  if(/[\r\n\0]/.test(credential))throw new ToolAuthenticationError();const headers=new Headers(init.headers);headers.delete('authorization');headers.delete('cookie');
  if(config.authentication!=='none')headers.set(config.authentication==='bearer'?'authorization':config.header_name,config.authentication==='bearer'?`Bearer ${credential}`:credential);
  const response=await (testFetch??secureFetch as unknown as typeof fetch)(url,{...init,headers,redirect:'error',signal:init.signal?AbortSignal.any([deadline,init.signal]):deadline,...(dispatcher?{dispatcher}:{})} as RequestInit);
  if(response.status===401||response.status===403){await response.body?.cancel();throw new ToolAuthenticationError();}
  if(!response.body)return response;
  let bytes=0;const bounded=response.body.pipeThrough(new TransformStream({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>2*1024*1024)throw new Error('mcp_response_too_large');controller.enqueue(chunk);}}));
  return new Response(bounded,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 const client=new Client({name:'hexagon',version:'1.0.0'},{capabilities:{}}),transport=config.transport==='sse'?new SSEClientTransport(new URL(config.endpoint),{fetch:transportFetch,requestInit:{redirect:'error'}}):new StreamableHTTPClientTransport(new URL(config.endpoint),{fetch:transportFetch,requestInit:{redirect:'error'},reconnectionOptions:{maxRetries:0,maxReconnectionDelay:0,initialReconnectionDelay:0,reconnectionDelayGrowFactor:1}});
 try{await client.connect(transport,{timeout:30000});return await fn(client);}finally{if(transport instanceof StreamableHTTPClientTransport&&transport.sessionId)await transport.terminateSession().catch(()=>{});await client.close().catch(()=>{});await dispatcher?.destroy();}
}
export async function listMcpTools(client:Client){
 const tools:Record<string,z.infer<typeof mcpTool>>={};const cursors=new Set<string>();let cursor:string|undefined;
 for(let page=0;page<20;page++){
  const result=await client.listTools(cursor?{cursor}:undefined,{timeout:15000});
  for(const t of result.tools){const key=toolKey(t.name);if(tools[key]||Object.keys(tools).length>=100)throw new Error('mcp_tool_limit_or_duplicate');tools[key]=mcpTool.parse({name:t.name,description:t.description??'',input_schema:t.inputSchema,approval:true});}
  cursor=result.nextCursor;if(!cursor)return tools;if(cursors.has(cursor))throw new Error('mcp_cursor_cycle');cursors.add(cursor);
 }throw new Error('mcp_tool_limit');
}
export async function discoverMcp(config:Record<string,unknown>,credential:string){const tools=await withMcp(remoteMcpConfig.parse(config),credential,listMcpTools);if(credential&&JSON.stringify(tools).includes(credential))throw new Error('mcp_unsafe_metadata');return tools;}
export const remoteMcpConnection:ConnectionAdapter={kind:'tool',provider:'mcp-remote',config:remoteMcpConfig,capabilities:['credential_registration','approval','tool_discovery'],async validate(config,credential){
 const c=remoteMcpConfig.parse(config),current=await discoverMcp(c,credential);if(!Object.keys(c.tools).length)throw new Error('mcp_discovery_required');for(const [k,t]of Object.entries(c.tools))if(!current[k]||!sameTool(t,current[k]!))throw new Error('mcp_schema_changed');return {operations:['mcp_initialize','mcp_tools_list'],scope:Object.values(c.tools).map(t=>t.name)};
}};
export async function executeMcp(config:Record<string,unknown>,credential:string,operation:string,args:Record<string,unknown>,testFetch?:typeof fetch){
 const c=remoteMcpConfig.parse(config),tool=c.tools[operation];if(!tool)throw new AppRequestError('tool_operation_unavailable',400);
 for(let attempt=0;attempt<2;attempt++){
 let dispatched=false;
 try{return await withMcp(c,credential,async client=>{
  const current=await listMcpTools(client);
  if(!current[operation]||!sameTool(tool,current[operation]!))throw new AppRequestError('mcp_schema_changed',409);
  // Once tools/call begins, a transport failure has an unknown remote outcome.
  dispatched=true;
  const value=await client.callTool({name:tool.name,arguments:args},undefined,{timeout:30000});
  let text=JSON.stringify(value);if(credential)text=text.replaceAll(JSON.stringify(credential).slice(1,-1),'[REDACTED]');return JSON.parse(text);
 },testFetch);}catch(error){
  if(dispatched||error instanceof ToolAuthenticationError||error instanceof AppRequestError)throw error;
  // Reconnect once only before tools/call. Never replay an operation whose
  // response may have been lost, including tools advertised as read-only.
  if(attempt===0){await new Promise(resolve=>setTimeout(resolve,250));continue;}
  throw new AppRequestError('mcp_connection_failed',502);
 }
 }
 throw new AppRequestError('mcp_connection_failed',502);
}
