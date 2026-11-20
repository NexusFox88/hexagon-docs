import { credentialListenerId } from '../../modules/access/ingress-health.js';
import Fastify from 'fastify';
import { lookup } from 'node:dns';
import { request as upstreamRequest, Agent, ProxyAgent, type Dispatcher } from 'undici';
import ipaddr from 'ipaddr.js';
import { ConnectionAccess } from '../../modules/access/access.js';
import { permits } from '../../modules/access/policy.js';
import { ExecutionError } from '../../modules/execution/runs.js';

/** Dedicated data-plane listener: no management routes, no traffic dumps, no retries. */
export function createAccessServer(access:ConnectionAccess, transport?:Dispatcher, observed?:(entry:{grant_id?:string;method:string;status:number})=>Promise<void>) {
  const app=Fastify({logger:false,bodyLimit:8*1024*1024});
  const proxyUrl=process.env.HEXAGON_ACCESS_EGRESS_PROXY_URL;
  const trustedHosts=(process.env.HEXAGON_ACCESS_EGRESS_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(proxyUrl&&(!trustedHosts.length||trustedHosts.some(h=>!/^[a-z0-9.-]+$/.test(h)||h.includes('..'))))throw new Error('credential_egress_proxy_requires_exact_hosts');
  const proxyDispatcher=()=>{try{if(!['http:','https:'].includes(new URL(proxyUrl!).protocol))throw new Error();return new ProxyAgent(proxyUrl!);}catch{throw new Error('credential_egress_proxy_invalid');}};
  const dispatcher=transport??(proxyUrl?proxyDispatcher():new Agent({connect:{lookup:((hostname:string,options:any,callback:any)=>{
    lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
      if(error)return callback(error);
      if(!addresses.length || addresses.some(a=>!ipaddr.isValid(a.address)||ipaddr.process(a.address).range()!=='unicast'))return callback(new Error('upstream_address_denied'));
      if(options.all)callback(null,addresses);else callback(null,addresses[0]!.address,addresses[0]!.family);
    });
  }) as any}}));
  if(observed)app.addHook('onResponse',async(req,reply)=>{await observed({grant_id:(req.params as {id?:string})?.id,method:req.method,status:reply.statusCode});});
  app.addHook('onClose',async()=>dispatcher.close());
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
  app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ExecutionError?error.status:502).send({error:{code:error instanceof ExecutionError?error.code:'access_request_failed'}}));
  app.get('/health/live',async()=>({state:'ready',instance:credentialListenerId}));
  app.all('/access/:id/*',async(req,reply)=>{
    const {id}=req.params as {id:string};
    const authorization=req.headers.authorization;
    const token=authorization?.startsWith('Bearer ')?authorization.slice(7):req.headers['x-api-key'];
    if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token))throw new ExecutionError('access_denied',403);
    const granted=await access.authorize(id,token);
    const raw=req.raw.url!.slice(`/access/${id}`.length);
    if(!permits(granted.policy,req.method,raw))throw new ExecutionError('access_policy_denied',403);
    const base=new URL(granted.policy.endpoint);
    if(proxyUrl&&!trustedHosts.includes(base.hostname.toLowerCase()))throw new ExecutionError('credential_egress_host_denied',403);
    // The binding owns the upstream. Never use client Host, absolute URLs or redirects.
    const prefix=base.pathname.replace(/\/+$/,'');
    const suffix=granted.kind==='model'&&prefix.endsWith('/v1')?raw.replace(/^\/v1(?=\/)/,''):raw;
    const target=base.origin+prefix+suffix;
    const headers:Record<string,string>={};
    for(const name of ['content-type','accept','anthropic-version','anthropic-beta'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name] as string;
    const auth=granted.policy.authentication;
    headers[auth.type==='bearer'?'authorization':auth.name.toLowerCase()]=auth.type==='bearer'?`Bearer ${granted.credential}`:granted.credential;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),180000);
    reply.raw.once('close',()=>{clearTimeout(timer);controller.abort();});
    let responseReceived=false;
    try {
      const upstream=await upstreamRequest(target,{dispatcher,method:req.method as any,headers,body:['GET','HEAD'].includes(req.method)?undefined:req.body as Buffer,signal:controller.signal,headersTimeout:60000,bodyTimeout:60000});
      responseReceived=true;
      await access.recordModelOutcome(granted,upstream.statusCode);
      if(upstream.statusCode>=300 && upstream.statusCode<400){upstream.body.destroy();throw new ExecutionError('upstream_redirect_denied',502);}
      reply.code(upstream.statusCode).header('cache-control','no-store').header('x-content-type-options','nosniff');
      for(const name of ['content-type','content-encoding','content-language','retry-after'])if(typeof upstream.headers[name]==='string')reply.header(name,upstream.headers[name]);
      return reply.send(upstream.body);
    } catch(error){clearTimeout(timer);if(!responseReceived)await access.recordModelOutcome(granted,null);throw error;}
  });
  return app;
}
