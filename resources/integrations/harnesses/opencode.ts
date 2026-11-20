import {initializationInput,type HarnessInitialization} from '../../modules/execution/initialization.js';
import { artifactDelivery } from './artifact-delivery.js';
import { readFile } from 'node:fs/promises';
import type { SandboxConnector } from '../../modules/sandboxes/connector.js';
import type { HarnessAdapter, HarnessDefinition, RuntimeTools } from '../../modules/execution/harness.js';

export const opencodeHarness: HarnessDefinition = {
  id: 'opencode', version: '1.2.27', capabilities: ['tools', 'conversation', 'initialization'], model_providers: ['anthropic-compatible', 'openai-compatible', 'openai-responses'],
};
// The npm JS launcher maps signal termination to exit 0. Execute the native
// postinstall artifact directly so the supervisor observes the real exit signal.
const binary = '/tmp/hexagon-harnesses/node_modules/opencode-ai/bin/.opencode';

export async function installOpenCode(connector: SandboxConnector, sandbox: string) {
  const resource = await connector.inspect(sandbox);
  if (!resource) throw new Error('sandbox_missing');
  if (resource.memory_mb !== undefined && resource.memory_mb < 2048) throw new Error('harness_requires_2048mb');
  const existing = await connector.execute(sandbox, `${binary} --version`, { timeout_seconds: 20 });
  if (existing.exit_code === 0 && existing.stdout.trim() === opencodeHarness.version) return;
  // Select the pinned native artifact for the sandbox's libc and CPU instead
  // of inheriting the provider's npm lifecycle policy.
  const installed = await connector.execute(sandbox, 'npm install --prefix /tmp/hexagon-harnesses opencode-ai@1.2.27 --ignore-scripts --no-audit --no-fund', { timeout_seconds: 180 });
  if (installed.exit_code !== 0) throw new Error('harness_install_failed');
  await connector.write(sandbox, '/tmp/hexagon-harnesses/install.cjs', await readFile(new URL('./install-opencode.cjs', import.meta.url)));
  const prepared = await connector.execute(sandbox, 'node /tmp/hexagon-harnesses/install.cjs', { timeout_seconds: 20 });
  if (prepared.exit_code !== 0) throw new Error('harness_native_install_failed');
  const version = await connector.execute(sandbox, `${binary} --version`, { timeout_seconds: 20 });
  if (version.stdout.trim() !== opencodeHarness.version) throw new Error('harness_version_mismatch');
}

export type { RuntimeTools } from '../../modules/execution/harness.js';

export function openCodeRequest(id: string, input: string, model: { base_url: string; model: string; credential: string; provider?: string }, nativeSession?: string, tools?: RuntimeTools, initialization?:HarnessInitialization) {
  input=initializationInput(input,nativeSession,initialization);
  const endpoint = model.base_url.replace(/\/+$/, '');
  const config = {
    $schema: 'https://opencode.ai/config.json',
    ...(initialization?.system?{agent:{build:{prompt:initialization.system}}}:{}),
    provider: { hexagon: { npm: model.provider==='openai-responses'?'@ai-sdk/openai':model.provider==='openai-compatible'?'@ai-sdk/openai-compatible':'@ai-sdk/anthropic', name: 'User model endpoint',
      options: { baseURL: endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`, apiKey: '{env:HEXAGON_MODEL_KEY}' },
      models: { [model.model]: { name: model.model, limit: { context: 196608, output: 8192 } } },
    } },
    ...(tools?.definitions.length ? { mcp: { hexagon: { type: 'local', command: ['python3', '/tmp/hexagon-runtime/tool_bridge.py'], enabled: true, timeout: 3600000, environment: { HEXAGON_RUN_ID: id, HEXAGON_TOOL_TOKEN: tools.token, HEXAGON_TOOLS: JSON.stringify(tools.definitions) } } } } : {}),
    model: `hexagon/${model.model}`, share: 'disabled', autoupdate: false,
    permission: { '*': 'allow', task: 'deny', external_directory: 'deny' },
  };
  return {
    ...(tools ? { tools } : {}),
    stdin: '\n',
    id, command: [binary, 'run', '--print-logs', '--log-level', 'INFO', '--format', 'json', ...(nativeSession ? ['--session', nativeSession] : []), `\n${input}\n\n${artifactDelivery(id)}`],
    env: { HEXAGON_MODEL_KEY: model.credential, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: 'true' },
  };
}

/** Decode official JSON events; transport/log noise is not an assistant response. */
export function decodeOpenCode(text: string): { type: string; text?: string; session_id?: string; message_id?: string } | null {
  try {
    const row = JSON.parse(text);
    if (typeof row.type !== 'string') return null;
    return { type: row.type, ...(row.type === 'text' && typeof row.part?.text === 'string' ? { text: row.part.text } : {}), ...(typeof row.sessionID === 'string' ? { session_id: row.sessionID } : {}), ...(typeof row.part?.messageID === 'string' ? { message_id: row.part.messageID } : {}) };
  } catch { return null; }
}

export function finalOpenCodeText(events: NonNullable<ReturnType<typeof decodeOpenCode>>[]) {
  const texts = events.filter(event => event.type === 'text' && event.text);
  const last = texts.at(-1);
  if (!last) return '';
  return last.message_id ? texts.filter(event => event.message_id === last.message_id).map(event => event.text).join('\n') : last.text!;
}

export const openCodeAdapter: HarnessAdapter = {
  definition: opencodeHarness,
  install: installOpenCode,
  invocation: openCodeRequest,
  result(stdout) {
    const events = stdout.split('\n').map(decodeOpenCode).filter(event => event !== null);
    return { text: finalOpenCodeText(events), native_session: events.find(event => event.session_id)?.session_id, failed: events.some(event => event.type === 'error') };
  },
};
