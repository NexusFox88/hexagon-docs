import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExecutionError } from '../execution/runs.js';
import type { SandboxLifecycle } from './lifecycle.js';

export const previewInput = z.object({ port: z.number().int().min(3000).max(8999).refine(port => port !== 8765), ttl_seconds: z.number().int().min(30).max(3600).default(600) }).strict();
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export class Previews {
  constructor(private pool: pg.Pool, private lifecycle: SandboxLifecycle, private origin = { scheme: 'http', domain: 'localhost', port: 8788 }) {}
  async create(tenant: string, session: string, input: z.input<typeof previewInput>) {
    const config = previewInput.parse(input);
    const row = (await this.pool.query(`SELECT state,sandbox,EXISTS(SELECT 1 FROM resource_operations o
      WHERE o.tenant_id=s.tenant_id AND o.session_id=s.id AND o.kind='create' AND o.detail->>'expiry'='control_plane'
      AND (o.detail->>'expires_at')::timestamptz<=now()) AS expired FROM sessions s WHERE tenant_id=$1 AND id=$2`, [tenant, session])).rows[0];
    if (!row) throw new ExecutionError('session_not_found', 404);
    if (row.state !== 'open' || !row.sandbox?.id || row.expired) throw new ExecutionError('preview_session_unavailable', 409);
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + config.ttl_seconds * 1000);
    await this.pool.query('INSERT INTO preview_grants(id,tenant_id,session_id,port,token_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [id, tenant, session, config.port, digest(token), expires]);
    const url = `${this.origin.scheme}://${id}.${this.origin.domain}${this.origin.port ? `:${this.origin.port}` : ''}/?ticket=${token}`;
    return { id, session_id: session, port: config.port, expires_at: expires.toISOString(), url };
  }
  async revoke(tenant: string, id: string) {
    if (!(await this.pool.query('UPDATE preview_grants SET revoked_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id', [tenant, id])).rowCount) throw new ExecutionError('preview_not_found', 404);
  }
  async authorize(hostname: string, token: string) {
    const suffix = `.${this.origin.domain}`;
    if (!hostname.endsWith(suffix)) throw new ExecutionError('preview_unauthorized', 401);
    const id = hostname.slice(0, -suffix.length);
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) throw new ExecutionError('preview_unauthorized', 401);
    const row = (await this.pool.query(`SELECT p.*,s.sandbox FROM preview_grants p JOIN sessions s ON s.tenant_id=p.tenant_id AND s.id=p.session_id
      WHERE p.id=$1 AND p.token_digest=$2 AND p.revoked_at IS NULL AND p.expires_at>now() AND s.state='open'
      AND NOT EXISTS(SELECT 1 FROM resource_operations o WHERE o.tenant_id=s.tenant_id AND o.session_id=s.id AND o.kind='create'
        AND o.detail->>'expiry'='control_plane' AND (o.detail->>'expires_at')::timestamptz<=now())`, [id, digest(token)])).rows[0];
    if (!row?.sandbox?.id) throw new ExecutionError('preview_unauthorized', 401);
    return row;
  }
  async target(grant: any) {
    const connector = await this.lifecycle.access(grant.tenant_id, grant.session_id);
    return connector.preview(grant.sandbox.id, grant.port);
  }
}
