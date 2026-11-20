import { Box, BoxError } from '@upstash/box';
import { z } from 'zod';
import type { SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import { openUpstashTunnel } from './upstash-transport.js';

export const upstashConfig = z.object({ size: z.enum(['small', 'medium', 'large']).default('small') }).strict();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Persistent disk, idle compute; Harness choice remains owned by Hexagon Runtime. */
export class UpstashConnector implements SandboxConnector {
  readonly resumeMode='filesystem' as const;
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof upstashConfig>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = upstashConfig.parse(config); }
  private options(timeout = 30000) { return { apiKey: this.credential, enableTelemetry: false, timeout }; }
  async validate() { await Box.list(this.options()); return { operations: ['list_boxes'], expiry_enforcement: 'control_plane', provider_ttl_requested: false }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('upstash_network_allowlist_unsupported');
    if (!Number.isInteger(request.timeout_seconds) || request.timeout_seconds < 1 || request.timeout_seconds > 259200) throw new Error('invalid_sandbox_timeout');
    const box = await Box.create({ ...this.options(), name: `hexagon-${request.operation_id}`, labels: ['hexagon'],
      runtime: 'node', size: this.config.size, keepAlive:false, networkPolicy: { mode: 'allow-all' } });
    return { id: box.id, state: 'running' };
  }
  async findByOperation(operation: string) {
    return (await Box.list({ ...this.options(), label: 'hexagon' })).filter(row => row.name === `hexagon-${operation}`).map(row => ({ id: row.id, state: row.status }));
  }
  async inspect(id: string) {
    try { const box = await Box.get(id, this.options()); const status=(await box.getStatus()).status;return {id:box.id,state:status==='idle'?'running':status}; }
    catch (error) { if (error instanceof BoxError && error.statusCode === 404) return null; throw error; }
  }
  async pause(id:string){await (await Box.get(id,this.options())).pause();}
  async resume(id:string){await (await Box.get(id,this.options(90000))).resume();}
  async destroy(id: string) {
    try { await Box.delete({ ...this.options(), boxIds: id }); }
    catch (error) { if (!(error instanceof BoxError && error.statusCode === 404)) throw error; }
    if (await this.inspect(id)) throw new Error('upstash_deletion_unconfirmed');
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    const box = await Box.get(id, this.options((seconds + 15) * 1000));
    // GNU timeout enforces a remote deadline even if the control plane goes away.
    const bounded = `timeout --kill-after=5s ${seconds}s bash -lc ${quote(command)}`;
    if (options.background) {
      const launcher = `import base64,subprocess; print(subprocess.Popen(['bash','-lc',base64.b64decode('${Buffer.from(bounded).toString('base64')}').decode()],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)`;
      const result = await box.exec.command(`python3 -c ${quote(launcher)}`);
      if (result.exitCode !== 0 || !/^\d+\s*$/.test(result.stdout)) throw new Error('upstash_background_start_unknown');
      return { stdout: '', stderr: '', exit_code: null, pid: Number(result.stdout.trim()) };
    }
    const result = await box.exec.command(bounded);
    return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode };
  }
  async write(id: string, path: string, bytes: Uint8Array) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    await (await Box.get(id, this.options())).files.write({ path, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' });
  }
  async read(id: string, path: string) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    return Buffer.from(await (await Box.get(id, this.options())).files.read(path, { encoding: 'base64' }), 'base64');
  }
  async preview(id: string, port: number) { return openUpstashTunnel(await Box.get(id, this.options(15000)), port); }
}

export const upstashConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'upstash', config: upstashConfig, capabilities: ['files', 'commands', 'preview', 'pause_resume', 'filesystem_resume'],
  validate: (config, credential) => new UpstashConnector(config, credential).validate(),
};
