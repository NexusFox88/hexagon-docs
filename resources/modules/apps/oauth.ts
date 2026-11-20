import {randomUUID,createHash} from 'node:crypto';
import * as oauth from 'oauth4webapi';
import {z} from 'zod';
import type pg from 'pg';
import {SecretStore} from '../credentials/secret-store.js';
import {transaction} from '../storage/database.js';
import {ExecutionError} from '../execution/runs.js';
import {application,verifyApplication,applicationOAuth,selectedOAuthScopes} from '../../integrations/apps/registry.js';
import {ToolAuthenticationError} from '../../integrations/tools/http-json.js';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const setupInput=z.object({client_id:z.string().min(1).max(2000),client_secret:z.string().min(1).max(32768),redirect_uri:z.string().url().refine(v=>{const u=new URL(v);return u.pathname==='/oauth/callback'&&!u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)));})}).strict();
export class ApplicationOAuth {
 constructor(private pool:pg.Pool,private secrets:SecretStore){}
 async configure(tenant:string,provider:string,input:unknown){
  if(!application(provider)?.oauth)throw new ExecutionError('app_oauth_unsupported',400);
  const parsed=setupInput.parse(input);
  await transaction(this.pool,async db=>{const secret=await this.secrets.save(tenant,`oauth-client:${provider}`,parsed.client_secret,db);await db.query('INSERT INTO application_oauth_clients(tenant_id,provider,client_id,secret_id,redirect_uri) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,provider) DO UPDATE SET client_id=$3,secret_id=$4,redirect_uri=$5,updated_at=now()',[tenant,provider,parsed.client_id,secret,parsed.redirect_uri]);});
  return {configured:true,provider,client_id:parsed.client_id,redirect_uri:parsed.redirect_uri};
 }
 async configurations(tenant:string){return (await this.pool.query('SELECT provider,client_id,redirect_uri,updated_at FROM application_oauth_clients WHERE tenant_id=$1',[tenant])).rows;}
 async start(tenant:string,connectionId:string){return transaction(this.pool,async db=>{
  const c=(await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,connectionId])).rows[0];
  if(!c||c.kind!=='tool')throw new ExecutionError('connection_not_found',404);
  const app=application(c.provider);const provider=app&&applicationOAuth(app,c.config);if(!provider)throw new ExecutionError('app_oauth_unsupported',400);
  const client=(await db.query('SELECT * FROM application_oauth_clients WHERE tenant_id=$1 AND provider=$2',[tenant,c.provider])).rows[0];if(!client)throw new ExecutionError('app_oauth_setup_required',409);
  const id=randomUUID(),state=oauth.generateRandomState(),verifier=oauth.generateRandomCodeVerifier();
  const secret=await this.secrets.save(tenant,`oauth-flow:${id}`,verifier,db);
  await db.query("UPDATE application_oauth_flows SET status='cancelled' WHERE tenant_id=$1 AND connection_id=$2 AND status='pending'",[tenant,connectionId]);
  await db.query("INSERT INTO application_oauth_flows(id,tenant_id,connection_id,provider,connection_version,state_hash,verifier_secret_id,client_updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')",[id,tenant,connectionId,c.provider,c.version,digest(state),secret,client.updated_at]);
  const url=new URL(provider.authorize);for(const [k,v]of Object.entries({...provider.params,client_id:client.client_id,redirect_uri:client.redirect_uri,response_type:'code',state,scope:selectedOAuthScopes(app!,c.config).join(provider.scope_separator??' ')}))if(v)url.searchParams.set(k,v as string);
  if(provider.pkce){url.searchParams.set('code_challenge',await oauth.calculatePKCECodeChallenge(verifier));url.searchParams.set('code_challenge_method','S256');}
  return {id,authorization_url:url.toString(),expires_in:600};
 });}
 async flow(tenant:string,id:string){const r=(await this.pool.query('SELECT id,connection_id,status,error_code,expires_at FROM application_oauth_flows WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(!r)throw new ExecutionError('app_oauth_flow_not_found',404);if(r.status==='pending'&&new Date(r.expires_at).getTime()<Date.now())r.status='expired';return r;}
 async cancel(tenant:string,id:string){await this.pool.query("UPDATE application_oauth_flows SET status='cancelled' WHERE tenant_id=$1 AND id=$2 AND status='pending'",[tenant,id]);return this.flow(tenant,id);}
 private async tokens(providerId:string,client:any,secret:string,params:URLSearchParams,verifier:string,refresh?:string,config:Record<string,any>={}){
  const provider=applicationOAuth(application(providerId)!,config)!;
  if(provider.json){
   const response=await fetch(provider.token,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Basic ${Buffer.from(`${client.client_id}:${secret}`).toString('base64')}`},body:JSON.stringify(refresh?{grant_type:'refresh_token',refresh_token:refresh}:{grant_type:'authorization_code',code:params.get('code'),redirect_uri:client.redirect_uri})});
   if(!response.ok){await response.body?.cancel();throw new ToolAuthenticationError();}
   const result=await response.json() as any;return z.object({access_token:z.string().min(1).max(32768),refresh_token:z.string().min(1).max(32768).optional(),expires_in:z.number().finite().positive().optional(),scope:z.string().optional()}).passthrough().parse(result);
  }
  const as={issuer:provider.issuer,token_endpoint:provider.token},registration={client_id:client.client_id};
  const authentication=provider.client_auth==='basic'?oauth.ClientSecretBasic(secret):oauth.ClientSecretPost(secret);
  const options={signal:AbortSignal.timeout(15000)};
  if(refresh)return oauth.processRefreshTokenResponse(as,registration,await oauth.refreshTokenGrantRequest(as,registration,authentication,refresh,options));
  const validated=oauth.validateAuthResponse(as,registration,params,params.get('state')!);
  const response=await oauth.authorizationCodeGrantRequest(as,registration,authentication,validated,client.redirect_uri,provider.pkce?verifier:oauth.nopkce,options);
  return oauth.processAuthorizationCodeResponse(as,registration,response);
 }
 async callback(params:URLSearchParams){
  const state=params.get('state');if(!state||state.length>1024)throw new ExecutionError('app_oauth_state_invalid',400);
  return transaction(this.pool,async db=>{
   const f=(await db.query('SELECT * FROM application_oauth_flows WHERE state_hash=$1',[digest(state)])).rows[0];
   if(!f||f.status!=='pending'||new Date(f.expires_at).getTime()<Date.now())throw new ExecutionError('app_oauth_state_invalid',400);
   const c=(await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[f.tenant_id,f.connection_id])).rows[0];
   // Match start(): lock the connection before its flow, avoiding opposite-order deadlocks.
   const locked=(await db.query('SELECT status,expires_at FROM application_oauth_flows WHERE id=$1 FOR UPDATE',[f.id])).rows[0];
   if(!locked || locked.status!=='pending' || new Date(locked.expires_at).getTime()<Date.now())throw new ExecutionError('app_oauth_state_invalid',400);
   const client=(await db.query('SELECT * FROM application_oauth_clients WHERE tenant_id=$1 AND provider=$2',[f.tenant_id,f.provider])).rows[0];
   const redirect=client?new URL(`/console/#tools`,client.redirect_uri).toString():'/console/#tools';
   try{
    if(!c||c.deleted_at||c.version!==f.connection_version||!client||new Date(client.updated_at).getTime()!==new Date(f.client_updated_at).getTime())throw new Error('connection_changed');
    if(params.has('error'))throw new Error('consent_denied');
    const verifier=await this.secrets.read(f.tenant_id,f.verifier_secret_id,`oauth-flow:${f.id}`,db),clientSecret=await this.secrets.read(f.tenant_id,client.secret_id,`oauth-client:${f.provider}`,db);
    const token=await this.tokens(f.provider,client,clientSecret,params,verifier,undefined,c.config);
    const app=application(f.provider)!;const verification=await verifyApplication(app,c.config,token.access_token,token.scope);
    if(app.id==='salesforce'&&token.instance_url&&new URL(String(token.instance_url)).origin!==new URL(c.config.instance_url).origin)throw new Error('oauth_instance_changed');
    const envelope={type:'oauth_v1',client_id:client.client_id,access_token:token.access_token,refresh_token:token.refresh_token,expires_at:token.expires_in?Date.now()+Number(token.expires_in)*1000:undefined,scope:token.scope};
    const secret=await this.secrets.save(f.tenant_id,`connection:${c.id}`,JSON.stringify(envelope),db);
    
    await db.query("UPDATE connections SET secret_id=$3,managed_secret_id=NULL,config=jsonb_set(config,'{authentication}','\"oauth\"'),version=version+1,status='ready',enabled=true,validation=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2",[f.tenant_id,c.id,secret,{...verification,credential_lifecycle:{mode:'oauth',expires_at:envelope.expires_at?new Date(envelope.expires_at).toISOString():null,refresh_available:!!envelope.refresh_token},checked_at:new Date().toISOString()}]);
    await db.query("UPDATE application_oauth_flows SET status='completed' WHERE id=$1",[f.id]);
   }catch(error){await db.query("UPDATE application_oauth_flows SET status='failed',error_code=$2 WHERE id=$1",[f.id,error instanceof Error&&error.message==='consent_denied'?'app_oauth_denied':'app_oauth_failed']);}
   return redirect;
  });
 }
 async status(tenant:string,id:string){
  const c=(await this.pool.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[tenant,id])).rows[0];
  if(!c)throw new ExecutionError('connection_not_found',404);
  if(c.kind!=='tool')throw new ExecutionError('connection_kind_mismatch',400);
  const base={connection_id:id,authentication:c.config.authentication??'api_key',provider_revoked:false};
  if(!c.secret_id)return {...base,state:'disconnected',refresh_available:false,expires_at:null};
  if(c.config.authentication!=='oauth')return {...base,state:c.status==='invalid'?'reauthorization_required':'manual',refresh_available:false,expires_at:null};
  let token:any;try{token=JSON.parse(await this.secrets.read(tenant,c.secret_id,`connection:${id}`));}catch{return {...base,state:'reauthorization_required',refresh_available:false,expires_at:null};}
  const client=(await this.pool.query('SELECT client_id FROM application_oauth_clients WHERE tenant_id=$1 AND provider=$2',[tenant,c.provider])).rows[0];
  const attempt=(await this.pool.query('SELECT state,created_at FROM application_oauth_refresh_attempts WHERE tenant_id=$1 AND connection_id=$2 AND secret_id=$3',[tenant,id,c.secret_id])).rows[0];
  const expired=typeof token.expires_at==='number'&&token.expires_at<=Date.now();
  const state=client?.client_id!==token.client_id?'reauthorization_required':attempt?(attempt.state==='started'&&Date.now()-new Date(attempt.created_at).getTime()<40000?'refreshing':'refresh_unknown'):c.status==='invalid'||(expired&&!token.refresh_token)?'reauthorization_required':'oauth';
  return {...base,state,refresh_available:!!token.refresh_token,expires_at:typeof token.expires_at==='number'?new Date(token.expires_at).toISOString():null};
 }
 async credential(tenant:string,id:string,expectedVersion?:number):Promise<string>{
  // Never hold a database transaction across a token refresh. The durable attempt
  // fences rotating tokens even when the process dies after remote acceptance.
  for(let wait=0;wait<160;wait++){
   const prepared=await transaction(this.pool,async db=>{
    const c=(await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,id])).rows[0];
    if(!c||(expectedVersion!==undefined&&(c.version!==expectedVersion||!c.enabled||c.status!=='ready')))throw new ToolAuthenticationError();
    if(c.provider==='mcp-remote'&&c.config.authentication==='none')return {value:''};
    if(!c.secret_id)throw new ToolAuthenticationError();
    const raw=await this.secrets.read(tenant,c.secret_id,`connection:${id}`,db);
    if(c.config.authentication!=='oauth')return {value:raw};
    let token:any;try{token=JSON.parse(raw);}catch{throw new ToolAuthenticationError();}
    if(token.type!=='oauth_v1'||typeof token.access_token!=='string')throw new ToolAuthenticationError();
    const client=(await db.query('SELECT * FROM application_oauth_clients WHERE tenant_id=$1 AND provider=$2',[tenant,c.provider])).rows[0];
    if(!client||token.client_id!==client.client_id)throw new ToolAuthenticationError();
    if(c.status!=='invalid'&&(!token.expires_at||token.expires_at>Date.now()+60000))return {value:token.access_token as string};
    if(!token.refresh_token)throw new ToolAuthenticationError();
    const prior=(await db.query('SELECT state,created_at FROM application_oauth_refresh_attempts WHERE tenant_id=$1 AND connection_id=$2 AND secret_id=$3',[tenant,id,c.secret_id])).rows[0];
    if(prior){if(prior.state==='started'&&Date.now()-new Date(prior.created_at).getTime()<40000)return {pending:true};throw new ToolAuthenticationError();}
    const clientSecret=await this.secrets.read(tenant,client.secret_id,`oauth-client:${c.provider}`,db);
    await db.query("INSERT INTO application_oauth_refresh_attempts(tenant_id,connection_id,secret_id,state) VALUES($1,$2,$3,'started')",[tenant,id,c.secret_id]);
    return {refresh:{c,token,client,clientSecret}};
   });
   if(prepared.value!==undefined)return prepared.value;
   if(prepared.pending){await new Promise(resolve=>setTimeout(resolve,250));continue;}
   const {c,token,client,clientSecret}=prepared.refresh!;
   try{
    const next=await this.tokens(c.provider,client,clientSecret,new URLSearchParams(),'',token.refresh_token,c.config);
    if(c.provider==='salesforce'&&next.instance_url&&new URL(String(next.instance_url)).origin!==new URL(c.config.instance_url).origin)throw new ToolAuthenticationError();
    return await transaction(this.pool,async db=>{
     const current=(await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
     const registration=(await db.query('SELECT client_id FROM application_oauth_clients WHERE tenant_id=$1 AND provider=$2',[tenant,c.provider])).rows[0];
     if(!current||current.deleted_at||current.secret_id!==c.secret_id||current.version!==c.version||registration?.client_id!==client.client_id)throw new ToolAuthenticationError();
     const updated={...token,access_token:next.access_token,refresh_token:next.refresh_token??token.refresh_token,expires_at:next.expires_in?Date.now()+Number(next.expires_in)*1000:undefined,scope:next.scope??token.scope};
     const secret=await this.secrets.save(tenant,`connection:${id}`,JSON.stringify(updated),db);
     await db.query('UPDATE connections SET secret_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,id,secret]);
     await db.query("UPDATE application_oauth_refresh_attempts SET state='completed',updated_at=now() WHERE tenant_id=$1 AND connection_id=$2 AND secret_id=$3",[tenant,id,c.secret_id]);
     return next.access_token as string;
    });
   }catch{
    await this.pool.query("UPDATE application_oauth_refresh_attempts SET state='unknown',updated_at=now() WHERE tenant_id=$1 AND connection_id=$2 AND secret_id=$3 AND state='started'",[tenant,id,c.secret_id]);
    throw new ToolAuthenticationError();
   }
  }
  throw new ToolAuthenticationError();
 }
}
