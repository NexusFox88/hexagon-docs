/** One executable compatibility contract; evidence is scoped separately from capabilities. */
export const protocolNames=['hexagon-json-v1','opencode-v1','pi-v1','aider-v1','claude-code-v1','deepseek-v1','codex-v1','hermes-v1','openclaw-v1'] as const;
export type HarnessProtocol=typeof protocolNames[number];
const allModels=['anthropic-compatible','openai-compatible','openai-responses'];
export const harnessProtocols=protocolNames.map(id=>({
 id,
 model_providers:['opencode-v1','pi-v1','openclaw-v1'].includes(id)?allModels:id==='codex-v1'?['openai-responses']:id==='hermes-v1'?['openai-compatible']:['anthropic-compatible'],
 tools:id!=='aider-v1',
 continuation:id==='hexagon-json-v1'?'custom-contract':id==='aider-v1'?'restored-history':'native',
 process_owner:'sandbox-runtime',
}));
export function protocolContract(id:HarnessProtocol){return harnessProtocols.find(p=>p.id===id)!;}
