import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ExecutionError} from '../execution/runs.js';

const endpoint = z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
});
export const deploymentInput = z.object({
  outbound_proxy: endpoint.optional(),
  no_proxy: z.array(z.string().max(253).regex(/^(?:\*|\.?[a-zA-Z0-9][a-zA-Z0-9.:-]*)$/)).max(128).default([]),
  ingress: z.discriminatedUnion('mode', [
    z.object({mode:z.literal('cloudflare')}).strict(),
    z.object({mode:z.literal('disabled')}).strict(),
    z.object({mode:z.literal('external'),url:endpoint.refine(value=>new URL(value).protocol==='https:')}).strict(),
  ]).default({mode:'cloudflare'}),
}).strict();
export type DeploymentConfig = z.infer<typeof deploymentInput>;
const revision = (value:DeploymentConfig) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class DeploymentSettings {
  constructor(readonly directory:string) {}
  async read() {
    let source:unknown = {};
    try { source=JSON.parse(await readFile(join(this.directory,'deployment.json'),'utf8')); }
    catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new ExecutionError('deployment_configuration_invalid',500);}
    const parsed=deploymentInput.safeParse(source);
    if(!parsed.success)throw new ExecutionError('deployment_configuration_invalid',500);
    return {config:parsed.data,revision:revision(parsed.data)};
  }
  async update(input:unknown) {
    const {config,expected_revision}=z.object({config:deploymentInput,expected_revision:z.string().length(64)}).strict().parse(input);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    let lock;
    try {lock=await open(join(this.directory,'deployment.lock'),'wx',0o600);}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ExecutionError('deployment_configuration_busy',409);throw error;}
    const temporary=join(this.directory,`deployment-${randomUUID()}.tmp`);
    try {
      if((await this.read()).revision!==expected_revision)throw new ExecutionError('deployment_configuration_changed',409);
      await writeFile(temporary,JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
      await rename(temporary,join(this.directory,'deployment.json'));
      return {config,revision:revision(config),restart_required:true};
    }finally{await unlink(temporary).catch(()=>{});await lock.close();await unlink(join(this.directory,'deployment.lock'));}
  }
}

/** Explicit environment wins; defaults and saved no-proxy entries are merged. */
export function deploymentEnvironment(config:DeploymentConfig,source:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const proxy=source.HTTPS_PROXY??source.https_proxy??config.outbound_proxy;
  const noProxy=[...new Set(['127.0.0.1','localhost',...config.no_proxy,...(source.NO_PROXY??source.no_proxy??'').split(',').filter(Boolean)])].join(',');
  const external=source.HEXAGON_ACCESS_URL??(config.ingress.mode==='external'?config.ingress.url:undefined);
  return {...source,NODE_USE_ENV_PROXY:'1',NO_PROXY:noProxy,no_proxy:noProxy,
    ...(proxy?{HTTPS_PROXY:proxy,https_proxy:proxy,HTTP_PROXY:source.HTTP_PROXY??source.http_proxy??proxy,http_proxy:source.HTTP_PROXY??source.http_proxy??proxy}:{}),
    HEXAGON_ACCESS_URL:external??'',
    HEXAGON_ACCESS_TUNNEL:external?'':(source.HEXAGON_ACCESS_TUNNEL??(config.ingress.mode==='cloudflare'?'cloudflare':'')),
    ...(proxy&&!source.HEXAGON_ACCESS_EGRESS_PROXY_URL?{HEXAGON_ACCESS_EGRESS_PROXY_URL:proxy,HEXAGON_ACCESS_EGRESS_HOSTS:source.HEXAGON_ACCESS_EGRESS_HOSTS??'api.siliconflow.com,api.minimaxi.com,api.minimax.io,api.minimax.chat'}:{}),
  };
}
