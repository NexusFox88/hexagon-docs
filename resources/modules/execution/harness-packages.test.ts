import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HarnessPackages, harnessPackageInput, packageAdapter } from './harness-packages.js';
import { openDatabase } from '../storage/database.js';
import { HarnessRegistry } from './harness.js';

const pkg = { id: 'custom.example', version: '1', protocol: 'hexagon-json-v1', interpreter: 'python3', entrypoint: 'main.py', capabilities: ['conversation'], model_providers: ['anthropic-compatible'], files: [{ path: 'main.py', content: 'print("not a fabricated result")' }] };
describe('Custom package runtime boundary', () => {
  it('rejects escaping paths, absent entrypoints and conflicting files', () => {
    for (const path of ['../main.py', '/main.py', 'a/../main.py', 'a//main.py', 'x;touch /bad', 'a/./b']) {
      expect(harnessPackageInput.safeParse({ ...pkg, entrypoint: path, files: [{ path, content: '' }] }).success).toBe(false);
    }
    expect(harnessPackageInput.safeParse({ ...pkg, files: [{ path: 'other.py', content: '' }] }).success).toBe(false);
    expect(harnessPackageInput.safeParse({ ...pkg, files: [...pkg.files, { path: 'main.py/child', content: '' }] }).success).toBe(false);
  });
  it('verifies uploaded bytes and only accepts an explicit unique final result', async () => {
    const adapter = packageAdapter(harnessPackageInput.parse(pkg), 'a'.repeat(64));
    const connector: any = { execute: vi.fn().mockResolvedValue({ exit_code: 0 }), write: vi.fn(), read: vi.fn().mockResolvedValue(Buffer.from('corrupted')) };
    await expect(adapter.install(connector, 'sandbox')).rejects.toThrow('harness_package_integrity_failed');
    const invoke = adapter.invocation('run', 'task', { base_url: 'https://model.example', model: 'model', credential: 'secret' }, 'native');
    expect(invoke.stdin).not.toContain('secret');
    expect(invoke.env.HEXAGON_MODEL_KEY).toBe('secret');
    expect(JSON.parse(invoke.stdin!).native_session).toBe('native');
    expect(adapter.result('normal logs').failed).toBe(true);
    const final = JSON.stringify({ type: 'hexagon.result', text: 'actual answer', failed: false, native_session: 'native' });
    expect(adapter.result(final)).toMatchObject({ text: 'actual answer', failed: false, native_session: 'native' });
    expect(adapter.result(`${final}\n${final}`).failed).toBe(true);
    expect(adapter.result('{"type":"hexagon.result","text":"unchecked"}').failed).toBe(true);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('Durable tenant-owned Harness versions', () => {
  it('survives registry reconstruction, isolates tenants and rejects version replacement', async () => {
    const pool = openDatabase(process.env.TEST_DATABASE_URL!);
    const tenant = `package-${randomUUID()}`;
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$1)', [tenant]);
      const packages = new HarnessPackages(pool);
      const registered = await packages.register(tenant, pkg);
      expect((await packages.register(tenant, pkg)).digest).toBe(registered.digest);
      await expect(packages.register(tenant, { ...pkg, files: [{ path: 'main.py', content: 'different code' }] })).rejects.toMatchObject({ code: 'harness_version_conflict' });
      const registry = new HarnessRegistry([], new HarnessPackages(pool));
      expect((await registry.catalogForTenant(tenant))[0]).toMatchObject({ id: pkg.id, version: '1', digest: registered.digest });
      expect(await registry.catalogForTenant('other-tenant')).toEqual([]);
      await expect(registry.resolveForTenant('other-tenant', pkg)).rejects.toMatchObject({ code: 'unsupported_harness' });
      expect((await registry.resolveForTenant(tenant, pkg)).definition.id).toBe(pkg.id);
      await expect(registry.resolveForTenant(tenant, { ...pkg, version: '2' })).rejects.toMatchObject({ code: 'unsupported_harness' });
    } finally {
      await pool.query('DELETE FROM harness_packages WHERE tenant_id=$1', [tenant]);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant]);
      await pool.end();
    }
  });
});
