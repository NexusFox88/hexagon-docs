import { readFile } from 'node:fs/promises';
import type { SandboxConnector, SandboxHttpTarget } from './connector.js';

/** No reliable response from the existing Runtime; never implies process loss. */
export class RuntimeUnavailableError extends Error {
  constructor() { super('runtime_unreachable'); }
}

export class RuntimeClient {
  private target?: SandboxHttpTarget;
  constructor(private connector: SandboxConnector, private sandbox: string, private token: string) {}
  async bootstrap() { await this.prepare(); await this.start(); }
  /** Safe to repeat before any launch intent exists. */
  async prepare() {
    if(this.connector.persistentWorkspaceRoot){
      const root=this.connector.persistentWorkspaceRoot;
      if(!/^\/[a-zA-Z0-9/._-]+$/.test(root))throw new Error('invalid_persistent_workspace_root');
      const prepared=await this.connector.execute(this.sandbox,`python3 - <<'PYWORKSPACE'
from pathlib import Path
root=Path('${root}')
root.mkdir(parents=True,exist_ok=True,mode=0o700)
for name in ['hexagon-runtime','hexagon-pi','hexagon-harnesses','hexagon-harness']:
 target=root/name
 target.mkdir(exist_ok=True,mode=0o700)
 link=Path('/tmp')/name
 if link.is_symlink():
  if link.resolve()!=target.resolve(): raise RuntimeError('workspace_link_mismatch')
 elif link.exists(): raise RuntimeError('workspace_path_conflict')
 else: link.symlink_to(target,target_is_directory=True)
PYWORKSPACE`);
      if(prepared.exit_code!==0)throw new Error('persistent_workspace_prepare_failed');
    }
    const source = await readFile(new URL('../../runtime/server.py', import.meta.url));
    const prepared = await this.connector.execute(this.sandbox, 'mkdir -p /tmp/hexagon-runtime && chmod 700 /tmp/hexagon-runtime');
    if (prepared.exit_code !== 0) throw new Error('runtime_prepare_failed');
    await this.writePreparedFile('/tmp/hexagon-runtime/server.py', source);
    await this.writePreparedFile('/tmp/hexagon-runtime/tool_bridge.py', await readFile(new URL('../../runtime/tool_bridge.py', import.meta.url)));
    await this.writePreparedFile('/tmp/hexagon-runtime/token', Buffer.from(this.token));
    const launcher = "import os, runpy, fcntl\nfrom pathlib import Path\nlock = open('/tmp/hexagon-runtime/server.lock', 'w')\ntry: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError: raise SystemExit(0)\nos.environ['HEXAGON_RUNTIME_TOKEN'] = Path('/tmp/hexagon-runtime/token').read_text()\nos.environ['HEXAGON_RUNTIME_HOME'] = '/tmp/hexagon-runtime'\nos.environ['PORT'] = '8765'\nrunpy.run_path('/tmp/hexagon-runtime/server.py', run_name='__main__')\n";
    await this.writePreparedFile('/tmp/hexagon-runtime/launch.py', Buffer.from(launcher));
  }
  /** Reconcile a lost upload response against the exact immutable bytes. No process launch or blind retry. */
  private async writePreparedFile(path:string,bytes:Uint8Array) {
    try { await this.connector.write(this.sandbox,path,bytes); }
    catch(error) {
      try { if(Buffer.from(await this.connector.read(this.sandbox,path)).equals(Buffer.from(bytes)))return; } catch { /* The original failure remains authoritative. */ }
      throw error;
    }
  }
  /** Call only after persisting launch intent; an uncertain launch must not repeat. */
  async start() {
    const launched = await this.connector.execute(this.sandbox, 'chmod 600 /tmp/hexagon-runtime/token && python3 /tmp/hexagon-runtime/launch.py', { background: true, timeout_seconds: 3600 });
    if (launched.exit_code !== null && launched.exit_code !== 0) throw new Error('runtime_launch_failed');
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { await this.request('GET', '/health'); return; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    throw new Error('runtime_start_timeout');
  }
  /** Reconcile an ambiguous daemon launch before any new Run invocation exists.
   * The launcher uses the same advisory lock, so a delayed original launch and
   * this recovery cannot both run a server. A held/unknown lock never relaunches.
   */
  async reconcileStart() {
    try { await this.request('GET','/health'); return; } catch { /* Inspect the launch lock locally. */ }
    const probe=await this.connector.execute(this.sandbox,`python3 - <<'PYLOCK'
import os,fcntl
fd=os.open('/tmp/hexagon-runtime/server.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
try:
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 print('free')
except BlockingIOError:
 print('held')
finally:
 os.close(fd)
PYLOCK`);
    if(probe.exit_code!==0||probe.stdout.trim()!=='free')throw new RuntimeUnavailableError();
    await this.start();
  }
  async request(method: string, path: string, body?: unknown) {
    // Some provider edges reserve /health and return their own unauthenticated
    // response. Use a product-owned path and verify the Runtime protocol.
    const health = method === 'GET' && path === '/health';
    if (health) path = '/_hexagon/health';
    let target: SandboxHttpTarget;
    try { target = this.target ?? await this.connector.preview(this.sandbox, 8765); }
    catch { throw new RuntimeUnavailableError(); }
    // Stable provider URLs may be cached. A local tunnel belongs to this call,
    // including its safe transport retries, and must never be reused after release.
    if (!target.release) this.target = target;
    try {
      const result = await this.requestTarget(target, method, path, body);
      if (health && (result?.state !== 'ready' || result?.protocol !== 1)) throw new RuntimeUnavailableError();
      return result;
    }
    finally { target.release?.(); }
  }
  private async requestTarget(target: SandboxHttpTarget, method: string, path: string, body?: unknown) {
    // Runtime POST /runs is keyed by immutable Run id + body hash, and cancel is
    // idempotent. Only these known-safe requests and reads may retry a lost response.
    const retryable = method === 'GET' || (method === 'POST' && (path === '/runs' || /^\/runs\/[a-z0-9-]+\/cancel$/.test(path)));
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${target.url}${path}`, {
          method, headers: { ...target.headers, Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        if (!retryable || attempt >= 2) throw new RuntimeUnavailableError();
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 500) throw new RuntimeUnavailableError();
        throw new Error(`runtime_request_failed_${response.status}`);
      }
      return response.json();
    }
  }
}
