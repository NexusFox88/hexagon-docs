import {transaction} from '../storage/database.js';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { HarnessAdapter, HarnessDefinition } from './harness.js';
import { ExecutionError } from './runs.js';

const path = z.string().max(240).regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/).refine(p => p.split('/').every(part => part && part !== '.' && part !== '..'));
export const harnessPackageInput = z.object({
  id: z.string().regex(/^custom\.[a-z0-9][a-z0-9.-]{0,79}$/), version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
  capabilities: z.array(z.enum(['conversation', 'tools','initialization'])).max(3).default([]),
  model_providers: z.array(z.literal('anthropic-compatible')).length(1),
  protocol: z.literal('hexagon-json-v1'), interpreter: z.enum(['python3', 'node']), entrypoint: path,
  files: z.array(z.object({ path, content: z.string().max(262144) }).strict()).min(1).max(32),
}).strict().superRefine((pkg, ctx) => {
  if (new Set(pkg.files.map(f => f.path)).size !== pkg.files.length) ctx.addIssue({ code: 'custom', message: 'Duplicate package path' });
  if (!pkg.files.some(f => f.path === pkg.entrypoint)) ctx.addIssue({ code: 'custom', message: 'Entrypoint missing' });
  if (pkg.files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0) > 524288) ctx.addIssue({ code: 'custom', message: 'Package exceeds 512 KiB' });
  for (const file of pkg.files) if (pkg.files.some(other => other.path.startsWith(`${file.path}/`))) ctx.addIssue({ code: 'custom', message: 'File/directory path conflict' });
});
type Package = z.infer<typeof harnessPackageInput>;
function canonical(pkg: Package) { return JSON.stringify({ ...pkg, capabilities: [...new Set(pkg.capabilities)].sort(), files: [...pkg.files].sort((a, b) => a.path.localeCompare(b.path)) }); }
function definition(pkg: Package): HarnessDefinition { return { id: pkg.id, version: pkg.version, capabilities: pkg.capabilities, model_providers: pkg.model_providers }; }

/** Packages are inert data in the control plane; executable code runs only in the Sandbox. */
export class HarnessPackages {
  constructor(private pool: pg.Pool) {}
  async register(tenant: string, input: unknown) {
    const pkg = harnessPackageInput.parse(input);
    const serialized = canonical(pkg);
    const digest = createHash('sha256').update(serialized).digest('hex');
    return transaction(this.pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenant,pkg.id,pkg.version])]);
    if((await db.query('SELECT 1 FROM harness_images WHERE tenant_id=$1 AND id=$2 AND version=$3',[tenant,pkg.id,pkg.version])).rowCount)throw new ExecutionError('harness_version_conflict',409);
    await db.query('INSERT INTO harness_packages(tenant_id,id,version,digest,package) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [tenant, pkg.id, pkg.version, digest, serialized]);
    const row = (await db.query('SELECT digest,created_at FROM harness_packages WHERE tenant_id=$1 AND id=$2 AND version=$3', [tenant, pkg.id, pkg.version])).rows[0];
    if (row.digest !== digest) throw new ExecutionError('harness_version_conflict', 409);
    return { ...definition(pkg), digest, created_at: row.created_at };
    });
  }
  async catalog(tenant: string) {
    return (await this.pool.query('SELECT package,digest FROM harness_packages WHERE tenant_id=$1 ORDER BY id,version', [tenant])).rows.map(row => ({ ...definition(row.package), digest: row.digest }));
  }
  async resolve(tenant: string, reference: { id: string; version: string }): Promise<HarnessAdapter> {
    const row = (await this.pool.query('SELECT package,digest FROM harness_packages WHERE tenant_id=$1 AND id=$2 AND version=$3', [tenant, reference.id, reference.version])).rows[0];
    if (!row) throw new ExecutionError('unsupported_harness', 400);
    return packageAdapter(harnessPackageInput.parse(row.package), row.digest);
  }
}

export function packageAdapter(pkg: Package, digest: string): HarnessAdapter {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_package_digest');
  const root = `/tmp/hexagon-packages/${digest}`;
  return {
    definition: definition(pkg),
    async install(connector, sandbox) {
      // Hash-derived roots and validated paths cannot inject shell syntax.
      const dirs = new Set([root, ...pkg.files.filter(f => f.path.includes('/')).map(f => `${root}/${f.path.slice(0, f.path.lastIndexOf('/'))}`)]);
      const made = await connector.execute(sandbox, `mkdir -p ${[...dirs].join(' ')}`);
      if (made.exit_code !== 0) throw new Error('harness_install_failed');
      for (const file of pkg.files) {
        const bytes = Buffer.from(file.content);
        await connector.write(sandbox, `${root}/${file.path}`, bytes);
        const actual = await connector.read(sandbox, `${root}/${file.path}`);
        if (!bytes.equals(Buffer.from(actual))) throw new Error('harness_package_integrity_failed');
      }
      const check = await connector.execute(sandbox, `${pkg.interpreter} --version`);
      if (check.exit_code !== 0) throw new Error('harness_interpreter_unavailable');
    },
    invocation(id, input, model, nativeSession, tools, initialization) {
      return { id, command: [pkg.interpreter, `${root}/${pkg.entrypoint}`], ...(tools ? { tools } : {}),
        stdin: JSON.stringify({ protocol: pkg.protocol, run_id: id, input, initialization, model: { base_url: model.base_url, model: model.model }, native_session: nativeSession,
          artifact_directory: `artifacts/${id}`, tools: tools?.definitions || [] }),
        env: { HEXAGON_MODEL_KEY: model.credential, HEXAGON_TOOL_TOKEN: tools?.token || '' } };
    },
    result(stdout) {
      let final: { text: string; native_session?: string; failed: boolean } | undefined;
      for (const line of stdout.split('\n')) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'hexagon.result') {
          if (final) return { text: '', failed: true };
          const parsed = z.object({ type: z.literal('hexagon.result'), text: z.string().min(1), native_session: z.string().min(1).max(512).optional(), failed: z.boolean() }).strict().safeParse(event);
          if (!parsed.success) return { text: '', failed: true };
          final = parsed.data;
        }
      }
      return final || { text: '', failed: true };
    },
  };
}
