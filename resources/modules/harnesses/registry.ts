import {createHash} from 'node:crypto';
import {ExecutionError} from '../execution/runs.js';
export type RegistryCredential={username:string;password:string};
export type ResolvedImage={reference:string;digest:string;platform:'linux/amd64';user:string;command:string[];labels:Record<string,string>};
const accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
/** Deliberately explicit public registry origins; arbitrary URLs must not become SSRF. */
export function imageReference(input:string){
 const match=/^(?:(docker\.io|ghcr\.io)\/)?([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})|@(sha256:[a-f0-9]{64}))?$/.exec(input);
 if(!match||(!match[1]&&input.split('/')[0]?.includes('.')&&input.includes('/')))throw new ExecutionError('invalid_image_reference',400);
 const registry=match[1]??'docker.io',repository=registry==='docker.io'&&!match[2]!.includes('/')?`library/${match[2]}`:match[2]!;
 return {registry,repository,selector:match[4]??match[3]??'latest',canonical:`${registry}/${repository}`,origin:registry==='docker.io'?'https://registry-1.docker.io':'https://ghcr.io'};
}
async function bounded(response:Response,limit:number){
 const reader=response.body?.getReader();if(!reader)throw new ExecutionError('image_registry_invalid_response',502);const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new ExecutionError('image_manifest_too_large',400);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
const hash=(bytes:Uint8Array)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function resolveImage(input:string,credential?:RegistryCredential,request:typeof fetch=fetch):Promise<ResolvedImage>{
 const image=imageReference(input);let bearer:string|undefined;
 // Registry and token discovery use GET only. A lost read is safe to retry;
 // this does not retry image publication, resource creation or tool calls.
 async function readRegistry(url:string|URL,options:RequestInit){
  for(let attempt=0;attempt<2;attempt++)try{return await request(url,{...options,signal:AbortSignal.timeout(20000)});}catch(error){
   if(!(error instanceof TypeError)&&!(error instanceof DOMException&&['AbortError','TimeoutError'].includes(error.name)))throw error;
   if(attempt===1)throw new ExecutionError('image_registry_request_failed',502);
  }
  throw new ExecutionError('image_registry_request_failed',502);
 }
 async function get(path:string){
  const url=`${image.origin}/v2/${image.repository}/${path}`;
  const send=()=>readRegistry(url,{headers:{accept,...(bearer?{authorization:`Bearer ${bearer}`}:{})},redirect:'manual',signal:AbortSignal.timeout(20000)});
  let response=await send();
  if(response.status===401&&!bearer){
   const challenge=response.headers.get('www-authenticate')??'';await response.body?.cancel();
   const realm=/realm="([^"]+)"/.exec(challenge)?.[1],service=/service="([^"]+)"/.exec(challenge)?.[1];
   if(!/^Bearer /i.test(challenge)||!realm)throw new ExecutionError('image_registry_authentication_failed',401);
   const auth=new URL(realm),expected=image.registry==='docker.io'?'https://auth.docker.io/token':'https://ghcr.io/token';
   if(auth.origin+auth.pathname!==expected||auth.username||auth.password)throw new ExecutionError('image_registry_authentication_failed',401);
   auth.search='';if(service)auth.searchParams.set('service',service);auth.searchParams.set('scope',`repository:${image.repository}:pull`);
   const token=await readRegistry(auth,{headers:credential?{authorization:`Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`}:{},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!token.ok){await token.body?.cancel();throw new ExecutionError('image_registry_authentication_failed',401);}
   const data=JSON.parse((await bounded(token,65536)).toString());bearer=data.token??data.access_token;
   if(typeof bearer!=='string'||!bearer)throw new ExecutionError('image_registry_authentication_failed',401);
   response=await send();
  }
  for(let redirects=0;[301,302,303,307,308].includes(response.status)&&redirects<3;redirects++){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!path.startsWith('blobs/')||!location)throw new ExecutionError('image_registry_redirect_rejected',502);
   const target=new URL(location);const allowed=['production.cloudflare.docker.com','production.cloudfront.docker.com'].includes(target.hostname)||target.hostname.endsWith('.r2.cloudflarestorage.com')||target.hostname==='pkg-containers.githubusercontent.com';
   if(target.protocol!=='https:'||target.port||target.username||target.password||!allowed)throw new ExecutionError('image_registry_redirect_rejected',502);
   response=await readRegistry(target,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  }
  if(!response.ok){const status=response.status;await response.body?.cancel();throw new ExecutionError(status===404?'image_not_found':'image_registry_request_failed',status===404?404:502);}
  return bounded(response,4*1024*1024);
 }
 let bytes=await get(`manifests/${image.selector}`);if(image.selector.startsWith('sha256:')&&hash(bytes)!==image.selector)throw new ExecutionError('image_digest_mismatch',400);
 let manifest=JSON.parse(bytes.toString());
 if(Array.isArray(manifest.manifests)){
  const child=manifest.manifests.find((m:any)=>m.platform?.os==='linux'&&m.platform?.architecture==='amd64'&&!m.platform?.variant);
  if(!child||!/^sha256:[a-f0-9]{64}$/.test(child.digest))throw new ExecutionError('image_platform_unsupported',400);
  bytes=await get(`manifests/${child.digest}`);if(hash(bytes)!==child.digest)throw new ExecutionError('image_digest_mismatch',400);manifest=JSON.parse(bytes.toString());
 }
 if(!/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest??''))throw new ExecutionError('image_registry_invalid_response',502);
 const configBytes=await get(`blobs/${manifest.config.digest}`);if(hash(configBytes)!==manifest.config.digest)throw new ExecutionError('image_digest_mismatch',400);
 const config=JSON.parse(configBytes.toString());if(config.os!=='linux'||config.architecture!=='amd64')throw new ExecutionError('image_platform_unsupported',400);
 const user=config.config?.User??'root';if(user&&!/^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)?$/.test(user))throw new ExecutionError('image_user_unsupported',400);
 const entrypoint=config.config?.Entrypoint??[],args=config.config?.Cmd??[];
 if(!Array.isArray(entrypoint)||!Array.isArray(args))throw new ExecutionError('image_registry_invalid_response',502);
 const command=[...entrypoint,...args];
 if(command.length>32||!command.every((x:unknown)=>typeof x==='string'&&x.length>0&&x.length<=65536&&!x.includes('\0')))throw new ExecutionError('image_registry_invalid_response',502);
 const digest=hash(bytes);return {reference:`${image.canonical}@${digest}`,digest,platform:'linux/amd64',user:user||'root',command,labels:config.config?.Labels??{}};
}
