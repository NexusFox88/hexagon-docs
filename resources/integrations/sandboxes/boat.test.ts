import { afterEach, expect, it, vi } from 'vitest';
import { BoatConnector } from './boat.js';
const id = 'bx_23456789', operation = `bdop_${'a'.repeat(32)}`;
afterEach(() => vi.unstubAllGlobals());
const json = (value: object, status = 200) => new Response(JSON.stringify({ ok: true, ...value }), { status });
it('resumes a persisted deletion operation without resending DELETE or trusting early disappearance', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ operation: { targetId: id, status: 'completed' } })).mockResolvedValueOnce(json({}, 404));
  vi.stubGlobal('fetch', fetch);
  await new BoatConnector({}, 'secret').reconcileDeletion(id, { provider_operation_id: operation, record: async () => { throw Error('unexpected'); } });
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`https://boat.dev/api/v1/deletion-operations/${operation}`, `https://boat.dev/api/v1/sandboxes/${id}`]);
});
it('records the deletion handle before polling and preserves a blocked purge as an error', async () => {
  const sequence: string[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
    sequence.push(url.includes('deletion-operations') ? 'poll' : 'delete');
    return url.includes('deletion-operations') ? json({ operation: { targetId: id, status: 'blocked' } }) : json({ operation: { id: operation } }, 202);
  }));
  await expect(new BoatConnector({}, 'secret').reconcileDeletion(id, { record: async value => { expect(value).toBe(operation); sequence.push('persist'); } })).rejects.toThrow('boat_deletion_blocked');
  expect(sequence).toEqual(['delete', 'persist', 'poll']);
});
it('does not infer purge completion from a missing resource without a deletion handle', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 404)));
  await expect(new BoatConnector({}, 'secret').reconcileDeletion(id, { record: async () => {} })).rejects.toThrow('boat_http_404');
});
it('rejects unsupported egress policy before provisioning', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(new BoatConnector({}, 'secret').create({ operation_id: 'op', session_id: 'session', timeout_seconds: 60, network: { mode: 'allowlist', allowed_hosts: [] } })).rejects.toThrow('boat_network_allowlist_unsupported');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the provider token out of the preview URL and account credential out of guest headers', async () => {
  const fetch = vi.fn().mockResolvedValue(json({ url: 'https://example-8765.on.boat.dev?_token=port-only' })); vi.stubGlobal('fetch', fetch);
  const target = await new BoatConnector({}, 'account-secret').preview(id, 8765);
  expect(target).toEqual({ url: 'https://example-8765.on.boat.dev', headers: { Cookie: '_port_auth=port-only' } });
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ port: 8765, public: false });
});
it('rejects truncated command results rather than reporting complete output', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ exitCode: 0, stdout: 'partial', stderr: '', stdoutTruncated: true })));
  await expect(new BoatConnector({}, 'secret').execute(id, 'cat file')).rejects.toThrow('boat_command_output_truncated');
});
