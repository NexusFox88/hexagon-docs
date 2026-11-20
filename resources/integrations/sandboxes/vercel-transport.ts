import type { Sandbox } from '@vercel/sandbox';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { openCommandTunnel } from './command-tunnel.js';

/** Vercel's log API is text; base64 frames preserve arbitrary HTTP bytes.
 * No public ports or account credentials are placed in the sandbox.
 */
export async function openVercelTunnel(box: Sandbox, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
  const source = await readFile(new URL('./stdio-tcp-relay.py', import.meta.url), 'utf8');
  return openCommandTunnel(async () => {
    const command = await box.runCommand({ cmd: 'timeout', args: ['--kill-after=5s', '45s', 'python3', '-u', '-c', source, String(port), '--base64'], stdin: true, detached: true, signal: AbortSignal.timeout(15000) });
    const abort = new AbortController(), events = new EventEmitter(); events.on('error', () => {});
    const stdout = new PassThrough(), stderr = new PassThrough(); stderr.resume();
    const stdin = new Writable({
      write(bytes, _encoding, callback) { void command.writeStdin(bytes, { abortSignal: abort.signal }).then(() => callback(), () => callback(new Error('vercel_tunnel_write_failed'))); },
      final(callback) { void command.closeStdin({ abortSignal: abort.signal }).then(() => callback(), () => callback(new Error('vercel_tunnel_eof_failed'))); },
    });
    void (async () => {
      let pending = '';
      for await (const entry of command.logs({ signal: abort.signal })) {
        if (entry.stream !== 'stdout') continue;
        pending += entry.data;
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          if (line.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(line)) throw new Error('vercel_tunnel_frame_invalid');
          if (!stdout.write(Buffer.from(line, 'base64'))) await once(stdout, 'drain', { signal: abort.signal });
        }
        if (pending.length > 87384) throw new Error('vercel_tunnel_frame_limit');
      }
      if (pending || (await command.wait({ signal: abort.signal })).exitCode !== 0) throw new Error('vercel_tunnel_incomplete');
      stdout.end(); stderr.end();
    })().catch(() => { if (!abort.signal.aborted) events.emit('error', new Error('vercel_tunnel_failed')); });
    const kill = () => { void command.kill('SIGTERM', { abortSignal: AbortSignal.timeout(5000) }).catch(() => {}); };
    return Object.assign(events, { stdin, stdout, stderr, kill,
      close: () => { abort.abort(); stdin.destroy(); stdout.destroy(); stderr.destroy(); },
    });
  });
}
