import { Template, Sandbox, CommandExitError, NotFoundError } from 'e2b';
import { z } from 'zod';
import { getProxyForUrl } from 'proxy-from-env';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest, SandboxImagePreparation, PreparedSandboxImage } from '../../modules/sandboxes/connector.js';

// E2B owns its dispatcher, so the platform's global Undici proxy is not inherited.
export function e2bTransportOptions() {
  const proxy = process.env.NODE_USE_ENV_PROXY === '0' ? '' : getProxyForUrl(`https://api.${process.env.E2B_DOMAIN || 'e2b.app'}`);
  return proxy ? { proxy } : {};
}

const configSchema = z.object({ template: z.string().min(1).default('base') }).strict();
export const e2bConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'e2b', config: configSchema,
  capabilities: ['files', 'commands', 'preview', 'network_allowlist', 'pause_resume', 'oci_image'],
  async validate(_config, credential) {
    await Sandbox.list({ ...e2bTransportOptions(), apiKey: credential, limit: 1, requestTimeoutMs: 15000 }).nextItems();
    return { operations: ['list_sandboxes'] };
  },
};

export class E2BConnector implements SandboxConnector {
  readonly expiry='control_plane' as const;
  private connections = new Map<string, Promise<Sandbox>>();
  private config: z.infer<typeof configSchema>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = configSchema.parse(config); }
  private options() { return { ...e2bTransportOptions(), apiKey: this.credential, requestTimeoutMs: 30000 }; }
  private connect(id: string) {
    let connection = this.connections.get(id);
    if (!connection) {
      connection = Sandbox.connect(id, this.options()).catch(error => { this.connections.delete(id); throw error; });
      this.connections.set(id, connection);
    }
    return connection;
  }
  async prepareImage(request: SandboxImagePreparation) {
    const credentials=request.image.registry_credential;
    const template=Template().fromImage(request.image.reference,credentials);
    const build=await Template.buildInBackground(template,`hexagon-${request.operation_id}`,{
      ...this.options(),cpuCount:2,memoryMB:4096,
    });
    const handle={id:build.templateId,build_id:build.buildId};
    await request.record(handle);
    return handle;
  }
  async inspectImage(handle: PreparedSandboxImage) {
    const result=await Template.getBuildStatus({templateId:handle.id,buildId:handle.build_id},this.options());
    return result.status==='ready'?'ready':result.status==='error'?'failed':'building';
  }
  async findImageByOperation(operation: string) {
    const name=`hexagon-${operation}`, pages=Template.list(this.options());
    const matches=[];
    while(pages.hasNext)for(const item of await pages.nextItems()){
      if(item.names.some(value=>value===name||value.endsWith('/'+name)))matches.push(item);
    }
    // list.buildId identifies the last successful build. Never mistake a prior
    // successful build for the currently pending/failed one.
    if(matches.length!==1||matches[0]!.buildStatus!=='ready'||!matches[0]!.buildId)return undefined;
    return {id:matches[0]!.templateId,build_id:matches[0]!.buildId};
  }
  async deleteImage(handle: PreparedSandboxImage) {
    // SDK accepts provider-confirmed 404, but propagates transport uncertainty.
    await Template.delete(handle.id,this.options());
  }
  async create(request: SandboxRequest) {
    if(request.image&&!request.prepared_image)throw new Error('sandbox_image_not_prepared');
    const sandbox = await Sandbox.create(request.prepared_image??this.config.template, {
      ...this.options(), idempotencyKey: request.operation_id,
      metadata: { hexagon_operation: request.operation_id, hexagon_session: request.session_id },
      timeoutMs: request.timeout_seconds * 1000,
      network: { allowPublicTraffic: false, ...(request.network.mode === 'allowlist' ? { denyOut: ['0.0.0.0/0'], allowOut: request.network.allowed_hosts } : {}) },
    });
    this.connections.set(sandbox.sandboxId, Promise.resolve(sandbox));
    await request.record?.(sandbox.sandboxId,request.operation_id);
    const info = await sandbox.getInfo();
    return { id: sandbox.sandboxId, state: 'running', expires_at:info.endAt.toISOString(), memory_mb: info.memoryMB };
  }
  async findByOperation(operation: string) {
    const pages = Sandbox.list({ ...this.options(), query: { metadata: { hexagon_operation: operation } } });
    const results = [];
    while (pages.hasNext) for (const row of await pages.nextItems()) results.push({ id: row.sandboxId, state: row.state, expires_at: row.endAt.toISOString(), memory_mb: row.memoryMB });
    return results;
  }
  async inspect(id: string) {
    try { const row = await Sandbox.getInfo(id, this.options()); return { id: row.sandboxId, state: row.state, expires_at: row.endAt.toISOString(), memory_mb: row.memoryMB }; }
    catch (error) { if (error instanceof NotFoundError) return null; throw error; }
  }
  async pause(id:string) { await Sandbox.pause(id,this.options()); this.connections.delete(id); }
  async resume(id:string,timeoutSeconds=300) { const sandbox=await Sandbox.connect(id,{...this.options(),timeoutMs:timeoutSeconds*1000});this.connections.set(id,Promise.resolve(sandbox)); }
  async destroy(id: string) { await Sandbox.kill(id, this.options()); this.connections.delete(id); }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const sandbox = await this.connect(id);
    if (options.background) {
      const handle = await sandbox.commands.run(command, { background: true, timeoutMs: (options.timeout_seconds ?? 300) * 1000 });
      return { stdout: '', stderr: '', exit_code: null, pid: handle.pid };
    }
    try {
      const result = await sandbox.commands.run(command, { timeoutMs: (options.timeout_seconds ?? 60) * 1000 });
      return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode };
    } catch (error) {
      if (error instanceof CommandExitError) return { stdout: error.stdout, stderr: error.stderr, exit_code: error.exitCode };
      throw error;
    }
  }
  async write(id: string, path: string, bytes: Uint8Array) { await (await this.connect(id)).files.write(path, new Uint8Array(bytes).buffer); }
  async read(id: string, path: string) { return (await this.connect(id)).files.read(path, { format: 'bytes' }); }
  async preview(id: string, port: number) {
    const sandbox = await this.connect(id);
    if (!sandbox.trafficAccessToken) throw new Error('Private preview token unavailable');
    return { url: `https://${sandbox.getHost(port)}`, headers: { 'e2b-traffic-access-token': sandbox.trafficAccessToken } };
  }
}
