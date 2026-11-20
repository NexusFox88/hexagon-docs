import { readFile } from 'node:fs/promises';
import { SpriteCommand, type Sprite } from '@fly/sprites';
import { openCommandTunnel } from './command-tunnel.js';

/** The provider token stays in the SDK; the remote relay receives only a port. */
export async function openSpritesTunnel(sprite: Sprite, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
  const source = await readFile(new URL('./stdio-tcp-relay.py', import.meta.url), 'utf8');
  return openCommandTunnel(async () => {
    const command = new SpriteCommand(sprite, 'python3', ['-u', '-c', source, String(port)], { maxRunAfterDisconnect: '1s' });
    // start() rejects handshake failure; consume subsequent error events until
    // the tunnel attaches its own socket-failure handler.
    command.on('error', () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([command.start(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('sprites_tunnel_start_timeout')), 15000);
      })]);
      return command;
    }
    catch (error) { command.close(); throw error; }
    finally { clearTimeout(timer); }
  });
}
