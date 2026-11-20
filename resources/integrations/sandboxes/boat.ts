import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest, SandboxDeletion, SandboxHttpTarget } from '../../modules/sandboxes/connector.js';

export const boatConfig = z.object({ size: z.enum(['small', 'default', 'large']).default('small') }).strict();
const idPath = (id: string) => { if (!/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(id)) throw new Error('invalid_boat_id'); return `/sandboxes/${id}`; };
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
class BoatError extends Error { constructor(readonly status: number) { super(`boat_http_${status}`); } }
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));

export class BoatConnector implements SandboxConnector {
  readonly resumeMode='filesystem' as const;
  readonly expiry = 'control_plane' as const;
  private config: z.infer<typeof boatConfig>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = boatConfig.parse(config); }
  private async api(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, timeout = 90000): Promise<any> {
    const response = await fetch(`https://boat.dev/api/v1${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) { await response.body?.cancel(); throw new BoatError(response.status); }
    const result = await response.json() as any;
    if (result.ok !== true) throw new Error('boat_invalid_response');
    return result;
  }
  private resource(row: any) { idPath(row?.id); return { id: row.id as string, state:row.state==='archived'?'paused':['ready','idle','running'].includes(row.state)?'running':row.state??'unknown' }; }
  async validate() {
    const result = await this.api('/sandboxes?limit=1');
    if (!Array.isArray(result.sandboxes)) throw new Error('boat_invalid_list');
    return { operations: ['list_sandboxes'], expiry_enforcement: 'control_plane' };
  }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('boat_network_allowlist_unsupported');
    const result = await this.api('/sandboxes', 'POST', { name: `hexagon-${request.operation_id}`, type: this.config.size,
      noEnv: true, snapshots: true, ttlSeconds: request.timeout_seconds,
      labels: { hexagon_operation: request.operation_id, hexagon_session: request.session_id } }, { 'Idempotency-Key': request.operation_id });
    return this.resource(result.sandbox);
  }
  async findByOperation(operation: string) {
    const rows = [], seen = new Set<string>(); let cursor = '';
    do {
      const query = new URLSearchParams({ name: `hexagon-${operation}`, label: `hexagon_operation=${operation}`, limit: '200' });
      if (cursor) query.set('cursor', cursor);
      const result = await this.api(`/sandboxes?${query}`);
      if (!Array.isArray(result.sandboxes)) throw new Error('boat_invalid_list');
      rows.push(...result.sandboxes.filter((row: any) => row.name === `hexagon-${operation}` && row.labels?.hexagon_operation === operation).map((row: any) => this.resource(row)));
      if (!result.pageInfo?.hasMore) return rows;
      cursor = result.pageInfo.nextCursor;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new Error('boat_invalid_pagination');
      seen.add(cursor);
    } while (true);
  }
  async inspect(id: string) {
    try { return this.resource((await this.api(idPath(id))).sandbox); }
    catch (error) { if (error instanceof BoatError && error.status === 404) return null; throw error; }
  }
  async reconcileDeletion(id: string, context: SandboxDeletion) {
    let operation = context.provider_operation_id;
    if (!operation) {
      // A missing resource after a lost DELETE response does not prove the purge completed.
      // Preserve the unknown outcome instead of silently marking the Session closed.
      const result = await this.api(idPath(id), 'DELETE', undefined, { 'X-Ascii-Confirm-Delete': id });
      operation = result.operation?.id;
      if (typeof operation !== 'string' || !/^bdop_[a-f0-9]{32}$/.test(operation)) throw new Error('boat_deletion_operation_missing');
      await context.record(operation);
    }
    if (!/^bdop_[a-f0-9]{32}$/.test(operation)) throw new Error('boat_invalid_deletion_operation');
    const deadline = Date.now() + 60000;
    do {
      const result = await this.api(`/deletion-operations/${operation}`);
      if (result.operation?.targetId !== id) throw new Error('boat_deletion_target_mismatch');
      if (result.operation.status === 'completed') {
        if (await this.inspect(id)) throw new Error('boat_deletion_unconfirmed');
        return;
      }
      if (result.operation.status === 'blocked') throw new Error('boat_deletion_blocked');
      await pause();
    } while (Date.now() < deadline);
    throw new Error('boat_deletion_unconfirmed');
  }
  async pause(id:string){await this.api(idPath(id)+'/stop','POST');}
  async resume(id:string,timeout_seconds=600){await this.api(idPath(id)+'/resume','POST',{ttlSeconds:timeout_seconds,noEnv:true});}
  async destroy(id: string) { await this.reconcileDeletion(id, { record: async () => {} }); }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > (options.background ? 3600 : 590)) throw new Error('invalid_command_timeout');
    const result = await this.api(`${idPath(id)}/commands`, 'POST', {
      command: `timeout --kill-after=5s ${seconds}s bash -lc ${quote(command)}`,
      detached: options.background ?? false, timeoutSeconds: options.background ? 30 : seconds + 5,
    }, {}, (options.background ? 90 : seconds + 75) * 1000);
    if (result.stdoutTruncated || result.stderrTruncated) throw new Error('boat_command_output_truncated');
    if (options.background) {
      if (!Number.isSafeInteger(result.pid) || result.pid < 1) throw new Error('boat_background_start_unknown');
      return { stdout: '', stderr: '', exit_code: null, pid: result.pid as number };
    }
    if (!Number.isInteger(result.exitCode) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('boat_command_completion_unknown');
    return { stdout: result.stdout as string, stderr: result.stderr as string, exit_code: result.exitCode as number };
  }
  async write(id: string, path: string, bytes: Uint8Array) {
    if (bytes.length > 5 * 1024 * 1024) throw new Error('boat_file_exceeds_5_mib');
    const result = await this.api(`${idPath(id)}/files`, 'PUT', { path, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' });
    if (result.size !== bytes.length) throw new Error('boat_file_write_incomplete');
  }
  async read(id: string, path: string) {
    const result = await this.api(`${idPath(id)}/files?${new URLSearchParams({ path, encoding: 'base64' })}`);
    if (typeof result.content !== 'string' || result.content.length > 7 * 1024 * 1024) throw new Error('boat_invalid_file');
    const bytes = Buffer.from(result.content, 'base64');
    if (bytes.length !== result.size) throw new Error('boat_file_read_incomplete');
    return bytes;
  }
  async preview(id: string, port: number): Promise<SandboxHttpTarget> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
    const result = await this.api(`${idPath(id)}/host`, 'POST', { port, public: false });
    const url = new URL(result.url), token = url.searchParams.get('_token');
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.on.boat.dev') || url.username || url.password || url.port || !token || /[;\s]/.test(token)) throw new Error('boat_private_url_invalid');
    return { url: url.origin, headers: { Cookie: `_port_auth=${token}` } };
  }
}
export const boatConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'boat', config: boatConfig, capabilities: ['files', 'commands', 'preview', 'pause_resume', 'filesystem_resume'],
  validate: (config, credential) => new BoatConnector(config, credential).validate(),
};
