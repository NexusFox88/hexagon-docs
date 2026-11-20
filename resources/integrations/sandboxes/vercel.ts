import { APIError, Sandbox, type NetworkPolicyRule } from '@vercel/sandbox';
import { z } from 'zod';
import type { NativeCredentialAccess, SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import { openVercelTunnel } from './vercel-transport.js';

export const vercelConfig = z.object({
  project_id: z.string().regex(/^prj_[A-Za-z0-9]+$/), team_id: z.string().regex(/^team_[A-Za-z0-9]+$/),
  vcpus: z.number().int().refine(value => value === 1 || (value >= 2 && value <= 32 && value % 2 === 0)).default(2),
}).strict();

export class VercelConnector implements SandboxConnector {
  readonly resumeMode='filesystem' as const;
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof vercelConfig>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = vercelConfig.parse(config); }
  private auth() { return { token: this.credential, projectId: this.config.project_id, teamId: this.config.team_id }; }
  private get(name: string) { return Sandbox.get({ ...this.auth(), name, resume: false, signal: AbortSignal.timeout(15000) }); }
  private resource(box: Sandbox) { return { id: box.name, state: box.persistent&&box.status==='stopped'?'paused':box.status, memory_mb: box.memory, expires_at: box.expiresAt?.toISOString() }; }
  private async running(id: string) {
    const box = await this.get(id);
    if (box.status !== 'running') throw new Error('vercel_sandbox_not_running');
    return box;
  }
  async configureCredentialAccess(id:string,network:SandboxRequest['network'],bindings:NativeCredentialAccess[]) {
    const allow:Record<string,NetworkPolicyRule[]>={};
    for(const binding of bindings){
      const endpoint=new URL(binding.base_url);
      if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!/^\/access\/[a-f0-9-]{36}$/.test(endpoint.pathname)||!/^([a-f0-9]{64})$/.test(binding.token))throw new Error('invalid_native_access_binding');
      (allow[endpoint.hostname]??=[]).push({match:{path:{startsWith:`${endpoint.pathname}/`}},transform:[{headers:{authorization:`Bearer ${binding.token}`,'x-api-key':binding.token}}]});
    }
    // Retain the Session's network contract. The credential proxy still enforces
    // exact path/method, current Run state, version and revocation on every request.
    if(network.mode==='unrestricted')allow['*']=[];
    else for(const host of network.allowed_hosts)allow[host]??=[];
    await (await this.running(id)).updateNetworkPolicy({allow},{signal:AbortSignal.timeout(15000)});
  }
  async validate() { await Sandbox.list({ ...this.auth(), limit: 1, signal: AbortSignal.timeout(15000) }); return { operations: ['list_sandboxes'], project_id: this.config.project_id, team_id: this.config.team_id }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('vercel_network_allowlist_unsupported');
    const box = await Sandbox.create({ ...this.auth(), name: `hexagon-${request.operation_id}`, persistent: true,
      ports: [], timeout: request.timeout_seconds * 1000, resources: { vcpus: this.config.vcpus },
      tags: { hexagon_operation: request.operation_id }, networkPolicy: 'allow-all', signal: AbortSignal.timeout(90000) });
    if (box.routes.length || !box.persistent) throw new Error('vercel_resource_policy_mismatch');
    return this.resource(box);
  }
  async findByOperation(operation: string) {
    const name = `hexagon-${operation}`;
    const rows = await (await Sandbox.list({ ...this.auth(), namePrefix: name, sortBy: 'name', signal: AbortSignal.timeout(15000) })).toArray();
    return rows.filter(row => row.name === name).map(row => ({ id: row.name, state: row.status }));
  }
  async inspect(id: string) {
    try { return this.resource(await this.get(id)); }
    catch (error) { if (error instanceof APIError && error.response.status === 404) return null; throw error; }
  }
  async pause(id:string){const box=await this.get(id);if(!box.persistent)throw new Error('vercel_persistence_required');await box.stop({signal:AbortSignal.timeout(90000)});}
  async resume(id:string){await Sandbox.get({...this.auth(),name:id,resume:true,signal:AbortSignal.timeout(90000)});}
  async destroy(id: string) {
    try { await (await this.get(id)).delete({ deleteOrphanSnapshots: true, signal: AbortSignal.timeout(30000) }); }
    catch (error) { if (!(error instanceof APIError && error.response.status === 404)) throw error; }
    if (await this.inspect(id)) throw new Error('vercel_deletion_unconfirmed');
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    const box = await this.running(id);
    const args = ['--kill-after=5s', `${seconds}s`, 'bash', '-lc', command];
    if (options.background) { await box.runCommand({ cmd: 'timeout', args, detached: true, signal: AbortSignal.timeout(15000) }); return { stdout: '', stderr: '', exit_code: null }; }
    const result = await box.runCommand({ cmd: 'timeout', args, signal: AbortSignal.timeout((seconds + 15) * 1000) });
    return { stdout: await result.stdout(), stderr: await result.stderr(), exit_code: result.exitCode };
  }
  async write(id: string, path: string, bytes: Uint8Array) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    await (await this.running(id)).writeFiles([{ path, content: Buffer.from(bytes) }], { signal: AbortSignal.timeout(30000) });
  }
  async read(id: string, path: string) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    const bytes = await (await this.running(id)).readFileToBuffer({ path }, { signal: AbortSignal.timeout(30000) });
    if (!bytes) throw new Error('sandbox_file_missing'); return bytes;
  }
  async preview(id: string, port: number) {
    const box = await this.running(id);
    if (box.routes.length) throw new Error('vercel_unexpected_public_route');
    return openVercelTunnel(box, port);
  }
}

export const vercelConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'vercel', config: vercelConfig, capabilities: ['files', 'commands', 'preview', 'native_credential_auth', 'pause_resume', 'filesystem_resume'],
  validate: (config, credential) => new VercelConnector(config, credential).validate(),
};
