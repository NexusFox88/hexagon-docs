import { SandboxCreationRejected } from '../../modules/sandboxes/connector.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest, SandboxDeletion } from '../../modules/sandboxes/connector.js';
import { openInstaboxTunnel, checkInstaboxOpenSSH } from './instabox-transport.js';

export const instaboxConfig = z.object({ template: z.string().regex(/^[a-z0-9][a-z0-9.@_-]{0,127}$/).default('agent-browser') }).strict();
const segment = (id: string, prefix = 'm') => { if (!new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(id)) throw new Error('instabox_invalid_id'); return id; };
const path = (id: string) => `/machines/${segment(id)}`;
const filePath = (value: string) => { if (!value.startsWith('/') || value.includes('\0')) throw new Error('sandbox_file_path_must_be_absolute'); return value; };
class InstaboxError extends Error { constructor(readonly status:number) { super(`instabox_http_${status}`); } }
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
export class InstaboxConnector implements SandboxConnector {
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof instaboxConfig>;
  constructor(config:Record<string,unknown>, private credential:string) { this.config = instaboxConfig.parse(config); }
  private async response(route:string, method='GET', body?:BodyInit, headers:Record<string,string>={}, timeout=45000) {
    const result = await fetch(`https://api.instabox.sh/v1${route}`, { method, redirect:'error',
      headers:{'X-API-Key':this.credential,...headers}, body, signal:AbortSignal.timeout(timeout) });
    if (!result.ok) {
      // Only this structured, synchronous create refusal proves non-allocation.
      // Polling failures, generic 429s and errors naming an operation stay uncertain.
      if (route === '/machines' && method === 'POST' && result.status === 429) {
        const reader = result.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          if (reader) while (true) {
            const {done, value} = await reader.read(); if (done) break;
            size += value.length; if (size > 16384) break; chunks.push(value);
          }
          if (size <= 16384) {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (body?.error?.code === 'quota_exceeded' && !body.error.operationId && !body.operationId)
              throw new SandboxCreationRejected();
          }
        } catch (error) { if (error instanceof SandboxCreationRejected) throw error; }
        finally { await reader?.cancel().catch(() => {}); }
      } else await result.body?.cancel();
      throw new InstaboxError(result.status);
    }
    return result;
  }
  private async api(route:string, method='GET', body?:unknown, headers:Record<string,string>={}, timeout=45000):Promise<any> {
    const response = await this.response(route,method,body===undefined?undefined:JSON.stringify(body),{'Content-Type':'application/json',...headers},timeout);
    return response.status===204?null:response.json();
  }
  private resource(row:any) {
    if (!row || typeof row.state!=='string') throw new Error('instabox_invalid_machine');
    return {id:segment(row.id),state:row.state==='suspended'?'paused':row.state,...(Number.isInteger(row.spec?.memMiB)?{memory_mb:row.spec.memMiB as number}:{}),
      ...(row.deleteAt && Number.isFinite(Date.parse(row.deleteAt))?{expires_at:row.deleteAt as string}:{})};
  }
  private async list(operation?:string) {
    const rows:any[] = [], seen=new Set<string>(); let cursor='';
    do {
      const query=new URLSearchParams({limit:'100'});
      if(operation)query.set('metadata',`hexagon_operation:${operation}`);
      if(cursor)query.set('cursor',cursor);
      const result=await this.api(`/machines?${query}`);
      if(!Array.isArray(result.machines))throw new Error('instabox_invalid_list');
      rows.push(...result.machines);
      if(result.nextCursor===null || result.nextCursor===undefined || result.nextCursor==='')return rows;
      cursor=result.nextCursor;
      if(typeof cursor!=='string'||seen.has(cursor))throw new Error('instabox_invalid_pagination');
      seen.add(cursor);
    }while(true);
  }
  async preflight(){await checkInstaboxOpenSSH();}
  async validate(){await this.preflight();await this.list();return {operations:['list_machines'],expiry_enforcement:'control_plane',provider_ttl_requested:false,transport:'ssh_certificate'};}
  private async wait(operation:any, id:string, type:string) {
    const op=segment(operation?.id,'op'), deadline=Date.now()+180000;
    do {
      if(operation.machineId!==id||operation.type!==type)throw new Error('instabox_operation_target_mismatch');
      if(operation.state==='succeeded')return;
      if(operation.state==='failed')throw new Error('instabox_operation_failed');
      if(!['queued','running'].includes(operation.state))throw new Error('instabox_invalid_operation');
      operation=await this.api(`/operations/${op}?wait=25s`);await pause();
    }while(Date.now()<deadline);
    throw new Error('instabox_operation_unconfirmed');
  }
  async create(request:SandboxRequest) {
    if(request.network.mode!=='unrestricted')throw new Error('instabox_network_allowlist_unsupported');
    if(!Number.isInteger(request.timeout_seconds)||request.timeout_seconds<60||request.timeout_seconds>86400)throw new Error('invalid_sandbox_timeout');
    const op=await this.api('/machines','POST',{name:`hexagon-${request.operation_id}`,templateId:this.config.template,
      metadata:{hexagon_operation:request.operation_id,hexagon_session:request.session_id},vault:false,secrets:[],envSecrets:[],
      deleteAfterSeconds:0},{'Idempotency-Key':request.operation_id});
    const id=segment(op.machineId);await request.record?.(id,segment(op.id,'op'));await this.wait(op,id,'create');
    const machine=await this.inspect(id);if(!machine||machine.state!=='running')throw new Error('instabox_create_not_ready');return machine;
  }
  async findByOperation(operation:string){return (await this.list(operation)).filter(row=>row.name===`hexagon-${operation}`&&row.metadata?.hexagon_operation===operation).map(row=>this.resource(row));}
  async inspect(id:string){try{return this.resource(await this.api(path(id)));}catch(error){if(error instanceof InstaboxError&&error.status===404)return null;throw error;}}
  async pause(id:string){const op=await this.api(path(id)+'/suspend','POST',undefined,{'Idempotency-Key':crypto.randomUUID()});await this.wait(op,id,'suspend');}
  async resume(id:string){const op=await this.api(path(id)+'/resume','POST',undefined,{'Idempotency-Key':crypto.randomUUID()});await this.wait(op,id,'resume');}
  async reconcileDeletion(id:string,context:SandboxDeletion){
    segment(id);let op:any;
    if(context.provider_operation_id)op=await this.api(`/operations/${segment(context.provider_operation_id,'op')}`);
    else {
      try{op=await this.api(path(id),'DELETE',undefined,{'Idempotency-Key':`hexagon-delete-${id}`,'X-Confirm-Delete':id});}
      catch(error){if(error instanceof InstaboxError&&error.status===404)return;throw error;}
      if(op.machineId!==id||op.type!=='delete')throw new Error('instabox_operation_target_mismatch');
      await context.record(segment(op.id,'op'));
    }
    await this.wait(op,id,'delete');if(await this.inspect(id))throw new Error('instabox_deletion_unconfirmed');
  }
  async destroy(id:string){await this.reconcileDeletion(id,{record:async()=>{}});}
  async execute(id:string,command:string,options:{timeout_seconds?:number;background?:boolean}={}){
    const seconds=options.timeout_seconds??60;
    if(!Number.isInteger(seconds)||seconds<1||seconds>(options.background?3600:600))throw new Error('invalid_command_timeout');
    const bounded=['timeout','--kill-after=5s',`${seconds}s`,'bash','-lc',command];
    const argv=options.background?['python3','-c',`import subprocess; print(subprocess.Popen(${JSON.stringify(bounded)},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)`]:bounded;
    const result=await this.api(`${path(id)}/exec`,'POST',{argv,timeoutSeconds:options.background?30:seconds},{'X-Instabox-Exec-Keepalive':'1'},(options.background?45:seconds+30)*1000);
    if(result.error)throw new Error('instabox_command_transport_failed');
    if(result.truncated||result.invalidUtf8)throw new Error('instabox_command_output_incomplete');
    if(!Number.isInteger(result.exitCode)||typeof result.stdout!=='string'||typeof result.stderr!=='string')throw new Error('instabox_command_completion_unknown');
    if(options.background){if(result.exitCode!==0||!/^\d+\s*$/.test(result.stdout)||Number(result.stdout)<=0)throw new Error('instabox_background_start_unknown');return {stdout:'',stderr:'',exit_code:null,pid:Number(result.stdout)};}
    return {stdout:result.stdout as string,stderr:result.stderr as string,exit_code:result.exitCode as number};
  }
  async write(id:string,destination:string,bytes:Uint8Array){
    const query=new URLSearchParams({path:filePath(destination),parents:'true',mode:'0600'});
    const result=await (await this.response(`${path(id)}/files?${query}`,'PUT',Buffer.from(bytes),{'Content-Type':'application/octet-stream'},120000)).json() as any;
    if(result.size!==bytes.length||result.sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('instabox_file_write_incomplete');
  }
  async read(id:string,source:string){
    const response=await this.response(`${path(id)}/files/content?${new URLSearchParams({path:filePath(source)})}`);
    const size=Number(response.headers.get('content-length'));
    if(!response.headers.has('content-length')||!Number.isSafeInteger(size)||size<0||size>64*1024*1024){await response.body?.cancel();throw new Error('instabox_file_size_unsupported');}
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==size)throw new Error('instabox_file_read_incomplete');return bytes;
  }
  async preview(id:string,port:number){segment(id);return openInstaboxTunnel(id,port,publicKey=>this.api(`${path(id)}/connections`,'POST',{publicKey,ttlSeconds:120},{'Idempotency-Key':randomUUID()}));}
}
export const instaboxConnection:ConnectionAdapter={kind:'sandbox',provider:'instabox',config:instaboxConfig,capabilities:['files','commands','preview','pause_resume'],validate:(config,credential)=>new InstaboxConnector(config,credential).validate()};
