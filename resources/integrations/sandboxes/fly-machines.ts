import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import type { SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';
import { acquireFlyProxy, closeFlyProxies } from './fly-machines-proxy.js';

export const flyMachinesConfig = z.object({ organization: z.string().regex(/^[a-z0-9-]+$/).default('personal'),
  region: z.string().regex(/^[a-z0-9]+$/).default('iad'),memory_mb:z.number().int().min(2048).max(16384).default(4096) }).strict();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const appName = (operation: string) => { if (!/^[a-f0-9-]{36}$/.test(operation)) throw new Error('invalid_operation'); return `hexagon-${operation}`; };
const appId = (id: string) => { if (!/^hexagon-[a-f0-9-]{36}$/.test(id)) throw new Error('invalid_fly_app'); return id; };
class FlyError extends Error { constructor(readonly status: number) { super(`fly_http_${status}`); } }

/** One exclusively owned App/private network per Session. App ID is the durable
 * resource ID, including partial creation where the Machine response was lost.
 */
export class FlyMachinesConnector implements SandboxConnector {
  readonly expiry = 'control_plane' as const;
  // Fly may cold-boot when a memory snapshot is unavailable. Disk is authoritative.
  readonly resumeMode='filesystem' as const;
  private config: z.infer<typeof flyMachinesConfig>;
  constructor(config: Record<string, unknown>, private credential: string) { this.config = flyMachinesConfig.parse(config); }
  private async request(path: string, method = 'GET', body?: unknown, timeout = 90000, headers:Record<string,string>={}): Promise<any> {
    const response = await fetch(`https://api.machines.dev/v1${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) { await response.body?.cancel(); throw new FlyError(response.status); }
    const text = await response.text(); return text ? JSON.parse(text) : undefined;
  }
  async validate() {
    await this.request(`/apps?org_slug=${encodeURIComponent(this.config.organization)}`);
    return { operations: ['list_apps'], expiry_enforcement: 'control_plane', private_transport: 'flyctl_ssh' };
  }
  private async machines(id: string): Promise<any[]> {
    const rows = await this.request(`/apps/${appId(id)}/machines`);
    if (!Array.isArray(rows)) throw new Error('fly_invalid_machines');
    return rows.filter(row => row.state !== 'destroyed');
  }
  async create(request: SandboxRequest) {
    if(request.image?.registry_credential)throw new Error('fly_private_image_unsupported');
    if (request.network.mode !== 'unrestricted') throw new Error('fly_network_allowlist_unsupported');
    const app = appName(request.operation_id);
    await this.request('/apps', 'POST', { app_name: app, org_slug: this.config.organization, network: app });
    // No inherited App secrets, public services, volumes or automatic restart.
    const machine = await this.request(`/apps/${app}/machines`, 'POST', { name: app, region: this.config.region,
      config: { image: request.image?.reference ?? 'node:24-bookworm', init: { exec: ['sleep', 'infinity'] }, auto_destroy: true,
        guest: { cpu_kind: 'shared', cpus: 2, memory_mb: this.config.memory_mb }, restart: { policy: 'no' }, services: [],
        metadata: { hexagon_operation: request.operation_id, hexagon_session: request.session_id } } });
    await this.request(`/apps/${app}/machines/${machine.id}/wait?state=started&timeout=60`);
    return { id: app, state: 'running', memory_mb: this.config.memory_mb };
  }
  async findByOperation(operation: string) { const row = await this.inspect(appName(operation)); return row ? [row] : []; }
  async inspect(id: string) {
    try { await this.request(`/apps/${appId(id)}`); }
    catch (error) { if (error instanceof FlyError && error.status === 404) return null; throw error; }
    const rows = await this.machines(id);
    return { id, state: rows.length === 0 ? 'empty' : rows.length > 1 ? 'ambiguous' : rows[0].state === 'started' ? 'running' : rows[0].state === 'suspended' ? 'paused' : rows[0].state,
      memory_mb: rows.length === 1 ? rows[0].config?.guest?.memory_mb : undefined };
  }
  async pause(id:string){const machine=await this.running(id);await closeFlyProxies(id);await this.request(`/apps/${appId(id)}/machines/${machine.id}/suspend`,'POST');await this.request(`/apps/${appId(id)}/machines/${machine.id}/wait?state=suspended&timeout=60`);}
  async resume(id:string){
    const rows=await this.machines(id);
    if(rows.length!==1)throw new Error('fly_resume_state_invalid');
    const path=`/apps/${appId(id)}/machines/${rows[0].id}`;
    // A new lease fences delayed requests carrying an older nonce. Re-read the
    // exact Machine under that lease; never start stopped (reset) or replacement compute.
    const lease=await this.request(path+'/lease','POST',{ttl:120,description:'Hexagon resume reconciliation'});
    if(!lease?.data?.nonce)throw new Error('fly_lease_invalid');
    const headers={'fly-machine-lease-nonce':lease.data.nonce};
    try{
      const actual=await this.request(path);
      if(actual.state==='started')return;
      if(actual.state!=='suspended')throw new Error('fly_resume_state_pending');
      await this.request(path+'/start','POST',undefined,90000,headers);
      await this.request(path+'/wait?state=started&timeout=60');
    }finally{await this.request(path+'/lease','DELETE',undefined,15000,headers).catch(()=>{});}
  }
  async reconcileResume(id:string){await this.resume(id);}
  async destroy(id: string) {
    await closeFlyProxies(id);
    try { await this.request(`/apps/${appId(id)}?force=true`, 'DELETE'); }
    catch (error) { if (!(error instanceof FlyError && error.status === 404)) throw error; }
    for (let i = 0; i < 60; i++) {
      if (!await this.inspect(id)) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('fly_app_deletion_unconfirmed');
  }
  private async running(id: string) {
    const rows = await this.machines(id);
    if (rows.length !== 1 || rows[0].state !== 'started' || rows[0].config?.metadata?.hexagon_operation !== id.slice(8)) throw new Error('fly_machine_not_ready');
    return rows[0];
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    if (!options.background && seconds > 590) throw new Error('fly_foreground_timeout_limit');
    await this.prepareRuntime(id);
    const machine = await this.running(id);
    const bounded = `timeout -k 5 ${seconds} bash -lc ${quote(command)}`;
    const argv = options.background ? ['python3', '-c', `import subprocess,base64\np=subprocess.Popen(['bash','-lc',base64.b64decode('${Buffer.from(bounded).toString('base64')}').decode()],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\nprint(p.pid)`] : ['bash', '-lc', bounded];
    const result = await this.request(`/apps/${appId(id)}/machines/${machine.id}/exec`, 'POST', {
      command: argv, timeout: options.background ? 20 : seconds + 10 }, (options.background ? 30 : seconds + 20) * 1000);
    if (result.exit_signal || !Number.isInteger(result.exit_code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('fly_command_completion_unknown');
    if (options.background) {
      const pid = Number(result.stdout.trim());
      if (result.exit_code !== 0 || !Number.isInteger(pid) || pid < 1) throw new Error('fly_background_start_unknown');
      return { stdout: '', stderr: '', exit_code: null, pid };
    }
    return { stdout: result.stdout as string, stderr: result.stderr as string, exit_code: result.exit_code as number };
  }
  private preparedRuntimes = new Set<string>();
  private async prepareRuntime(id: string) {
    if (this.preparedRuntimes.has(id)) return;
    const machine = await this.running(id);
    // OCI images need not ship Python. Prepare the same Runtime prerequisites
    // as Modal, inside the owned VM; never run the image's entrypoint.
    const script = "set -eu; if ! command -v python3 >/dev/null || ! command -v bash >/dev/null || ! command -v timeout >/dev/null; then if command -v apk >/dev/null; then apk add --no-cache python3 bash coreutils ca-certificates; elif command -v apt-get >/dev/null; then apt-get update && apt-get install -y --no-install-recommends python3 bash coreutils ca-certificates; else exit 78; fi; fi; command -v python3 >/dev/null; command -v bash >/dev/null; command -v timeout >/dev/null";
    const result = await this.request(`/apps/${appId(id)}/machines/${machine.id}/exec`, 'POST', {
      command: ['sh', '-c', script], timeout: 300 }, 320000);
    if (result.exit_code !== 0 || result.exit_signal) throw new Error('harness_runtime_prerequisites_unavailable');
    this.preparedRuntimes.add(id);
  }
  private async python(id: string, source: string, stdin?: string): Promise<string> {
    await this.prepareRuntime(id);
    const machine = await this.running(id);
    const result = await this.request(`/apps/${appId(id)}/machines/${machine.id}/exec`, 'POST', {
      command: ['timeout', '-k', '5', '60', 'python3', '-c', source], timeout: 70, ...(stdin === undefined ? {} : { stdin }) });
    if (result.exit_code !== 0 || result.exit_signal || typeof result.stdout !== 'string') throw new Error('fly_file_operation_failed'); return result.stdout;
  }
  private path(path: string) { if (!path.startsWith('/') || path.includes('\0')) throw new Error('sandbox_file_path_must_be_absolute'); return JSON.stringify(path); }
  async write(id: string, path: string, bytes: Uint8Array) {
    const destination = this.path(path), temporary = this.path(`${path}.hexagon-${randomUUID()}`);
    await this.python(id, `import os\np=${temporary}\nos.makedirs(os.path.dirname(p),exist_ok=True)\nf=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\nos.close(f)`);
    try {
      for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
        const chunk = Buffer.from(bytes.subarray(offset, offset + 128 * 1024)).toString('base64');
        await this.python(id, `import base64,sys\nwith open(${temporary},'ab') as f:f.write(base64.b64decode(sys.stdin.read()))`, chunk);
      }
      await this.python(id, `import os\nos.replace(${temporary},${destination})`);
    } catch (error) { await this.python(id, `import os\nos.unlink(${temporary})`).catch(() => {}); throw error; }
  }
  async read(id: string, path: string) {
    const quoted = this.path(path), size = Number((await this.python(id, `import os\nprint(os.path.getsize(${quoted}))`)).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) throw new Error('fly_file_size_unsupported');
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < size; offset += 128 * 1024) {
      const length = Math.min(128 * 1024, size - offset);
      const data = await this.python(id, `import base64\nwith open(${quoted},'rb') as f:\n f.seek(${offset})\n print(base64.b64encode(f.read(${length})).decode())`);
      const chunk = Buffer.from(data.trim(), 'base64');
      if (chunk.length !== length) throw new Error('fly_file_read_incomplete'); chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async preview(id: string, port: number) {
    const machine = await this.running(id);
    return acquireFlyProxy(id, machine.id, this.credential, port, async () => {
      const source = await readFile(new URL('./fly-ipv6-relay.py', import.meta.url), 'utf8');
      const marker = `hexagon-relay-${randomUUID()}`;
      const launcher = `import subprocess,base64,json\np=subprocess.Popen(['timeout','--kill-after=5s','360s','python3','-u','-c',base64.b64decode('${Buffer.from(source).toString('base64')}').decode(),'${port}','${marker}'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)\nport=int(p.stdout.readline().decode().strip())\np.stdout.close()\nprint(json.dumps({'port':port,'pid':p.pid}))`;
      const result = JSON.parse(await this.python(id, launcher));
      if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535 || !Number.isInteger(result.pid) || result.pid < 1) throw new Error('fly_relay_start_unknown');
      return { port: result.port, close: async () => {
        await this.python(id, `import os,signal\npid=${result.pid}\ntry:\n cmd=open('/proc/'+str(pid)+'/cmdline','rb').read()\n if b'${marker}' in cmd:os.killpg(pid,signal.SIGTERM)\nexcept ProcessLookupError:pass\nexcept FileNotFoundError:pass`);
      } };
    });
  }
}
export const flyMachinesConnection: ConnectionAdapter = { kind: 'sandbox', provider: 'fly-machines', config: flyMachinesConfig,
  capabilities: ['files', 'commands', 'preview', 'oci_image', 'pause_resume', 'filesystem_resume'], validate: (config, credential) => new FlyMachinesConnector(config, credential).validate() };
