import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';

export const blaxelConfig = z.object({
  workspace: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  image: z.string().min(1).default('blaxel/base-image:latest'),
  memory_mb: z.number().int().min(2048).default(2048),
  region: z.string().min(1).optional(),
}).strict();
class BlaxelError extends Error {
  constructor(readonly status: number, readonly operation?: string, readonly retryAfter?: string | null, readonly providerCode?: string | null, readonly providerReason?: string) { super(`blaxel_request_failed_${status}`); }
}
type RemoteSandbox = { metadata?: { name?: string; url?: string }; status?: string; spec?: { runtime?: { expires?: string; memory?: number } } };
type Preview = { spec?: { port?: number; public?: boolean; url?: string } };
const segment = encodeURIComponent;
const pause = () => new Promise(resolve => setTimeout(resolve, 500));

/** Credentials belong to this connection, never to process-wide SDK settings. */
export class BlaxelConnector implements SandboxConnector {
  readonly expiry='control_plane' as const;
  private config: z.infer<typeof blaxelConfig>;
  private urls = new Map<string, string>();
  constructor(config: Record<string, unknown>, private credential: string) { this.config = blaxelConfig.parse(config); }
  private async request(base: string, path: string, method = 'GET', body?: unknown, timeout = 30000) {
    const form = body instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${this.credential}`, 'X-Blaxel-Workspace': this.config.workspace, 'Blaxel-Version': '2026-04-28', ...(path.startsWith('/filesystem/') && method === 'GET' ? { Accept: 'application/octet-stream' } : {}), ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    // Provider errors may echo credentials or command bodies. Keep them out of logs.
    if (!response.ok) {
      let reason: string | undefined;
      if (response.status === 429) {
        const raw = await response.text();
        reason = raw.split(this.credential).join('[REDACTED]').replace(/[A-Za-z0-9_./+\-=]{24,}/g, '[REDACTED]').slice(0, 1000);
      } else await response.body?.cancel();
      throw new BlaxelError(response.status, `${method} ${path}`, response.headers.get('retry-after'), response.headers.get('x-blaxel-error-code'), reason);
    }
    return response;
  }
  private control(path: string, method = 'GET', body?: unknown) { return this.request('https://api.blaxel.ai/v0', path, method, body); }
  private async data(id: string, path: string, method = 'GET', body?: unknown, timeout?: number) {
    if (!this.urls.has(id)) await this.inspect(id);
    const url = this.urls.get(id);
    if (!url) throw new Error('blaxel_data_url_missing');
    return this.request(url, path, method, body, timeout);
  }
  private resource(value: RemoteSandbox) {
    if (!value.metadata?.name) throw new Error('blaxel_invalid_resource');
    if (value.metadata.url) {
      const url = new URL(value.metadata.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.bl.run') || url.username || url.password || url.search) throw new Error('blaxel_data_url_invalid');
      this.urls.set(value.metadata.name, url.toString().replace(/\/$/, ''));
    }
    return { id: value.metadata.name, state: value.status === 'DEPLOYED' ? 'running' : value.status ?? 'unknown', expires_at: value.spec?.runtime?.expires, memory_mb: value.spec?.runtime?.memory };
  }
  async validate() { await (await this.control('/sandboxes')).body?.cancel(); return { operations: ['list_sandboxes'], workspace: this.config.workspace }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('blaxel_network_allowlist_unsupported');
    const id = `hexagon-${request.operation_id}`;
    await this.control('/sandboxes', 'POST', {
      metadata: { name: id, labels: { hexagon_operation: request.operation_id, hexagon_session: request.session_id } },
      spec: { ...(this.config.region ? { region: this.config.region } : {}), runtime: { image: this.config.image, memory: this.config.memory_mb } },
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const resource = await this.inspect(id);
      if (resource?.state === 'running') return resource;
      if (resource && ['FAILED', 'TERMINATED', 'DELETING'].includes(resource.state)) throw new Error('blaxel_deployment_failed');
      await pause();
    }
    throw new Error('blaxel_deployment_timeout');
  }
  async inspect(id: string) {
    try { const value = await (await this.control(`/sandboxes/${segment(id)}`)).json() as RemoteSandbox; return value.status === 'TERMINATED' ? null : this.resource(value); }
    catch (error) { if (error instanceof BlaxelError && error.status === 404) return null; throw error; }
  }
  async findByOperation(operation: string) { const row = await this.inspect(`hexagon-${operation}`); return row ? [row] : []; }
  async cleanupAssociatedResources(id: string) {
    const path = `/sandboxes/${segment(id)}/previews`;
    for (let page = 0; page < 100; page++) {
      let value: Array<{metadata?:{name?:string}}> | {data:Array<{metadata?:{name?:string}}>} ;
      try { value = await (await this.control(path)).json(); }
      catch (error) { if (error instanceof BlaxelError && error.status === 404) return; throw error; }
      const previews = Array.isArray(value) ? value : value.data;
      if (!Array.isArray(previews)) throw new Error('blaxel_preview_list_invalid');
      if (!previews.length) return;
      for (const preview of previews) {
        if (!preview.metadata?.name) throw new Error('blaxel_preview_identity_missing');
        try { await (await this.control(`${path}/${segment(preview.metadata.name)}`, 'DELETE')).body?.cancel(); }
        catch (error) { if (!(error instanceof BlaxelError && error.status === 404)) throw error; }
      }
    }
    throw new Error('blaxel_preview_cleanup_unconfirmed');
  }
  async destroy(id: string) {
    await this.cleanupAssociatedResources(id);
    try { await (await this.control(`/sandboxes/${segment(id)}`, 'DELETE')).body?.cancel(); }
    catch (error) { if (!(error instanceof BlaxelError && error.status === 404)) throw error; }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) { if (!await this.inspect(id)) return; await pause(); }
    throw new Error('blaxel_cleanup_unconfirmed');
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    const response = await this.data(id, '/process', 'POST', { name: `hexagon-${randomUUID()}`, command, timeout: seconds, keepAlive: !options.background, waitForCompletion: !options.background }, (options.background ? 30 : seconds + 15) * 1000);
    const result = await response.json() as { stdout: string; stderr: string; exitCode: number; pid: string; status: string };
    if (!options.background && result.status === 'running') throw new Error('blaxel_process_completion_unknown');
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exit_code: result.status === 'running' ? null : result.exitCode, pid: Number(result.pid) || undefined };
  }
  private filePath(path: string) { if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute'); return `/filesystem/${path.split('/').map(segment).join('/')}`; }
  async write(id: string, path: string, bytes: Uint8Array) {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)]), 'file.bin'); form.append('permissions', '0600');
    await (await this.data(id, this.filePath(path), 'PUT', form)).body?.cancel();
  }
  async read(id: string, path: string) { return new Uint8Array(await (await this.data(id, this.filePath(path))).arrayBuffer()); }
  private async ensurePreviewListener(id: string, port: number) {
    // Blaxel ingress is IPv6; a user app may listen only on IPv4. Keep this
    // adaptation outside the app/Harness. An IPv6-only listener can share the
    // same port with an IPv4-only app; native IPv6 apps need no bridge.
    if (port === 8765) return;
    const listeners = await this.execute(id, `python3 - <<'PYLISTEN'
import socket
available=[]
for host in ['127.0.0.1','::1']:
 try:
  with socket.create_connection((host,${port}),timeout=1): available.append(host)
 except OSError: pass
print('ipv4' if available == ['127.0.0.1'] else 'native')
PYLISTEN`);
    if (listeners.exit_code !== 0) throw new Error('blaxel_preview_listener_check_failed');
    if (listeners.stdout.trim() !== 'ipv4') return;
    const processName = `hexagon-ingress-${port}`;
    let process: { status?: string; command?: string } | undefined;
    try { process = await (await this.data(id, `/process/${processName}`)).json(); }
    catch (error) { if (!(error instanceof BlaxelError && error.status === 404)) throw error; }
    if (process && process.status !== 'running') {
      await (await this.data(id, `/process/${processName}`, 'DELETE')).body?.cancel();
      process = undefined;
    }
    if (!process) {
      await this.execute(id, 'mkdir -p /tmp/hexagon-blaxel-ports && chmod 700 /tmp/hexagon-blaxel-ports');
      const temporary = `/tmp/hexagon-blaxel-ports/bridge-${randomUUID()}.py`;
      await this.write(id, temporary, await readFile(new URL('./blaxel-port-bridge.py', import.meta.url)));
      const state = `/tmp/hexagon-blaxel-ports/state-${randomUUID()}.json`;
      try {
        process = await (await this.data(id, '/process', 'POST', { name: processName, command: `python3 ${temporary} serve ${port} ${state}`, keepAlive: false, timeout: 3600, waitForCompletion: false })).json();
      } catch (error) {
        // A concurrent caller may have started this exact named bridge. Never
        // start another bridge after an uncertain response.
        if (!(error instanceof BlaxelError && error.status === 409)) throw error;
        process = await (await this.data(id, `/process/${processName}`)).json();
      }
    }
    const state = process?.command?.match(/ (\/tmp\/hexagon-blaxel-ports\/state-[a-f0-9-]+\.json)$/)?.[1];
    if (!state) throw new Error('blaxel_preview_bridge_state_invalid');
    let ingressPort: number | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { ingressPort = JSON.parse(Buffer.from(await this.read(id, state)).toString()).port; break; }
      catch (error) { if (!(error instanceof BlaxelError && error.status === 404)) throw error; await pause(); }
    }
    if (ingressPort !== port) throw new Error('blaxel_preview_bridge_failed');
  }
  async preview(id: string, port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
    await this.ensurePreviewListener(id, port);
    const path = `/sandboxes/${segment(id)}/previews`, name = `hexagon-${port}`;
    let preview: Preview;
    try { preview = await (await this.control(`${path}/${name}`)).json() as Preview; }
    catch (error) {
      if (!(error instanceof BlaxelError && error.status === 404)) throw error;
      try {
        preview = await (await this.control(path, 'POST', { metadata: { name }, spec: { port, public: false } })).json() as Preview;
      } catch (creationError) {
        // Independent clients can both observe absence. A name conflict is
        // reconciled by reading the winner, never by another mutation.
        if (!(creationError instanceof BlaxelError && creationError.status === 409)) throw creationError;
        preview = await (await this.control(`${path}/${name}`)).json() as Preview;
      }
    }
    if (preview.spec?.public !== false || preview.spec.port !== port || !preview.spec.url) throw new Error('blaxel_preview_not_private');
    const url = new URL(preview.spec.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || !(url.hostname.endsWith('.bl.run') || url.hostname.endsWith('.blaxel.ai'))) throw new Error('blaxel_preview_url_invalid');
    type Token = { spec?: { token?: string; expiresAt?: string; expired?: boolean } };
    const listed = await (await this.control(`${path}/${name}/tokens`)).json() as Token[] | { data: Token[] };
    const tokens = Array.isArray(listed) ? listed : listed.data;
    if (!Array.isArray(tokens)) throw new Error('blaxel_preview_token_list_invalid');
    const token = tokens.find(value => value.spec?.token && !value.spec.expired && Date.parse(value.spec.expiresAt ?? '') > Date.now() + 300000)
      ?? await (await this.control(`${path}/${name}/tokens`, 'POST', { metadata: { name: `hexagon-${randomUUID()}` }, spec: { expiresAt: new Date(Date.now() + 86400000).toISOString() } })).json() as Token;
    if (!token.spec?.token) throw new Error('blaxel_preview_token_missing');
    return { url: url.toString().replace(/\/$/, ''), headers: { 'X-Blaxel-Preview-Token': token.spec.token } };
  }
}
export const blaxelConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'blaxel', config: blaxelConfig, capabilities: ['files', 'commands', 'preview', 'automatic_standby'],
  validate: (config, credential) => new BlaxelConnector(config, credential).validate(),
};
