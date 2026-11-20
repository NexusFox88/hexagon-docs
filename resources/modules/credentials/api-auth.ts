import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../storage/database.js';

export function tokenDigest(token: string) { return createHash('sha256').update(token).digest('hex'); }

export async function initializeOwner(pool: pg.Pool) {
  return transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(734829102)');
    const tenant = 'local-workspace';
    if ((await db.query('SELECT 1 FROM tenants WHERE id=$1', [tenant])).rowCount) return null;
    const token = `hx_${randomBytes(32).toString('base64url')}`;
    await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenant, 'Local workspace']);
    await db.query('INSERT INTO api_keys(digest,tenant_id,label) VALUES($1,$2,$3)', [tokenDigest(token), tenant, 'Local owner']);
    return { tenant, token };
  });
}

export async function authenticate(pool: pg.Pool, authorization?: string): Promise<string | null> {
  return (await authenticateIdentity(pool,authorization))?.tenant_id??null;
}
export async function authenticateIdentity(pool:pg.Pool,authorization?:string){
  if (!authorization?.startsWith('Bearer ')) return null;
  const result = await pool.query('UPDATE api_keys SET last_used_at=now() WHERE digest=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING tenant_id,role,id', [tokenDigest(authorization.slice(7))]);
  return result.rows[0] ?? null;
}
