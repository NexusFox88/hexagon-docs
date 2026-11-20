import type { Vm, PtySession } from 'freestyle';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { openCommandTunnel, type TunnelCommand } from './command-tunnel.js';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
/** Raw PTY bytes carry private HTTP. No public domains or ingress are created. */
export async function freestyleRelay(vm: Pick<Vm, 'pty'>, source: string, port: number): Promise<TunnelCommand> {
  const events = new EventEmitter(); events.on('error', () => {});
  const stdout = new PassThrough(), stderr = new PassThrough(); stderr.resume();
  let session: PtySession | undefined, failure: Error | undefined, closed = false, ready = false;
  const marker = Buffer.from(`HEXAGON-RAW-${randomUUID()}\n`);
  let prefix = Buffer.alloc(0);
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void readiness.catch(() => {});
  const fail = () => {
    failure ??= new Error('freestyle_tunnel_disconnected');
    rejectReady(failure); events.emit('error', failure); stdout.destroy(); stderr.destroy();
  };
  const timer = setTimeout(fail, 15000); timer.unref();
  const relay = `import tty,sys\ntty.setraw(0)\nsys.stdout.buffer.write(${JSON.stringify(marker.toString())}.encode());sys.stdout.buffer.flush()\n${source}`;
  try {
    session = await vm.pty.open({ exec: `timeout --kill-after=5s 45s python3 -u -c ${quote(relay)} ${port}`, reconnect: false,
      onData(bytes) {
        if (closed || failure) return;
        let data = Buffer.from(bytes);
        if (!ready) {
          prefix = Buffer.concat([prefix, data]);
          const at = prefix.indexOf(marker);
          if (at < 0) { if (prefix.length > 4096) fail(); return; }
          data = prefix.subarray(at + marker.length); prefix = Buffer.alloc(0); ready = true; clearTimeout(timer); resolveReady();
        }
        if (stdout.readableLength + stdout.writableLength + data.length > 8 * 1024 * 1024) { fail(); return; }
        stdout.write(data);
      },
      onExit(code) { if (code !== 0 || !ready) fail(); else { stdout.end(); stderr.end(); } },
      onError() { if (!closed) fail(); },
      onClose() { if (!closed && !stdout.writableEnded) fail(); },
    });
    await readiness;
    if (failure) throw failure;
  } catch (error) {
    closed = true; session?.detach(); if (session) await vm.pty.close(session.sessionId).catch(() => {});
    stdout.destroy(); stderr.destroy(); throw error;
  } finally { clearTimeout(timer); }
  const handle = session;
  let sent = 0;
  const stdin = new Writable({ write(bytes, _encoding, callback) {
    sent += bytes.length;
    if (sent > 16 * 1024 * 1024) { callback(new Error('freestyle_tunnel_request_limit')); return; }
    try { handle.write(bytes); callback(); } catch { callback(new Error('freestyle_tunnel_write_failed')); }
  } });
  return Object.assign(events, { stdin, stdout, stderr,
    kill: () => { try { handle.signal('sigkill'); } catch {} void vm.pty.close(handle.sessionId).catch(() => {}); },
    close: () => { closed = true; handle.detach(); stdin.destroy(); stdout.destroy(); stderr.destroy(); },
  });
}
export async function openFreestyleTunnel(vm: Pick<Vm, 'pty'>, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
  const source = await readFile(new URL('./stdio-tcp-relay.py', import.meta.url), 'utf8');
  return openCommandTunnel(() => freestyleRelay(vm, source, port));
}
