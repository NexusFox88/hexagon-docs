import { Ajv } from 'ajv';
import { z } from 'zod';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';

const schemas = new Ajv({ strict: true, allErrors: true, addUsedSchema: false });
const inputSchema = z.record(z.unknown()).refine(value => {
  try { return value.type === 'object' && !value.$async && !!schemas.compile(value); } catch { return false; }
}, 'Expected a supported object JSON Schema');
export function validToolArguments(schema: Record<string, unknown>, args: Record<string, unknown>) {
  return schemas.compile(schema)(args);
}

const path = z.string().regex(/^\/(?!\/)[^?#\\]*$/).refine(value => !value.split('/').includes('..'));
export const httpToolConfig = z.object({
  base_url: z.string().url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }),
  verify_path: path.default('/auth/check'),
  operations: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.object({
    path, method: z.enum(['GET', 'POST']), description: z.string().min(1),
    input_schema: inputSchema.default({ type: 'object', properties: {}, additionalProperties: false }),
    approval: z.boolean().default(false),
    replay: z.enum(['never', 'idempotency_key']).default('never'),
  }).strict()),
}).strict();

export class ToolAuthenticationError extends Error {}
/** Optional display metadata, never a copy of the remote verification response. */
async function verificationIdentity(response: Response, credential: string): Promise<{ account?: string; scope?: string[] }> {
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) { await response.body?.cancel(); return {}; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 16384) { await reader.cancel(); return {}; }
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const safe = (text: unknown, max: number): text is string => typeof text === 'string' && text.trim().length > 0 && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) && !text.includes(credential);
    const account = safe(value.account, 200) ? value.account.trim() : undefined;
    const scope = Array.isArray(value.scope) && value.scope.length <= 50 && value.scope.every((item: unknown) => safe(item, 100)) ? [...new Set<string>(value.scope)] : undefined;
    return { ...(account === undefined ? {} : { account }), ...(scope === undefined ? {} : { scope }) };
  } catch { return {}; }
  finally { reader.releaseLock(); }
}
export async function httpToolRequest(config: z.infer<typeof httpToolConfig>, credential: string, operation: string, args: Record<string, unknown>, idempotency: string) {
  const op = config.operations[operation];
  if (!op) throw new Error('unknown_tool_operation');
  const url = new URL(`${config.base_url.replace(/\/+$/, '')}${op.path}`);
  if (op.method === 'GET') for (const [key, value] of Object.entries(args)) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  const response = await fetch(url, { method: op.method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', 'idempotency-key': idempotency }, body: op.method === 'POST' ? JSON.stringify(args) : undefined });
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new ToolAuthenticationError(); }
  if (!response.ok) { await response.body?.cancel(); throw new Error('tool_remote_request_failed'); }
  const body = await response.text();
  if (body.length > 1048576) throw new Error('tool_result_too_large');
  return JSON.parse(body);
}

export const httpToolConnection: ConnectionAdapter = {
  kind: 'tool', provider: 'http-json', config: httpToolConfig, capabilities: ['credential_registration', 'approval'],
  async validate(input, credential) {
    const config = httpToolConfig.parse(input);
    const response = await fetch(`${config.base_url.replace(/\/+$/, '')}${config.verify_path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${credential}` } });
    if (!response.ok) { await response.body?.cancel(); throw new ToolAuthenticationError(); }
    const identity = await verificationIdentity(response, credential);
    return { operations: ['authenticated_verification_endpoint'], ...identity };
  },
};
