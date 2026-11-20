import { Freestyle, FreestyleApiError, type VmData } from 'freestyle';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';
import { openFreestyleTunnel } from './freestyle-transport.js';

export const freestyleConfig = z.object({ snapshot: z.enum(['freestyle/ubuntu-sm', 'freestyle/ubuntu']).default('freestyle/ubuntu-sm') }).strict();
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export class FreestyleConnector implements SandboxConnector {
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof freestyleConfig>;
  private client: Freestyle;
  constructor(config: Record<string, unknown>, credential: string) {
    this.config = freestyleConfig.parse(config);
    this.client = new Freestyle({ apiKey: credential, fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(90000) }) });
  }
  private resource(vm: VmData) { return { id: vm.id, state: vm.state, memory_mb: vm.resources.memory }; }
  async validate() { await this.client.vms.list({ limit: 1 }); return { operations: ['list_vms'], expiry_enforcement: 'control_plane' }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('freestyle_network_allowlist_unsupported');
    const result = await this.client.vms.create({ slug: `hexagon-${request.operation_id}`, snapshotId: this.config.snapshot,
      metadata: { hexagon_operation: request.operation_id, hexagon_session: request.session_id },
      ttlSeconds: -1, autoDeleteSeconds: -1, idleTimeoutSeconds: -1, automaticRestart: false,
      firewall: { rules: [{ action: 'allow', source: {}, destination: { public: true } }] } });
    return this.resource(result.data);
  }
  async findByOperation(operation: string) {
    const slug = `hexagon-${operation}`;
    // Slugs are account-unique; never request reassignSlug during creation.
    return (await this.client.vms.list({ slug })).vms.filter(vm => vm.slug === slug && vm.metadata?.hexagon_operation === operation).map(vm => this.resource(vm));
  }
  async inspect(id: string) {
    try { return this.resource(await this.client.vms.get(id)); }
    catch (error) { if (error instanceof FreestyleApiError && error.status === 404) return null; throw error; }
  }
  async pause(id:string){await this.client.vms.ref(id).pause();}
  async resume(id:string){await this.client.vms.ref(id).start();}
  async destroy(id: string) {
    try { await this.client.vms.delete(id); }
    catch (error) { if (!(error instanceof FreestyleApiError && error.status === 404)) throw error; }
    if (await this.inspect(id)) throw new Error('freestyle_deletion_unconfirmed');
  }
  private async running(id: string) {
    if ((await this.inspect(id))?.state !== 'running') throw new Error('freestyle_sandbox_not_running');
    return this.client.vms.ref(id);
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    // The filesystem API writes root-owned 0600 files. Pin command identity to
    // the same guest user; provider defaults may instead select uid 1000.
    const vm = await this.running(id);
    const bounded = `timeout --kill-after=5s ${seconds}s bash -lc ${quote(command)}`;
    if (options.background) {
      const source = `import base64,subprocess;print(subprocess.Popen(['bash','-lc',base64.b64decode('${Buffer.from(bounded).toString('base64')}').decode()],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)`;
      const result = await vm.exec({ command: `python3 -c ${quote(source)}`, linuxUser: 'root', timeoutMs: 15000 });
      if (result.statusCode !== 0 || !/^\d+\s*$/.test(result.stdout ?? '')) throw new Error('freestyle_background_start_unknown');
      return { stdout: '', stderr: '', exit_code: null, pid: Number(result.stdout?.trim()) };
    }
    const result = await vm.exec({ command: bounded, linuxUser: 'root', timeoutMs: (seconds + 5) * 1000 });
    if (result.statusCode == null) throw new Error('freestyle_command_completion_unknown');
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exit_code: result.statusCode };
  }
  async write(id: string, path: string, bytes: Uint8Array) {
    await (await this.running(id)).fs.writeFile(path, bytes, { mode: 0o600, signal: AbortSignal.timeout(60000) });
  }
  async read(id: string, path: string) {
    return this.client.vms.ref(id).fs.readFile(path, { signal: AbortSignal.timeout(60000) });
  }
  async preview(id: string, port: number) { return openFreestyleTunnel(await this.running(id), port); }
}
export const freestyleConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'freestyle', config: freestyleConfig, capabilities: ['files', 'commands', 'preview', 'pause_resume'],
  validate: (config, credential) => new FreestyleConnector(config, credential).validate(),
};
