import { APIError, ExecError, SpriteCommand, SpritesClient, type Sprite } from '@fly/sprites';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { SandboxConnector, SandboxRequest } from '../../modules/sandboxes/connector.js';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import { openSpritesTunnel } from './sprites-transport.js';

export const spritesConfig = z.object({ memory_mb: z.number().int().min(2048).default(2048), cpus: z.number().int().min(1).max(8).default(2) }).strict();

/** Persistent Sprite resources use the control plane's durable expiry workflow. */
export class SpritesConnector implements SandboxConnector {
  readonly expiry = 'control_plane' as const;
  readonly resumeMode='filesystem' as const;
  readonly persistentWorkspaceRoot='/home/sprite/.hexagon';
  private api: SpritesClient;
  private config: z.infer<typeof spritesConfig>;
  constructor(config: Record<string, unknown>, credential: string) {
    this.config = spritesConfig.parse(config);
    this.api = new SpritesClient(credential, { timeout: 30000 });
  }
  private resource(sprite: Sprite) {
    return { id: sprite.name, state: sprite.status ?? 'unknown', memory_mb: sprite.config?.ramMB };
  }
  async validate() { await this.api.listSprites({ maxResults: 1 }); return { operations: ['list_sprites'], expiry_enforcement: 'control_plane' }; }
  async create(request: SandboxRequest) {
    if (request.network.mode !== 'unrestricted') throw new Error('sprites_network_allowlist_unsupported');
    return this.resource(await this.api.createSprite(`hexagon-${request.operation_id}`, {
      config: { ramMB: this.config.memory_mb, cpus: this.config.cpus }, urlSettings: { auth: 'sprite' }, labels: ['hexagon'],
    }));
  }
  async inspect(id: string) {
    try { return this.resource(await this.api.getSprite(id)); }
    catch (error) { if (error instanceof APIError && error.statusCode === 404) return null; throw error; }
  }
  async findByOperation(operation: string) { const found = await this.inspect(`hexagon-${operation}`); return found ? [found] : []; }
  async destroy(id: string) {
    try { await this.api.deleteSprite(id); }
    catch (error) { if (!(error instanceof APIError && error.statusCode === 404)) throw error; }
    if (await this.inspect(id)) throw new Error('sprites_deletion_unconfirmed');
  }
  async execute(id: string, command: string, options: { timeout_seconds?: number; background?: boolean } = {}) {
    const seconds = options.timeout_seconds ?? 60;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_command_timeout');
    const sprite = this.api.sprite(id);
    if (!options.background) {
      let result;
      try { result = await sprite.execFile('bash', ['-lc', command], { timeout: seconds * 1000, maxRunAfterDisconnect: '1s' }); }
      catch (error) { if (!(error instanceof ExecError)) throw error; result = error.result; }
      return { stdout: String(result.stdout), stderr: String(result.stderr), exit_code: result.exitCode };
    }
    // A bounded detached exec, not an automatically restarted service: arbitrary
    // background commands must never be replayed just because a VM wakes up.
    const marker = `hexagon-started-${randomUUID()}`;
    const process = new SpriteCommand(sprite, 'bash', ['-lc', 'printf "%s\\n" "$1"; exec bash -lc "$2"', 'hexagon', marker, command], { maxRunAfterDisconnect: `${seconds}s` });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const accepted = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('sprites_background_start_unknown')), 15000);
      let output = '';
      process.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-1024); if (output.includes(marker)) resolve(); });
      process.on('error', reject);
      process.on('exit', () => reject(new Error('sprites_background_exited')));
    });
    process.stdout.resume(); process.stderr.resume();
    try { await Promise.all([process.start(), accepted]); return { stdout: '', stderr: '', exit_code: null }; }
    finally { clearTimeout(timer); process.close(); }
  }
  async write(id: string, path: string, bytes: Uint8Array) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    await this.api.sprite(id).filesystem().writeFile(path, Buffer.from(bytes), { mode: 0o600 });
  }
  async read(id: string, path: string) {
    if (!path.startsWith('/')) throw new Error('sandbox_file_path_must_be_absolute');
    return new Uint8Array(await this.api.sprite(id).filesystem().readFile(path, null));
  }
  async preview(id: string, port: number) {
    const sprite = await this.api.getSprite(id);
    if (sprite.urlSettings?.auth !== 'sprite') throw new Error('sprites_url_not_private');
    return openSpritesTunnel(sprite, port);
  }
}

export const spritesConnection: ConnectionAdapter = {
  kind: 'sandbox', provider: 'sprites', config: spritesConfig, capabilities: ['files', 'commands', 'preview', 'automatic_standby', 'filesystem_resume'],
  validate: (config, credential) => new SpritesConnector(config, credential).validate(),
};
