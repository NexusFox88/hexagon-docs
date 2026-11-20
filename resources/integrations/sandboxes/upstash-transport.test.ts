import { once } from 'node:events';
import type { Box, ExecSessionOptions, ExecSessionHandle } from '@upstash/box';
import { expect, it, vi } from 'vitest';
import { upstashRelay } from './upstash-transport.js';

function fixture() {
  let options!: ExecSessionOptions;
  let finish!: (code: number) => void;
  const exited = new Promise<number>(resolve => { finish = resolve; });
  const handle = { write: vi.fn(), endStdin: vi.fn(), kill: vi.fn(), close: vi.fn(), wait: () => exited } as unknown as ExecSessionHandle;
  const box = { exec: { session: vi.fn(async (value: ExecSessionOptions) => { options = value; return handle; }) } } as unknown as Box;
  return { box, handle, finish, output: (bytes: Uint8Array) => options.onStdout!(bytes) };
}

it('delivers exact bytes and EOF; closes the session after remote completion', async () => {
  const f = fixture(), command = await upstashRelay(f.box, 'relay', 8765);
  const chunks: Buffer[] = [];
  command.stdout.on('data', bytes => chunks.push(bytes));
  const ended = once(command.stdout, 'end');
  command.stdin.end(Buffer.from([0, 255, 1]));
  expect(f.handle.write).toHaveBeenCalledWith(Buffer.from([0, 255, 1]));
  expect(f.handle.endStdin).toHaveBeenCalledOnce();
  f.output(Buffer.from([255, 0, 128])); f.finish(0);
  await ended;
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([255, 0, 128]));
  expect(f.handle.close).toHaveBeenCalled();
  command.close?.();
});

it('fails a slow reader rather than buffering unlimited provider output', async () => {
  const f = fixture(), command = await upstashRelay(f.box, 'relay', 8765);
  const errors: Error[] = []; command.on('error', error => errors.push(error));
  f.output(Buffer.alloc(9 * 1024 * 1024));
  expect(errors[0]?.message).toBe('upstash_tunnel_buffer_limit');
  expect(command.stdout.readableLength).toBe(0);
  expect(f.handle.close).toHaveBeenCalled();
  command.close?.(); f.finish(-1);
});

it('reports an abnormal session exit as transport failure', async () => {
  const f = fixture(), command = await upstashRelay(f.box, 'relay', 8765);
  const errors: Error[] = []; command.on('error', error => errors.push(error));
  f.finish(-1);
  await vi.waitFor(() => expect(errors[0]?.message).toBe('upstash_tunnel_disconnected'));
  command.close?.();
});
