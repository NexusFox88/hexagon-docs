import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** Opt-in development ingress. The caller supplies only the credential listener. */
export async function openCloudflareCredentialTunnel(localOrigin:string) {
  const local=new URL(localOrigin);
  if(local.protocol!=='http:'||!['127.0.0.1','localhost'].includes(local.hostname)||local.pathname!=='/'||local.username||local.password||local.search||local.hash)throw new Error('credential_tunnel_requires_loopback_listener');
  const deadline=Date.now()+60000;
  try{return await connect(localOrigin,process.env,deadline);}catch(error){
    const proxy=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.HTTP_PROXY??process.env.http_proxy??process.env.ALL_PROXY;
    if(!proxy||process.env.HEXAGON_TUNNEL_PROXY_FALLBACK==='disabled'||(error as Error).message!=='credential_tunnel_creation_transport_failed')throw error;
    const direct={...process.env};for(const key of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'])delete direct[key];
    return connect(localOrigin,direct,deadline);
  }
}
async function connect(localOrigin:string,env:NodeJS.ProcessEnv,deadline:number){
  const child=spawn(process.env.CLOUDFLARED_BINARY??'cloudflared',
    ['tunnel','--no-autoupdate','--url',localOrigin],{env,stdio:['ignore','ignore','pipe']});
  let tail='',origin='',exited=false;
  child.stderr.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-8192);origin ||= tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0]??'';});
  const exit=new Promise<void>(resolve=>{child.on('error',()=>{exited=true;resolve();});child.on('exit',()=>{exited=true;resolve();});});
  const close=async()=>{if(!exited){child.kill('SIGTERM');const timer=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},5000);try{await exit;}finally{clearTimeout(timer);}}};
  try {
    while(Date.now()<deadline&&!exited){
      if(origin){try{const response=await fetch(`${origin}/health/live`,{signal:AbortSignal.timeout(3000)});if(response.ok&&(await response.json()).state==='ready')return {origin,close};}catch{}}
      await delay(500);
    }
    throw new Error(!origin&&/(?:EOF|connection reset|proxyconnect)/i.test(tail)?'credential_tunnel_creation_transport_failed':'credential_proxy_tunnel_unavailable');
  }catch(error){await close();throw error;}
}
