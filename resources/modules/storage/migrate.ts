import {createHash} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { transaction } from './database.js';

export async function migrate(pool: pg.Pool) {
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(734829101)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const names = ['001-initial', '002-connection-lifecycle', '003-session-inputs', '004-runtime-bindings', '005-tool-calls', '006-artifact-content', '007-preview-grants', '008-harness-packages', '009-tool-resolution', '010-execution-environment', '011-managed-secrets', '012-application-oauth', '013-resource-review', '014-agent-revisions', '015-application-tokens', '016-direct-sessions', '017-harness-images', '018-oauth-refresh-attempts', '019-session-pause', '020-run-origin', '021-session-connection-revocations'];
    await db.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const appliedRows=(await db.query('SELECT name,checksum FROM schema_migrations')).rows;
    if(appliedRows.some(row=>!names.includes(row.name)))throw new Error('database_schema_newer_than_code');
    for (const name of names) {
      const sql=await readFile(new URL(`./${name}.sql`, import.meta.url), 'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const previous=appliedRows.find(row=>row.name===name);
      if(previous?.checksum&&previous.checksum!==checksum)throw new Error('database_migration_changed:'+name);
      if(previous&&!previous.checksum)await db.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1',[name,checksum]);
    const applied = await db.query('SELECT name FROM schema_migrations WHERE name=$1', [name]);
    if (!applied.rowCount) {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
    }
    }
  });
}
