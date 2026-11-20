import { ModalClient, NotFoundError } from 'modal';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxCheckpoint, SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';

export const modalConfig = z.object({ app: z.string().min(1).default('hexagon'), image: z.string().min(1).default('python:3.12-slim'), memory_mb: z.number().int().min(2048).default(2048), cpu: z.number().positive().default(2), region: z.string().optional() }).strict();
const credentialSchema = z.object({ token_id: z.string().min(1), token_secret: z.string().min(1) }).strict();
function client(credential: string) { const value = credentialSchema.parse(JSON.parse(credential)); return new ModalClient({ tokenId: value.token_id, tokenSecret: value.token_secret, maxRetries: 0, timeoutMs: 30000 }); }
export const modalConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'modal', config: modalConfig, capabilities: ['files', 'commands', 'preview', 'network_allowlist', 'oci_image', 'private_oci_image', 'pause_resume', 'filesystem_resume'],
  async validate(config, credential) { const api = client(credential); try { const iterator = api.sandboxes.list(); await iterator.next(); await iterator.return(); return { operations: ['list_sandboxes'], app: config.app }; } finally { api.close(); } },
};
export class ModalConnector implements SandboxConnector {
  readonly resumeMode='filesystem' as const;
  readonly expiry='control_plane' as const;
  private config: z.infer<typeof modalConfig>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = modalConfig.parse(config); }
  private async use<T>(work: (api: ModalClient) => Promise<T>) { const api = client(this.credential); try { return await work(api); } finally { api.close(); } }
  async create(request: SandboxRequest) { return this.use(async api => {
    const app = await api.apps.fromName(this.config.app, { createIfMissing: true });
    const registrySecret=request.image?.registry_credential?await api.secrets.fromObject({REGISTRY_USERNAME:request.image.registry_credential.username,REGISTRY_PASSWORD:request.image.registry_credential.password}):undefined;
    const base=api.images.fromRegistry(request.image?.reference??this.config.image,registrySecret);
    const runtimeImage=request.image?base.dockerfileCommands(['USER root', 'RUN if command -v apk >/dev/null; then apk add --no-cache python3 nodejs bash curl git coreutils; elif command -v apt-get >/dev/null; then apt-get update && apt-get install -y --no-install-recommends python3 nodejs bash curl git ca-certificates && rm -rf /var/lib/apt/lists/*; else exit 1; fi', 'ENTRYPOINT []', 'CMD []', `USER ${request.image.user??'root'}`]):base.dockerfileCommands(['RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm curl git ca-certificates && rm -rf /var/lib/apt/lists/*']);
    const sandbox = await api.sandboxes.create(app, runtimeImage, {
      command:['sleep','infinity'],
      name: `hexagon-${request.operation_id}`, tags: { hexagon_operation: request.operation_id, hexagon_session: request.session_id },
      timeoutMs: request.timeout_seconds * 1000, memoryMiB: this.config.memory_mb, cpu: this.config.cpu,
      ...(this.config.region ? { regions: [this.config.region] } : {}),
      ...(request.network.mode === 'allowlist' ? { outboundDomainAllowlist: request.network.allowed_hosts } : {}),
    });
    await request.record?.(sandbox.sandboxId,request.operation_id);
    return { id: sandbox.sandboxId, state: 'running', memory_mb: this.config.memory_mb };
  }); }
  async snapshot(id:string,context?:SandboxCheckpoint){return this.use(async api=>{
    const imageId=(await(await api.sandboxes.fromId(id)).snapshotFilesystem({timeoutMs:120000})).imageId;
    await context?.record(imageId);
    return imageId;
  });}
  async restore(checkpoint:string,request:SandboxRequest){return this.use(async api=>{
    const app=await api.apps.fromName(this.config.app,{createIfMissing:true});
    const image=await api.images.fromId(checkpoint);
    const box=await api.sandboxes.create(app,image,{command:['sleep','infinity'],name:`hexagon-${request.operation_id}`,tags:{hexagon_operation:request.operation_id,hexagon_session:request.session_id},timeoutMs:request.timeout_seconds*1000,memoryMiB:this.config.memory_mb,cpu:this.config.cpu,...(this.config.region?{regions:[this.config.region]}:{}),...(request.network.mode==='allowlist'?{outboundDomainAllowlist:request.network.allowed_hosts}:{})});
    return {id:box.sandboxId,state:'running',memory_mb:this.config.memory_mb};
  });}
  async deleteSnapshot(id:string){await this.use(async api=>{try{await api.images.delete(id);}catch(e){if(!(e instanceof NotFoundError))throw e;}});}
  async findByOperation(operation: string) { return this.use(async api => {
    try { const sandbox = await api.sandboxes.fromName(this.config.app, `hexagon-${operation}`); return [{ id: sandbox.sandboxId, state: 'running', memory_mb: this.config.memory_mb }]; }
    catch (error) { if (error instanceof NotFoundError) return []; throw error; }
  }); }
  async inspect(id: string) { return this.use(async api => { try { const sandbox = await api.sandboxes.fromId(id); return await sandbox.poll() === null ? { id, state: 'running', memory_mb: this.config.memory_mb } : null; } catch(error) { if (error instanceof NotFoundError) return null; throw error; } }); }
  async destroy(id: string) { await this.use(async api => { try { await (await api.sandboxes.fromId(id)).terminate({ wait: true }); } catch(error) { if (!(error instanceof NotFoundError)) throw error; } }); }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) { return this.use(async api => {
    const sandbox = await api.sandboxes.fromId(id);
    const seconds = options.timeout_seconds ?? 60;
    const args = options.background ? ['python3', '-c', 'import subprocess,sys; p=subprocess.Popen(["timeout",sys.argv[1],"bash","-lc",sys.argv[2]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); print(p.pid)', String(seconds), command] : ['bash', '-lc', command];
    const process = await sandbox.exec(args, { timeoutMs: (options.background ? 30 : seconds) * 1000 });
    const [stdout, stderr, exit_code] = await Promise.all([process.stdout.readText(), process.stderr.readText(), process.wait()]);
    if (options.background && exit_code === 0) return { stdout: '', stderr: '', exit_code: null, pid: Number(stdout.trim()) };
    return { stdout, stderr, exit_code };
  }); }
  async write(id: string, path: string, bytes: Uint8Array) { await this.use(async api => { await (await api.sandboxes.fromId(id)).filesystem.writeBytes(bytes, path); }); }
  async read(id: string, path: string) { return this.use(async api => (await api.sandboxes.fromId(id)).filesystem.readBytes(path)); }
  async preview(id: string, port: number) { return this.use(async api => { const access = await (await api.sandboxes.fromId(id)).createConnectToken({ port }); return { url: access.url.replace(/\/$/, ''), headers: { Cookie: `_modal_connect_token=${access.token}` } }; }); }
}
