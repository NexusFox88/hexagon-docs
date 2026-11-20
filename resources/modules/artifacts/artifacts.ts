import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { transaction } from '../storage/database.js';
import { ExecutionError, type Lease } from '../execution/runs.js';

const file = z.object({
  name: z.string().min(1).max(512).refine(value => !value.startsWith('/') && !/[\\\x00-\x1f]/.test(value) && value.split('/').every(p => p !== '' && p !== '.' && p !== '..')),
  content_base64: z.string().max(5592408).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const manifest = z.object({ files: z.array(file).max(64) }).strict();
const fields = 'id,session_id,run_id,name,sha256,size::int AS size,created_at';

/** Exported bytes belong to the control plane, independent of sandbox lifetime. */
export class Artifacts {
  constructor(private pool: pg.Pool) {}
  async capture(lease: Lease, input: unknown) {
    const files = manifest.parse(input).files.map(value => ({ ...value, content: Buffer.from(value.content_base64, 'base64') }));
    if (new Set(files.map(f => f.name)).size !== files.length || files.reduce((n, f) => n + f.content.length, 0) > 8 * 1024 * 1024) throw new ExecutionError('invalid_artifact_manifest', 400);
    for (const value of files) if (value.content.length > 4 * 1024 * 1024 || value.content.toString('base64') !== value.content_base64 || createHash('sha256').update(value.content).digest('hex') !== value.sha256) throw new ExecutionError('artifact_integrity_failed', 400);
    return transaction(this.pool, async db => {
      const run = (await db.query('SELECT *,lease_until>now() AS live FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [lease.tenant_id, lease.id])).rows[0];
      if (!run?.live || run.generation !== lease.generation || run.lease_owner !== lease.lease_owner || !['running', 'waiting_authorization', 'waiting_approval', 'cancelling'].includes(run.state)) throw new ExecutionError('lease_lost', 409);
      for (const value of files) {
        const id = randomUUID();
        const inserted = await db.query('INSERT INTO artifacts(tenant_id,id,session_id,run_id,name,storage_key,sha256,size,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,run_id,name) DO NOTHING RETURNING id', [lease.tenant_id, id, run.session_id, run.id, value.name, `postgres:${id}`, value.sha256, value.content.length, value.content]);
        if (inserted.rowCount) await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'artifact.created',$3)", [lease.tenant_id, run.id, { id, name: value.name, sha256: value.sha256, size: value.content.length }]);
        else {
          const prior = (await db.query('SELECT sha256 FROM artifacts WHERE tenant_id=$1 AND run_id=$2 AND name=$3', [lease.tenant_id, run.id, value.name])).rows[0];
          if (prior.sha256 !== value.sha256) throw new ExecutionError('artifact_conflict', 409);
        }
      }
      return (await db.query(`SELECT ${fields} FROM artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY name`, [lease.tenant_id, run.id])).rows;
    });
  }
  async list(tenant: string, run: string) {
    if (!(await this.pool.query('SELECT 1 FROM runs WHERE tenant_id=$1 AND id=$2', [tenant, run])).rowCount) throw new ExecutionError('run_not_found', 404);
    return (await this.pool.query(`SELECT ${fields} FROM artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY name`, [tenant, run])).rows;
  }
  async read(tenant: string, id: string) {
    const row = (await this.pool.query(`SELECT ${fields},content FROM artifacts WHERE tenant_id=$1 AND id=$2`, [tenant, id])).rows[0];
    if (!row?.content) throw new ExecutionError('artifact_not_found', 404);
    return row;
  }
}
