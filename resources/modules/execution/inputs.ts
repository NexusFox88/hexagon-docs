import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { transaction } from '../storage/database.js';
import { ExecutionError } from './runs.js';

export const uploadInput = z.object({ files: z.array(z.object({
  path: z.string().min(1).max(500).refine(path => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every(part => part !== '..' && part !== '.' && part !== ''), 'Workspace-relative path required'),
  content_base64: z.string().max(2 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict()).min(1).max(100) }).strict();

export class SessionInputs {
  constructor(private pool: pg.Pool) {}
  async upload(tenant: string, session: string, input: z.input<typeof uploadInput>) {
    const { files } = uploadInput.parse(input);
    if (new Set(files.map(f => f.path)).size !== files.length) throw new ExecutionError('duplicate_input_path', 400);
    const decoded = files.map(f => ({ path: f.path, bytes: Buffer.from(f.content_base64, 'base64') }));
    if (decoded.reduce((size, f) => size + f.bytes.length, 0) > 8 * 1024 * 1024) throw new ExecutionError('upload_too_large', 413);
    return transaction(this.pool, async db => {
      const row = (await db.query('SELECT state,sandbox,definition FROM sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, session])).rows[0];
      if (!row) throw new ExecutionError('session_not_found', 404);
      if(row.definition?.initialization&&files.some(file=>file.path==='SOUL.md'))throw new ExecutionError('reserved_initialization_path',400);
      if (row.state !== 'open') throw new ExecutionError('session_closed', 409);
      // Initial project inputs become immutable when the first Run is submitted.
      // Follow-up edits are Agent work, avoiding replacement of its live workspace.
      if ((await db.query('SELECT 1 FROM runs WHERE tenant_id=$1 AND session_id=$2 LIMIT 1', [tenant, session])).rowCount || row.sandbox) throw new ExecutionError('workspace_already_started', 409);
      const result = [];
      for (const file of decoded) {
        const sha = createHash('sha256').update(file.bytes).digest('hex');
        await db.query('INSERT INTO session_inputs(tenant_id,session_id,path,content,sha256,size) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,session_id,path) DO UPDATE SET content=EXCLUDED.content,sha256=EXCLUDED.sha256,size=EXCLUDED.size', [tenant, session, file.path, file.bytes, sha, file.bytes.length]);
        result.push({ path: file.path, sha256: sha, size: file.bytes.length });
      }
      return result;
    });
  }
  async list(tenant: string, session: string) {
    if (!(await this.pool.query('SELECT 1 FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, session])).rowCount) throw new ExecutionError('session_not_found', 404);
    return (await this.pool.query('SELECT path,sha256,size FROM session_inputs WHERE tenant_id=$1 AND session_id=$2 ORDER BY path', [tenant, session])).rows;
  }
  async readForProvisioning(tenant: string, session: string) {
    await this.list(tenant, session);
    return (await this.pool.query('SELECT path,content,sha256 FROM session_inputs WHERE tenant_id=$1 AND session_id=$2 ORDER BY path', [tenant, session])).rows as { path: string; content: Buffer; sha256: string }[];
  }
}
