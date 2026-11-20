import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxHttpTarget } from '../../modules/sandboxes/connector.js';

type Proxy = { url: string; app: string; users: number; stopped: boolean; idle?: ReturnType<typeof setTimeout>; stop: () => void };
const proxies = new Map<string, Promise<Proxy>>();
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function listening(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}
async function reachable(url: string) {
  try {
    // A listening local socket alone does not prove WireGuard/DNS/guest readiness.
    // HEAD carries no credentials and no body; 401/404/405/501 still prove HTTP.
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000) });
    await response.body?.cancel(); return true;
  } catch { return false; }
}
type Bridge = { port: number; close: () => Promise<void> };
async function start(app: string, machine: string, credential: string, remotePort: number, remove: () => void, prepare?: () => Promise<Bridge>): Promise<Proxy> {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('fly_proxy_port_missing');
  const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), 'hexagon-fly-proxy-'));
  await writeFile(join(directory, 'config.yml'), '{}\n', { mode: 0o600 });
  let bridge: Bridge | undefined;
  try { bridge = await prepare?.(); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const env: NodeJS.ProcessEnv = { ...process.env, FLY_CONFIG_DIR: directory, FLY_API_TOKEN: credential, FLY_AGENT_ISOLATED: '1', FLY_WIREGUARD_TOKEN_MODE: '1' };
  delete env.FLY_AGENT_SOCKET_PATH; delete env.FLY_AGENT_SOCKET_DIR;
  const child = spawn('fly', ['proxy', `${port}:${bridge?.port ?? remotePort}`, `${machine}.vm.${app}.internal`, '--app', app,
    '--bind-addr', '127.0.0.1', '--watch-stdin', '--quiet'], { env, stdio: 'pipe' });
  child.stdout.resume(); child.stderr.resume(); child.stdin.on('error', () => {});
  let force: ReturnType<typeof setTimeout> | undefined;
  const proxy: Proxy = { app, url: `http://127.0.0.1:${port}`, users: 0, stopped: false, stop() {
    if (proxy.stopped) return; proxy.stopped = true; remove(); clearTimeout(proxy.idle);
    child.stdin.end(); child.kill('SIGTERM');
    force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref();
  } };
  const lifetime = setTimeout(proxy.stop, 5 * 60 * 1000); lifetime.unref();
  child.once('error', proxy.stop);
  child.once('close', () => { proxy.stopped = true; remove(); clearTimeout(proxy.idle); clearTimeout(lifetime); clearTimeout(force);
    void bridge?.close().catch(() => {});
    void rm(directory, { recursive: true, force: true }).catch(() => {}); });
  try {
    await once(child, 'spawn');
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !proxy.stopped) {
      if (await listening(port) && await reachable(proxy.url)) return proxy;
      await pause();
    }
    throw new Error('fly_proxy_start_timeout');
  } catch { proxy.stop(); throw new Error('fly_proxy_unavailable'); }
}
/** Reuse an authenticated exact-Machine tunnel between adjacent Runtime calls.
 * Each caller has a lease; idle tunnels close after ten seconds, all tunnels
 * rotate within five minutes, and App cleanup explicitly releases them.
 */
export async function acquireFlyProxy(app: string, machine: string, credential: string, port: number, prepare?: () => Promise<Bridge>): Promise<SandboxHttpTarget> {
  if (!/^hexagon-[a-z0-9-]+$/.test(app) || !/^[a-f0-9]+$/.test(machine) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_fly_proxy_target');
  const key = createHash('sha256').update(JSON.stringify([app, machine, credential, port])).digest('hex');
  let pending = proxies.get(key);
  if (!pending) {
    pending = start(app, machine, credential, port, () => { if (proxies.get(key) === pending) proxies.delete(key); }, prepare);
    proxies.set(key, pending); void pending.catch(() => { if (proxies.get(key) === pending) proxies.delete(key); });
  }
  const proxy = await pending;
  if (proxy.stopped) throw new Error('fly_proxy_closed');
  clearTimeout(proxy.idle); proxy.users++;
  let released = false;
  return { url: proxy.url, headers: {}, release() {
    if (released) return; released = true; proxy.users--;
    if (!proxy.users && !proxy.stopped) { proxy.idle = setTimeout(proxy.stop, 10000); proxy.idle.unref(); }
  } };
}
export async function closeFlyProxies(app: string) {
  for (const pending of [...proxies.values()]) { const proxy = await pending.catch(() => undefined); if (proxy?.app === app) proxy.stop(); }
}
