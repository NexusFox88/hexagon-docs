# Remote MCP connections

Console → Tool connections → Add Tool → Remote MCP server. Enter a public HTTPS endpoint and select Streamable HTTP (recommended) or legacy SSE. Choose public/no authentication, Bearer token or an API-key header. Save and discover tools, select the tools allowed to the Agent, review per-tool approval, save, verify and enable. Tools default to requiring approval, including those claiming a read-only annotation. Credentials stay encrypted in the control plane.

The transport uses the official `@modelcontextprotocol/sdk` client, including initialization, paginated `tools/list`, and `tools/call`. It is not an HTTP-JSON facade requiring hand-written schemas. OAuth browser registration/refresh for arbitrary MCP servers, stdio servers, resources/prompts subscriptions, sampling and elicitation are not exposed in this version. A server requiring OAuth-only login needs an appropriate externally obtained Bearer token and manual token renewal.

## Python

```python
from hexagon import Hexagon
api = Hexagon.local()
connection = api.create_connection(
    kind='tool', provider='mcp-remote', name='Repository docs',
    config={'endpoint':'https://mcp.deepwiki.com/mcp', 'authentication':'none'})
connection = api.discover_mcp_tools(connection['id'])
# This example explicitly grants one read tool without per-call approval.
selected = {key: {**tool, 'approval':False}
            for key, tool in connection['config']['tools'].items()
            if tool['name'] == 'read_wiki_structure'}
if not selected:
    raise RuntimeError('Expected tool was not discovered')
api.update_connection(connection['id'], config={**connection['config'], 'tools':selected})
if api.validate_connection(connection['id'])['status'] != 'ready':
    raise RuntimeError('MCP verification failed')
api.update_connection(connection['id'], enabled=True)
session = api.create_session(
    sandbox_connection_id=SANDBOX_ID, model_connection_id=MODEL_ID,
    harness={'id':'pi','version':'1.5.2'}, tools={'wiki':connection['id']})
run = api.submit(session['id'],
    'Use wiki to read the documentation structure of modelcontextprotocol/typescript-sdk.',
    'first-wiki-request')
# Poll api.run(run['id']), inspect output.text, and close the Session when finished.
```

## TypeScript

```ts
const api = await Hexagon.local();
let connection = await api.createConnection({kind:'tool', provider:'mcp-remote',
  name:'Repository docs', config:{endpoint:'https://mcp.deepwiki.com/mcp', authentication:'none'}});
connection = await api.discoverMcpTools(connection.id);
const selected = Object.fromEntries(Object.entries(connection.config.tools)
  .filter(([, tool]: [string, any]) => tool.name === 'read_wiki_structure')
  .map(([key, tool]: [string, any]) => [key, {...tool, approval:false}]));
if (!Object.keys(selected).length) throw new Error('Expected tool was not discovered');
await api.updateConnection(connection.id, {config:{...connection.config, tools:selected}});
if ((await api.validateConnection(connection.id)).status !== 'ready') throw new Error('MCP verification failed');
await api.updateConnection(connection.id, {enabled:true});
const session = await api.createSession({sandbox_connection_id:SANDBOX_ID,
  model_connection_id:MODEL_ID, harness:{id:'opencode',version:'1.2.27'}, tools:{wiki:connection.id}});
const run = await api.submit(session.id,
  'Use wiki to read the documentation structure of modelcontextprotocol/typescript-sdk.',
  crypto.randomUUID());
// Poll api.run(run.id), inspect output.text, and close the Session when finished.
```

For authenticated servers, set `authentication:'bearer'` and provide `credential` from your environment, or reference an existing `secret_id`. Header authentication additionally sets `header_name`. Neither the original credential nor token is put into Sandbox env. The API returns discovered metadata only. Stable hashed operation IDs let MCP names containing punctuation pass safely through the Harness tool interface; the adapter retains the original remote name.

## Network and execution boundaries

Endpoint schemes, literal addresses and socket-time DNS answers are checked. Redirects and cross-origin SSE POST destinations are rejected; credentials are bound to the selected origin. In deployments with a trusted outbound proxy, the existing operator-controlled `HEXAGON_ACCESS_EGRESS_PROXY_URL` plus exact `HEXAGON_ACCESS_EGRESS_HOSTS` allowlist can delegate DNS enforcement to that proxy. Hosts outside the list use direct public-DNS enforcement. A system fake-IP DNS proxy is not treated as a public address by default.

Discovery has a 100-tool / 20-page bound and a 2 MiB response limit. Object input schemas must compile locally; unsupported schemas fail rather than widening argument validation. A tool's description, input schema and name are rechecked before invocation. Configuration changes cannot silently broaden an existing Session's grants. Re-discover and review changed tools, then create a new Session.

All remote invocations have replay policy `never`. Lost responses become unknown outcomes requiring reconciliation, not another automatic `tools/call`. Approval, credential invalidation, cancellation, tenant ownership, durable events and output inspection use the shared ToolBroker. Public DeepWiki Streamable HTTP was exercised via both SDKs and actual cloud Harnesses. Its legacy `/sse` endpoint returned 410 during acceptance; SSE compatibility is independently verified against a deterministic SSE protocol server.
