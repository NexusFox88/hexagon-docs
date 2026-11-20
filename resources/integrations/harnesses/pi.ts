import {initializationInput} from '../../modules/execution/initialization.js';
import { artifactDelivery } from './artifact-delivery.js';
import { readFile } from 'node:fs/promises';
import type { HarnessAdapter } from '../../modules/execution/harness.js';

const root = '/tmp/hexagon-pi';
const node = `${root}/node_modules/node/bin/node`;
const cli = `${root}/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`;
const extension = `${root}/hexagon-extension.mjs`;

export const piAdapter: HarnessAdapter = {
  definition: { id: 'pi', version: '1.5.2', capabilities: ['tools', 'conversation', 'initialization'], model_providers: ['anthropic-compatible', 'openai-compatible', 'openai-responses'] },
  async install(connector, sandbox) {
    const version = await connector.execute(sandbox, `${node} ${cli} --version`, { timeout_seconds: 20 });
    if (version.exit_code !== 0 || version.stdout.trim() !== '1.5.2') {
      // Prefer a compatible native Node supplied by the sandbox. npm's node
      // package is glibc-specific and its install script may be disabled on Alpine.
      const host = await connector.execute(sandbox, `node -p 'Number(process.versions.node.split(".")[0]) >= 22'`, { timeout_seconds: 20 });
      const useHost = host.exit_code === 0 && host.stdout.trim() === 'true';
      const installed = await connector.execute(sandbox, `npm install --prefix ${root} ${useHost ? '' : 'node@22.19.0 '}@earendil-works/pi-coding-agent@1.5.2 --no-audit --no-fund`, { timeout_seconds: 240 });
      if (installed.exit_code !== 0) throw new Error('harness_install_failed');
      if (useHost) {
        await connector.write(sandbox, `${root}/select-node.cjs`, Buffer.from(`const fs=require('node:fs');
if(Number(process.versions.node.split('.')[0])<22) throw new Error('node_version_unsupported');
fs.mkdirSync('${root}/node_modules/node/bin',{recursive:true});
fs.rmSync('${node}',{force:true});
fs.symlinkSync(process.execPath,'${node}');
`));
        const selected = await connector.execute(sandbox, `node ${root}/select-node.cjs`, { timeout_seconds: 20 });
        if (selected.exit_code !== 0) throw new Error('harness_node_selection_failed');
      }
      const check = await connector.execute(sandbox, `${node} ${cli} --version`, { timeout_seconds: 20 });
      if (check.exit_code !== 0 || check.stdout.trim() !== '1.5.2') throw new Error('harness_version_mismatch');
    }
    await connector.write(sandbox, extension, await readFile(new URL('./pi-extension.mjs', import.meta.url)));
  },
  invocation(id, input, model, nativeSession, tools, initialization) {
    input=initializationInput(input,nativeSession,initialization);
    if (nativeSession && !/^[a-zA-Z0-9._-]+$/.test(nativeSession)) throw new Error('invalid_native_session');
    return {
      id, ...(tools ? { tools } : {}),
      command: [node, cli, '--mode', 'json', '--provider', 'hexagon', '--model', model.model,
        '--session-id', nativeSession || id, '--session-dir', `${root}/sessions`,
        '--no-extensions', '--extension', extension, '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
        ...(initialization?.system?['--append-system-prompt',initialization.system]:[]),
        `${input}\n\n${artifactDelivery(id)}`],
      env: { PI_CODING_AGENT_DIR: `${root}/config`, HEXAGON_MODEL_KEY: model.credential,
        // Runtime redacts individual environment values from output. Keep public
        // metadata together so the native session id is not treated as a secret.
        HEXAGON_MODEL_CONFIG: JSON.stringify({ base_url: ['openai-compatible','openai-responses'].includes(model.provider??'')?model.base_url.replace(/\/+$/, '').replace(/\/v1$/, '')+'/v1':model.base_url.replace(/\/+$/, '').replace(/\/v1$/, ''), provider:model.provider, model: model.model, run_id: id }),
        HEXAGON_TOOL_TOKEN: tools?.token || '', HEXAGON_TOOLS: JSON.stringify(tools?.definitions || []) },
    };
  },
  result(stdout) {
    let native_session: string | undefined;
    let final: any;
    for (const line of stdout.split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'session' && typeof event.id === 'string') native_session = event.id;
      if (event.type === 'message_end' && event.message?.role === 'assistant') final = event.message;
    }
    const text = Array.isArray(final?.content) ? final.content.filter((part: any) => part.type === 'text' && typeof part.text === 'string').map((part: any) => part.text).join('\n') : '';
    return { native_session, text, failed: !final || !['stop', 'end_turn'].includes(final.stopReason) };
  },
};
