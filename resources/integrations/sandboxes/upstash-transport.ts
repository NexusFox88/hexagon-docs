import type { Box, EphemeralBox, ExecSessionHandle } from '@upstash/box';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { openCommandTunnel, type TunnelCommand } from './command-tunnel.js';

type Executor = Pick<Box | EphemeralBox, 'exec'>;

/** SDK callbacks cannot pause the WebSocket. Bound queued output and request
 * input explicitly, failing the transport instead of silently dropping bytes.
 */
export async function upstashRelay(box: Executor, source: string, port: number): Promise<TunnelCommand> {
  const events = new EventEmitter(); events.on('error', () => {});
  const stdout = new PassThrough(), stderr = new PassThrough();
  stderr.resume();
  let handle: ExecSessionHandle | undefined;
  let failure: Error | undefined;
  let closed = false;
  const fail = (error: Error) => {
    failure ??= error;
    handle?.close();
    events.emit('error', error);
  };
  const receive = (stream: PassThrough, bytes: Uint8Array) => {
    if (closed || failure) return;
    if (stream.readableLength + stream.writableLength + bytes.length > 8 * 1024 * 1024) {
      fail(new Error('upstash_tunnel_buffer_limit')); return;
    }
    stream.write(bytes);
  };
  handle = await box.exec.session({ argv: ['python3', '-u', '-c', source, String(port)],
    onStdout: bytes => receive(stdout, bytes), onStderr: bytes => receive(stderr, bytes) });
  if (failure) { handle.close(); throw failure; }
  const session = handle;
  let inputBytes = 0;
  const stdin = new Writable({
    write(bytes, _encoding, callback) {
      inputBytes += bytes.length;
      if (inputBytes > 16 * 1024 * 1024) { callback(new Error('upstash_tunnel_request_limit')); return; }
      try { session.write(bytes); callback(); } catch { callback(new Error('upstash_tunnel_write_failed')); }
    },
    final(callback) { try { session.endStdin(); callback(); } catch { callback(new Error('upstash_tunnel_eof_failed')); } },
  });
  void session.wait().then(code => {
    if (!closed && code !== 0) fail(new Error('upstash_tunnel_disconnected'));
    stdout.end(); stderr.end(); session.close();
  }, () => fail(new Error('upstash_tunnel_disconnected')));
  return Object.assign(events, { stdin, stdout, stderr,
    kill: (signal?: string) => session.kill(signal),
    close: () => { closed = true; session.close(); stdin.destroy(); stdout.destroy(); stderr.destroy(); },
  });
}

export async function openUpstashTunnel(box: Executor, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
  const source = await readFile(new URL('./stdio-tcp-relay.py', import.meta.url), 'utf8');
  return openCommandTunnel(() => upstashRelay(box, source, port));
}
