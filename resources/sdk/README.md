# Hexagon clients

Both clients use the same authenticated HTTP API. A Session created in either language can be queried and continued in the other. The server owns execution; disconnecting a client does not cancel a Run.

Create sessions directly after configuring Sandbox and model connections in Console. `tools` optionally maps binding names to authorized Tool connection IDs; `env` / `variables` provide ordinary Sandbox environment values. No Agent resource is required. In the default local deployment, Session creation and execution automatically prepare the credential channel; no network-settings step is required. Python uses a 90-second default request timeout to cover cold startup. For reusable versioned definitions, `agent_id` remains an alternative to `harness`; do not pass both.

## Local identity

Open the local Console to connect automatically. No owner-file copying, application-token creation or token environment variable is required. The browser receives a process-local session credential, never the owner token on disk. Only a same-origin page on an explicitly loopback-bound local server can bootstrap; hosted and network-bound deployments retain explicit authentication.

`Hexagon.local()` in Python and `await Hexagon.local()` in TypeScript discover a private descriptor in `HEXAGON_DATA_DIR`, the current project's `.local/control-plane`, or the user's `~/.hexagon/local.json` pointer. For multiple workspaces, use `data_directory=...` (Python) or `{dataDirectory: ...}` (TypeScript). The descriptor is written on service start, including custom ports; SDKs reject remote endpoints and credentials readable by other OS users. Local discovery reads credentials internally and does not create a remote account or new application token. `HEXAGON_LOCAL_DISCOVERY_FILE` selects an alternative discovery pointer.

For hosted or remote access, retain the explicit constructor: `Hexagon(base_url, token)` in Python or `new Hexagon(baseUrl, token)` in TypeScript. Local identity must never be used for a remote URL. Stop the local service to end its browser sessions; a restarted service creates a fresh browser credential and Console reconnects automatically.

## TypeScript

Build locally with `npm --prefix sdk/typescript run build`. Local `npm pack` automatically rebuilds the archive contents through `prepack`. Import from the built `sdk/typescript/dist/index.js`, or use the source with a TypeScript runner during development.

```ts
import { Hexagon } from './sdk/typescript/dist/index.js';

const client = await Hexagon.local();
const session = await client.createSession({
  harness: { id: 'pi', version: '1.5.2' },
  sandbox_connection_id: sandboxConnectionId,
  model_connection_id: modelConnectionId,
});
await client.upload(session.id, [
  { path: 'hello.py', content_base64: Buffer.from('print("hello")\n').toString('base64') },
]);
const run = await client.submit(session.id, 'Inspect hello.py and explain it.', 'request-001');
let cursor = '0';
for await (const event of client.stream(run.id, cursor)) {
  if (event.id) cursor = event.id;
  console.log(event.type, event.data);
}
console.log((await client.run(run.id)).output);
```

Persist `cursor` in your application if it needs reconnection. Call `stream(run.id, cursor)` again after a transport failure; do not submit a new task to reconnect. An AbortSignal can be passed to `stream`. Explicitly call `cancel(run.id)` to request cancellation.

## Python

Install locally with `python3 -m pip install -e sdk/python`, or set `PYTHONPATH=sdk/python` during development. The client uses Python's standard library and requires Python 3.10 or later.

```python
import os
from hexagon import Hexagon

client = Hexagon.local()
session = client.create_session(
    harness={'id': 'pi', 'version': '1.5.2'},
    sandbox_connection_id=sandbox_connection_id,
    model_connection_id=model_connection_id,
)
client.upload(session['id'], {'hello.py': b'print("hello")\n'})
run = client.submit(session['id'], 'Inspect hello.py and explain it.', 'request-001')
cursor = '0'
for event in client.stream(run['id'], cursor):
    cursor = event.get('id', cursor)
    print(event['type'], event['data'])
print(client.run(run['id'])['output'])
```

The clients also expose connection configuration/validation, Agent creation, paginated events, approval decisions, cancellation and Session close. No automatic replay of non-idempotent HTTP operations is performed. Reuse the original idempotency key and input when retrying a Run submission.

Both clients have passed real cloud Web tasks, Console credential authorization and preview checks on E2B. SDK protocol tests additionally verify interoperability; installed-package tests verify the distributed files. The remaining provider combinations are listed in the [execution matrix](../testing/execution-matrix.md); method availability alone is not proof of complete workflow acceptance.

## Downloading Run artifacts

Ask the agent to save deliverables in its Run artifact directory. The harness receives the exact directory (`artifacts/<run-id>/` within the workspace). The worker exports it after the harness exits and before the Run completes. Each Run has its own immutable export snapshot; later follow-ups cannot overwrite earlier downloads.

```ts
const { artifacts } = await client.artifacts(run.id);
for (const artifact of artifacts) {
  const bytes = await client.downloadArtifact(artifact.id); // Uint8Array
  // Use a caller-chosen destination rather than trusting a remote file path.
}
await client.close(session.id);
// artifacts() and downloadArtifact() remain available after close.
```

```python
artifacts = client.artifacts(run['id'])['artifacts']
for artifact in artifacts:
    data = client.download_artifact(artifact['id'])  # bytes
client.close(session['id'])
# Downloaded artifacts remain in control-plane storage after sandbox deletion.
```

Artifact metadata includes name, size, SHA-256, Session and Run IDs. Downloads require the same tenant authentication as Runs. Limits are currently 64 files, 4 MiB per file and 8 MiB per Run export; symbolic links and non-regular files are rejected. Exceeding export limits fails the Run visibly instead of silently dropping deliverables. Content is retained in PostgreSQL for the local MVP; sandbox cleanup does not delete it.

## Web previews

Start an HTTP service in the Session sandbox, then create a short-lived preview grant:

```ts
const preview = await client.createPreview(session.id, 3000, 600);
// Open preview.url in a browser. Its ticket is an access credential.
await client.revokePreview(preview.id);
```

```python
preview = client.create_preview(session['id'], port=3000, ttl_seconds=600)
# Open preview['url'] in a browser; do not publish the access ticket.
client.revoke_preview(preview['id'])
```

The default local preview listener is port 8788. Every grant has a distinct `<id>.localhost` origin, separate from Console; its entry ticket becomes a host-only HttpOnly cookie and is removed from the address bar. Provider traffic credentials stay on the server. Each request checks expiry, revocation and Session state. Closing the Session invalidates its grants. Supported app ports are 3000–8999 except Runtime management port 8765; lifetime is 30–3600 seconds.

Current preview support covers HTTP pages, assets and forms/API requests within that preview origin. WebSocket upgrades, upstream app cookies, arbitrary external redirects and external browser resources are not supported yet. These are explicit capability limits, not silently advertised as working. For hosted control planes, configure a dedicated preview domain with wildcard routing/TLS; do not colocate preview content with the Console origin.

## Register a custom Harness

TypeScript: `await client.registerHarness(package)`; Python: `client.register_harness(**package)`. Both call `POST /v1/harness-packages`. Registration is tenant-scoped and idempotent for identical content; a changed existing version is rejected. Use the returned id/version in the AgentDefinition. See [package format and runtime protocol](../docs/custom-harnesses.md).

## Uncertain Tool outcomes

Use `toolCalls(run)` / `tool_calls(run)` to inspect a remote operation whose outcome is unknown. After externally verifying it, use `resolveToolCall(run, call, resolution)` / `resolve_tool_call(run, call, **resolution)` to deliver the verified result to the original task without repeating the remote request. See [reconciliation protocol](../docs/tool-reconciliation.md) for request hashes, audit evidence, errors and limits.

When a Tool call is waiting for credentials, callers may refuse that invocation using `denyToolAuthorization(run, call, requestHash)` / `deny_tool_authorization(run, call, request_hash)`. Obtain its ID and request hash from `toolCalls` / `tool_calls`. The API is `POST /runs/:id/tool-calls/:call/deny-authorization` with `{ "request_hash": "..." }`. Console exposes the same operation in the waiting Run's Fleet details.

The original Harness receives an error result with code `tool_authorization_denied`; the Run can continue and explain the limitation. This does not cancel the Run, revoke a connection, or forbid a later distinct invocation. Retrying the same refusal returns its recorded result, including after Run termination, without restarting the Run. A mismatched hash, non-pending call, cancelled Run or in-flight broker operation is rejected. After an authentication failure, refusal prevents further requests; it does not undo an earlier request.

## Custom environment variables

Pass `env` to `createAgent` / `create_agent` for reusable defaults, and to `createSession` / `create_session` for per-Session overrides. Both use the same API fields on `POST /v1/agents` and `POST /v1/sessions`.

```ts
const agent = await client.createAgent({
  name: 'Research agent',
  harness: { id: 'pi', version: '1.5.2' },
  env: { APP_MODE: 'research', EXA_API_KEY: process.env.EXA_API_KEY! },
});
const session = await client.createSession({
  agent_id: agent.id,
  sandbox_connection_id: sandboxConnectionId,
  model_connection_id: modelConnectionId,
  env: { APP_MODE: 'evaluation' },
});
// session.env_names contains APP_MODE and EXA_API_KEY; values are not returned.
```

```python
agent = client.create_agent(
    name='Research agent',
    harness={'id': 'pi', 'version': '1.5.2'},
    env={'APP_MODE': 'research', 'EXA_API_KEY': os.environ['EXA_API_KEY']},
)
session = client.create_session(
    agent_id=agent['id'],
    sandbox_connection_id=sandbox_connection_id,
    model_connection_id=model_connection_id,
    env={'APP_MODE': 'evaluation'},
)
```

The merged map is frozen at Session creation and used for Harness installation, every Run in that Session, and child processes launched by the agent. It is independent of the Sandbox vendor. Model and Sandbox connections still use their dedicated configuration; their credentials are not automatically copied into this map. Provider image builds, VM boot services and unrelated processes are outside its scope. GUI env editing is not included in this API/SDK feature.

Values are encrypted in control-plane storage and omitted from create/get/list responses; `env_names` lists names only. No host environment is forwarded implicitly. Use string values, including empty strings; no shell expansion occurs. Maximum: 64 variables, 128-character identifier names, 16,384 string code units per value, 64 KiB UTF-8 JSON total. NUL is rejected. Platform prefixes `HEXAGON_`, `OPENCODE_`, `PI_` and names `PORT`, `NODE_OPTIONS`, `PYTHONPATH`, `PYTHONHOME`, `LD_PRELOAD`, `LD_LIBRARY_PATH` are reserved. An invalid map produces `invalid_request` before provisioning. To change the map, create a new Session. Injected secrets are readable by the agent; do not ask it to print them or export them as artifacts.
