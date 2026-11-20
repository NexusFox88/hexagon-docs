import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest, SandboxHttpTarget } from '../../modules/sandboxes/connector.js';

export const agent37Config = z.object({ region: z.enum(['us', 'eu']).default('us') }).strict();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const segment = (id: string) => { if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid_agent37_id'); return id; };
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
class Agent37Error extends Error { constructor(readonly status: number) { super(`agent37_http_${status}`); } }
type Instance = { id: string; name?: string; status: string; metadata?: Record<string, string>; resources?: { memory?: number }; public_ports?: unknown[] };

export class Agent37Connector implements SandboxConnector {
  readonly resumeMode='filesystem' as const;
  readonly persistentWorkspaceRoot='/home/node/.hexagon';
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof agent37Config>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = agent37Config.parse(config); }
  private async request(path: string, method = 'GET', body?: unknown, timeout = 30000): Promise<any> {
    const response = await fetch(`https://api.agent37.com/v1${path}`, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Agent37Error(response.status); }
    return response.json();
  }
  private async list(): Promise<Instance[]> {
    const result = await this.request('/instances');
    if (!Array.isArray(result.data)) throw new Error('agent37_invalid_instance_list');
    return result.data;
  }
  private resource(row: Instance) {
    return { id: segment(row.id), state:row.status==='stopped'?'paused':row.status||'unknown', ...(row.resources?.memory ? { memory_mb: row.resources.memory * 1024 } : {}) };
  }
  async validate() { await this.list(); return { operations: ['list_instances'], expiry_enforcement: 'control_plane', template: 'agent37-base' }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('agent37_network_allowlist_unsupported');
    const row: Instance = await this.request('/instances', 'POST', { template: 'agent37-base', name: `hexagon-${request.operation_id}`,
      region: this.config.region, resources: { cpu: 2, memory: 4, disk: 4 }, auto_sleep: false, public_ports: [],
      metadata: { hexagon_operation: request.operation_id, hexagon_session: request.session_id }, budget: { monthly_cap_micros: 0 } }, 90000);
    if (row.public_ports?.length) throw new Error('agent37_unexpected_public_ports');
    return this.resource(row);
  }
  async findByOperation(operation: string) {
    return (await this.list()).filter(row => row.name === `hexagon-${operation}` && row.metadata?.hexagon_operation === operation).map(row => this.resource(row));
  }
  async inspect(id: string) {
    try { return this.resource(await this.request(`/instances/${segment(id)}`)); }
    catch (error) { if (error instanceof Agent37Error && error.status === 404) return null; throw error; }
  }
  async pause(id:string){await this.request(`/instances/${segment(id)}/stop`,'POST');}
  async resume(id:string){await this.request(`/instances/${segment(id)}/start`,'POST');}
  async destroy(id: string) {
    try { await this.request(`/instances/${segment(id)}`, 'DELETE', undefined, 90000); }
    catch (error) { if (!(error instanceof Agent37Error && error.status === 404)) throw error; }
    const deadline = Date.now() + 30000;
    do { if (!await this.inspect(id)) return; await pause(); } while (Date.now() < deadline);
    throw new Error('agent37_deletion_unconfirmed');
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    if ((await this.inspect(id))?.state !== 'running') throw new Error('agent37_sandbox_not_running');
    const result = await this.request(`/instances/${segment(id)}/exec`, 'POST', {
      command: `timeout --kill-after=5s ${seconds}s bash -lc ${quote(command)}`, background: options.background ?? false, name: randomUUID(),
    }, (options.background ? 30 : seconds + 15) * 1000);
    if (result.truncated) throw new Error('agent37_command_output_truncated');
    if (options.background) {
      if (!Number.isInteger(result.pid) || result.pid < 1) throw new Error('agent37_background_start_unknown');
      return { stdout: '', stderr: '', exit_code: null, pid: result.pid };
    }
    if (!Number.isInteger(result.exit_code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('agent37_command_result_invalid');
    return { stdout: result.stdout as string, stderr: result.stderr as string, exit_code: result.exit_code as number };
  }
  private async python(id: string, source: string) {
    const result = await this.execute(id, `python3 -c ${quote(source)}`);
    if (result.exit_code !== 0) throw new Error('agent37_file_operation_failed');
    return result.stdout;
  }
  private path(path: string) { if (!path.startsWith('/') || path.includes('\0')) throw new Error('sandbox_file_path_must_be_absolute'); return JSON.stringify(path); }
  async write(id: string, path: string, bytes: Uint8Array) {
    const destination = this.path(path), temporary = this.path(`${path}.hexagon-${randomUUID()}`);
    await this.python(id, `import os\np=${temporary}\nos.makedirs(os.path.dirname(p),exist_ok=True)\nf=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\nos.close(f)`);
    try {
      for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
        const chunk = Buffer.from(bytes.subarray(offset, offset + 128 * 1024)).toString('base64');
        await this.python(id, `import base64\nwith open(${temporary},'ab') as f:f.write(base64.b64decode('${chunk}'))`);
      }
      await this.python(id, `import os\nos.replace(${temporary},${destination})`);
    } catch (error) {
      // No retries of uncertain writes. Best-effort removal only of this temporary file.
      await this.python(id, `import os\nos.unlink(${temporary})`).catch(() => {}); throw error;
    }
  }
  async read(id: string, path: string) {
    const quoted = this.path(path);
    const size = Number((await this.python(id, `import os\nprint(os.path.getsize(${quoted}))`)).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) throw new Error('agent37_file_size_unsupported');
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < size; offset += 128 * 1024) {
      const length = Math.min(128 * 1024, size - offset);
      const encoded = await this.python(id, `import base64\nwith open(${quoted},'rb') as f:\n f.seek(${offset})\n print(base64.b64encode(f.read(${length})).decode())`);
      const chunk = Buffer.from(encoded.trim(), 'base64');
      if (chunk.length !== length) throw new Error('agent37_file_read_incomplete');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async preview(id: string, port: number): Promise<SandboxHttpTarget> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
    if ((await this.inspect(id))?.state !== 'running') throw new Error('agent37_sandbox_not_running');
    // The authenticated edge strips this account header before reaching the guest.
    // This is verified by a real probe, not assumed from URL privacy alone.
    return { url: `https://${segment(id)}-${port}.agent37.app`, headers: { 'X-Agent37-Key': this.credential } };
  }
}
export const agent37Connection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'agent37', config: agent37Config, capabilities: ['files', 'commands', 'preview', 'pause_resume', 'filesystem_resume'],
  validate: (config, credential) => new Agent37Connector(config, credential).validate(),
};
