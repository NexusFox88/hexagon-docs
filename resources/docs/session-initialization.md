# Inspect a Session's initialization

Open Sessions → a Session → **Initialization** (初始化配置). The page shows the effective configuration pinned when the Session was created, including source Agent/revision, Harness and optional OCI reference/digest, Sandbox/model connection versions and configuration, tool/protected-API bindings, resource/network settings and environment variable names. Connection JSON can be expanded; the complete initialization JSON is available in the side panel. Copy JSON copies the same snapshot returned by the API.

Conversation and diagnostics show current execution/resource state. An initialization snapshot remains readable after Session close and is not replaced by the latest Agent or connection settings. Existing sessions use their already-persisted definition; historical protected-API binding names are read from the tenant-scoped immutable session binding table. Old sessions that did not capture connection display names show provider/ID; the API does not fabricate historical names from current configuration.

## Python

```python
from hexagon import Hexagon
api = Hexagon.local()
snapshot = api.session_initialization(session_id)
print(snapshot['definition']['harness'])
print(snapshot['definition']['connections'])
print(snapshot['definition']['tool_bindings'])
print(snapshot['environment']['names'])
```

## TypeScript

```ts
import { Hexagon, type SessionInitialization } from '@hexagon/agent-sdk';
const api = await Hexagon.local();
const snapshot: SessionInitialization = await api.sessionInitialization(sessionId);
console.log(snapshot.definition.harness);
console.log(snapshot.definition.connections);
console.log(snapshot.definition.tool_bindings);
console.log(snapshot.environment.names);
```

Both call `GET /v1/sessions/{id}/initialization`. The versioned response is:

```json
{
  "schema_version": 1,
  "session_id": "…",
  "created_at": "…",
  "source": {"kind": "agent", "agent_id": "…", "agent_revision": 2},
  "definition": {
    "harness": {"id": "pi", "version": "1.5.2"},
    "connections": [],
    "tool_bindings": {},
    "protected_api_bindings": {},
    "resources": {"timeout_seconds": 600},
    "network": {"mode": "unrestricted", "allowed_hosts": []}
  },
  "environment": {"names": ["APP_MODE"], "values_redacted": true}
}
```

`definition` contains the existing complete Session definition, not just the abbreviated fields in this example. Direct Sessions have `source.kind='direct'` and null Agent fields. Ordinary `session()` queries continue to expose the definition and current status for compatibility. `agent()` returns a saved Agent's current definition and revisions; that current definition must not be used as a substitute for a historical Session snapshot.

The endpoint enforces tenant ownership and is read-only. Owner and application tokens can inspect their tenant's Sessions. Responses are `no-store`. It does not read or decrypt secrets and does not return environment values or credential values. It does not export a ready-to-replay creation request: connection IDs remain workspace references, and missing secret/environment values must be supplied separately when creating new work.

## Create a new Session from the snapshot

Initialization now provides **Create with Python / TypeScript** and **Reuse in API Playground**. Generated code uses the pinned Harness ID/version and the original Sandbox/model connection IDs, tool aliases, protected API aliases, optional tools, resource/network settings and required capabilities. It calls preflight followed by Session creation and prints the new ID; it does not submit a Run or resume the original Session. Local code uses `Hexagon.local()` with the current data directory and requires no manually copied token.

Playground imports those creation parameters into an editable draft. Sandbox, model and Harness have selectors; the creation JSON exposes the remaining parameters. Editing it updates the SDK preview. Add a task and explicitly send to create a new Session and its first Run. Merely opening the draft does not create resources. Source Session/Agent IDs and resolved runtime metadata are excluded. Unavailable dependencies are shown rather than silently substituted; server preflight validates the complete request before creation.

Only environment variable names are carried over. Supply fresh values in the Playground fields, or set them in the SDK process environment. Generated snippets never embed those values. Remove unwanted names from `env` in the creation JSON. Drafts are held in page memory and are lost on reload; URLs contain only the source ID and a draft nonce.

The historical initialization remains immutable. Reused connection IDs resolve their **current** configuration and permissions when creating the new Session; this is not an exact replay of historical provider configuration. Credentials continue to stay in the control plane.

## Behavioral definition (P0 implementation, 2026-11-19)

`identity`, `instructions`, and `context` are optional on both Agent creation and direct Session creation. `name` remains a display label. Identity is a behavioral description, never an authenticated account or permission grant.

```python
session = api.create_session(
    harness={"id": "pi", "version": "1.5.2"},
    sandbox_connection_id=sandbox_id, model_connection_id=model_id,
    identity={"name": "Atlas", "role": "Research assistant"},
    instructions="Cite evidence. Distinguish facts from assumptions.",
    context={"text": "The customer's project is ORBIT."},
)
run = api.submit(session["id"], "Summarize the project", "message-001",
                 origin={"channel": "application", "message_id": "message-001"})
```

```typescript
const session = await api.createSession({
  harness: {id: "pi", version: "1.5.2"},
  sandbox_connection_id: sandboxId, model_connection_id: modelId,
  identity: {name: "Atlas", role: "Research assistant"},
  instructions: "Cite evidence. Distinguish facts from assumptions.",
  context: {text: "The customer's project is ORBIT."},
});
const run = await api.submit(session.id, "Summarize the project", "message-001",
  {channel: "application", message_id: "message-001"});
```

Limits: identity name 200 characters; role 2,000; description 4,000; instructions/background text 32,768 each. Context supports up to eight inline `{name,text}` documents (16,384 characters each), and up to eight `{path,sha256}` references to immutable Session input files. Referenced files must be uploaded to that Session before submission, UTF-8 text, at most 32 KiB each, with the matching SHA-256. No URL fetch or cross-Session file reference is implied. Compiled initialization is capped at 64 KiB; background plus task input is capped at 120,000 UTF-8 bytes for CLI transport. Invalid/missing/changed references are rejected before task execution.

Use `agent_id` and optional `agent_revision` to select a saved version. Mixing a saved Agent with inline behavior overrides is rejected. To adjust an existing definition, reuse the initialization snapshot as a new direct Session definition or create a new Agent revision. Existing Sessions remain pinned.

### Harness mapping

| Harness | Stable instructions | Background | Support boundary |
| --- | --- | --- | --- |
| Pi | Native append-system-prompt option | Initial user input | Adapter implemented; cloud evidence tracked separately |
| OpenCode | Native build-agent prompt configuration | Initial user input | Adapter implemented; cloud evidence tracked separately |
| Codex | Native developer_instructions configuration | Initial user input | OCI adapter implemented; cloud evidence tracked separately |
| Hermes | Native agent.system_prompt | Initial user input | OCI adapter implemented; cloud evidence tracked separately |
| OpenClaw | Workspace SOUL.md | Initial user input | Platform maintains this persona file when initialization is configured |
| Claude Code | Native append-system-prompt option | Initial user input | Adapter implemented; unregistered images are not cloud-verified |
| Custom JSON protocol | `initialization` object on invocation | Adapter must consume it | Must explicitly declare `initialization`; declaration alone is not validation |
| Aider / DeepSeek | Not yet mapped | Not enabled | Explicitly rejects behavior initialization; ordinary conversation support is separate |

Background remains user-level reference material. Native session continuation does not prepend it again. Instructions are supplied on each invocation through the Harness's own instruction mechanism. `agent.initialized` records the definition digest, Harness, input-file hashes, and whether context was delivered as initial input or through native history. This receipt proves adapter application, not model compliance; inspect execution evidence as well.

### Messages, identity, and result semantics

- The only current message body is text. Workspace input files are initialization assets, not multimodal messages. Active steering is unsupported.
- Busy Sessions return `session_busy` (409); callers retry after the active Run reaches a terminal state. There is no hidden message queue. Paused Sessions wake automatically when a Run is accepted.
- Pause scope is explicit: SDK `pause()` defaults to logical `session` suspension; use Python `pause(session_id, "sandbox")` or TypeScript `pause(sessionId, "sandbox")` to release/checkpoint compute. Console uses Sandbox scope when the connection supports `pause_resume`, and otherwise labels logical Session pause separately. Physical recovery preserves the definition and workspace/native history using the provider's supported mechanism; it does not promise process-memory restoration on every provider.
- Idempotency is scoped to tenant and Session. Retry the same input and origin with the same key; changed input/origin returns `idempotency_conflict`. `origin.message_id` is correlation metadata; use it as the idempotency key if deduplication by external message is desired.
- `origin` accepts only `message_id`, `request_id`, and `channel`. These are caller assertions. `execution_identity` comes from authenticated control-plane bindings and cannot be set in the submitted body or prompt.
- Client disconnection does not cancel execution. Query Run state or resume events after the last persisted event ID. Cancel explicitly; an uncertain external write is reconciled rather than retried.
- Tool account descriptions and pinned scopes are visible in initialization. Current authorization is checked again at dispatch. A pinned definition does not retain revoked credentials or account permissions.
- Results retain the existing Run contract: state, output text, error code, events and separate artifact metadata/download APIs. Sandbox closure releases compute; it does not erase stored Run output or artifacts. No new structured-output guarantee is implied.

See [P0 audit and current evidence](../testing/evidence/2026-11-19-headless-p0.md) for executed checks, failures and unverified combinations.

### Failure and delivery diagnostics

`model.response` is a durable control-plane receipt of the upstream HTTP status (or `transport: "failed"` before a response). It contains no prompt, response body, headers or credential. If a Harness fails, its last model receipt distinguishes `model_authentication_failed` (401/403), `model_rate_limited` (429), `model_request_failed` (other HTTP errors), and `model_transport_failed`. A successful Harness result is not turned into failure by an earlier recoverable model error. An error embedded inside a successful HTTP 200 stream is not classified from HTTP status; it remains a Harness failure unless the adapter has reliable evidence.

Explicit cancellation ends in `cancelled`; resource expiry emits `run.cancelling` / `run.cancelled` with `reason: "sandbox_expired"`. Runtime interruption uses `runtime_interrupted`. Unknown provider outcomes remain `execution_reconciliation_required` until reconciled; clients must not resubmit an uncertain external write to force progress. Authorization waits remain `waiting_authorization` or `waiting_approval`, with their persisted actions and tool-call results; waiting is not an empty successful result.

Event IDs are durable cursor positions. Consumers resume after their last processed ID and deduplicate by ID; SSE delivery itself is not an exactly-once transport. The terminal Run query is the source of final state. Artifact metadata and downloads remain tenant-scoped after Sandbox close, subject to the deployment's separate data retention/deletion policy; closing compute does not itself delete them.

Runtime daemon startup recovery is distinct from replaying a task. If startup has no reliable outcome and no invocation has been issued for the new Run, the worker first checks health, then inspects the launcher's advisory lock. A free lock permits another lock-protected daemon start; a held/unknown lock remains pending. Existing Harness invocations are never blindly rerun by this path. This supports restoring a filesystem checkpoint whose original processes no longer exist.

Lifecycle requests can have an unconfirmed remote outcome (for example, a deletion transport error). A lost or failed close response is not evidence that compute is still present or was never deleted. Read Session/resource-operation state until closure is confirmed; preserve unresolved operation IDs for reconciliation. Client timeout/disconnect does not roll back the persisted close intent. Do not blindly create replacement resources to bypass an uncertain outcome.

### A file-backed background

Compute the digest before creating the Session, then upload the exact bytes before submitting its first Run. Here `configuration` contains the Harness and Sandbox/model connection IDs from the earlier example.

```python
import hashlib
brief = "Project ORBIT: use the attached customer brief.".encode("utf-8")
session = api.create_session(
    **configuration,
    context={"files": [{"path": "brief.txt", "sha256": hashlib.sha256(brief).hexdigest()}]},
)
api.upload(session["id"], {"brief.txt": brief})  # Python accepts a path -> bytes mapping
run = api.submit(session["id"], "Summarize the project", "brief-001")
```

```typescript
import { createHash } from "node:crypto";
const brief = Buffer.from("Project ORBIT: use the attached customer brief.", "utf8");
const session = await api.createSession({
  ...configuration,
  context: {files: [{path: "brief.txt", sha256: createHash("sha256").update(brief).digest("hex")}]},
});
await api.upload(session.id, [{path: "brief.txt", content_base64: brief.toString("base64")}]);
const run = await api.submit(session.id, "Summarize the project", "brief-001");
```

The encoding conveniences differ, but both SDKs use the same upload API and hash-verified initialization contract. Raw uploaded files without a `context.files` reference are workspace assets; they are not automatically added to model context.
