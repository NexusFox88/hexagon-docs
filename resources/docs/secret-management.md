# Secret management and connection access

Implementation contract (2026-11-15): Variables are readable execution configuration; managed Secrets are write-only encrypted credential resources. Connections reference Secrets and own endpoint/authentication/access policy. Session bindings grant use, never raw-value access. Existing model keys must no longer enter Harness invocations. Provider-account credentials and ToolBroker remain control-plane-only.

## Scope

Provide tenant-scoped Secret CRUD/rotation/disable, reference-aware deletion, Connection references, HTTP bearer/header authentication, Session access bindings and preflight, GUI and both SDKs. Do not implement model routing, message conversion, billing, cache or automatic retries. Do not silently downgrade to plaintext env or widen request permissions.

## Execution

An access resolver selects a backend that enforces the complete policy. Native providers may only be selected after matching protocol, host/path/method restrictions, lifecycle and revocation semantics. A generic HTTPS reverse-proxy backend is the compatibility baseline: dedicated ingress, opaque per-Session grants, authentication on every request, fixed trusted upstream, no caller-selected destinations, no redirects, limited headers, streamed bytes without model interpretation. Reuse Node/Undici HTTP/TLS/stream implementations; no custom TLS interception. Local control planes require a separately authenticated HTTPS tunnel to the dedicated access port, not the administration API. Proxy tokens are bounded delegated authority, not upstream secrets.

Secrets are encrypted using existing AES-GCM envelopes. Managed resources refer to those envelopes; Connections use scoped encrypted copies for compatibility with existing adapters. Rotation atomically replaces all references' copies, invalidates verification and disables dependent Connections. Disable/deletion and Connection version checks revoke new proxy requests; requests admitted before the change may finish, and upstream actions cannot be retracted. Sessions pin policy and versions. Legacy invocations with raw model keys cannot resume under the new contract; fresh Sessions are required.

HTTP policies use exact paths and methods initially. Upstream endpoints must be public HTTPS origins without userinfo, query or fragment. Authentication is set by the trusted backend and is never accepted from caller headers. Proxy responses are from trusted upstreams: arbitrary transformed secret reflection is outside the guarantee. Do not log headers, bodies, tokens, plaintext or upstream error messages.

## Native reuse and correctness

E2B, Vercel, Daytona, Modal, Upstash, Blaxel, Freestyle, Sprites and Boat expose different external credential mechanisms (see vendor research in the conversation). Existence does not establish equivalent policy or tested SDK support. Provider-native implementations need durable create/update/delete reconciliation and must not copy keys into guest env. Unsupported combinations must report why and select the external backend only if configured. Fly Machines env secrets and Agent37 ordinary env are not protected backends.

## Validation

Tests must cover cross-tenant references, no API echo, encrypted storage, rotation and disable, deletion dependencies, Session closure, path/method escape, redirects, auth stripping, binary/SSE response streaming, legacy recovery rejection, Python/TS inputs, and GUI controls. Real cloud acceptance must make authenticated upstream calls and check that marker secrets are absent from guest env/files/arguments; distinguish native and external backend evidence. Existing model/provider journeys are not evidence of secret isolation. Day­tona remains deferred.

## Implemented backends

All registered Sandbox connectors use the external credential proxy baseline without requiring vendor Secret APIs. Vercel additionally implements `configureCredentialAccess`: its native network policy injects **delegated proxy grants**, not original upstream credentials. The worker persists this policy in its encrypted invocation record before applying it, strips all native policy metadata from Runtime delivery, and reapplies the same policy after an uncertain response. The guest receives a placeholder. The central proxy still checks current Run/Session/Connection state on every request, so retained native rules cannot authorize requests after Run completion, cancellation, expiry or rotation.

Preflight reports `external_proxy` or `external_proxy_with_native_auth`, and whether a delegated token enters the guest. This is a hybrid backend, not a claim that every provider's native Secret API has been implemented. E2B/Modal/Upstash/Blaxel/Freestyle/Sprites/Boat/Fly Machines/Agent37/Instabox currently use the baseline. Daytona is a future candidate outside the supported catalog. Native direct-to-upstream backends, automatic OAuth refresh, signed requests and non-HTTP protocols are not implemented. No unsupported mode silently falls back to raw env injection.

## HTTP API and SDK workflow

All management endpoints require the tenant's API token. Responses use `Cache-Control: no-store`. Secret values are write-only, including the creation and rotation response.

1. `POST /v1/secrets {name,value}` creates an encrypted, enabled resource. `GET /v1/secrets` and `GET /v1/secrets/:id` return metadata and references only.
2. Create a Connection with `secret_id` and provider-specific config. The reference must belong to the same tenant. The legacy inline `credential` field remains accepted for compatibility; it cannot be combined with `secret_id`.
3. Validate and explicitly enable the Connection. Generic HTTP validation checks configuration and header safety only; it does not execute a potentially mutating API call and does not claim remote authentication was tested. Model/provider adapters retain their existing bounded verification calls.
4. `POST /v1/sessions/preflight` accepts the same definition as Session creation, allocates no Session/Sandbox, and checks compatibility, references and configured credential ingress. It does not prove live network connectivity. A network allowlist must explicitly include the credential proxy hostname.
5. Create a Session with `variables` for ordinary guest-readable values and `connections: {name: connection_id}` for protected HTTP services. Existing model and Sandbox Connection fields remain unchanged. `env` is a compatibility alias for variables; combining a nonempty `env` with `variables` is rejected.
6. Submit a Run normally. The worker injects protected HTTP descriptors into `HEXAGON_CONNECTIONS` as JSON `{name: {base_url,headers}}`. Harness model configuration receives the proxy URL and a delegated token or native placeholder. Original upstream keys never enter new Harness invocations.
7. `PATCH /v1/secrets/:id {value}` rotates a Secret. Changing `value` or `enabled` disables dependent Connections, clears validation and increments their versions in the same transaction. Old grants fail on their next request. Revalidate, enable and create a fresh Session; existing Sessions keep their pinned policy/version.
8. `DELETE /v1/secrets/:id` is rejected while any undeleted Connection refers to it. Deletion tombstones the resource; encrypted historical envelopes remain for operational history and are not a physical cryptographic erasure guarantee.

For an SDK client that needs explicit access outside a Run, `POST /v1/sessions/:id/access {connection_id}` returns a one-time-visible delegated token and base URL, only for a bound model/HTTP Connection. `GET /v1/sessions/:id/access` returns token-free grant metadata; `DELETE /v1/access/:id` revokes a grant. Run-created grants are also limited to that active Run. Grants expire within the lesser of the configured Session timeout and one hour. Closing a Session rejects all its subsequent requests. Requests already admitted by the proxy may finish; upstream actions cannot be retracted.

TypeScript example (no original values in Session configuration):

```ts
const secret = await hexagon.createSecret({name: 'Search API', value: process.env.SEARCH_KEY!});
const connection = await hexagon.createConnection({
  kind: 'http', provider: 'http', name: 'Search', secret_id: secret.id,
  config: {
    endpoint: 'https://api.example.com', authentication: {type: 'bearer'},
    access: {rules: [{methods: ['POST'], path: '/search'}]},
  },
});
await hexagon.validateConnection(connection.id);
await hexagon.updateConnection(connection.id, {enabled: true});
const definition = {
  agent_id: agent.id, sandbox_connection_id: sandbox.id, model_connection_id: model.id,
  variables: {APP_MODE: 'production'}, connections: {search: connection.id},
};
await hexagon.preflightSession(definition);
const session = await hexagon.createSession(definition);
const run = await hexagon.submit(session.id, 'Search and summarize', crypto.randomUUID());
```

Python exposes the equivalent `create_secret`, `list_secrets`, `secret`, `update_secret`, `delete_secret`, `preflight_session`, `create_access`, `list_access` and `revoke_access` methods. Connection/Agent/Session creation uses keyword arguments as before. In guest Python code:

```python
binding = json.loads(os.environ['HEXAGON_CONNECTIONS'])['search']
request = urllib.request.Request(
    binding['base_url'] + '/search',
    data=json.dumps({'query': '...'}).encode(),
    headers={**binding['headers'], 'Content-Type': 'application/json'}, method='POST',
)
```

## Deployment and upgrade

The control-plane process listens on `127.0.0.1:8789` for credential traffic (`HEXAGON_ACCESS_PORT` overrides the port; `HEXAGON_ACCESS_HOST` explicitly changes the bind address). `HEXAGON_ACCESS_URL` must be the externally reachable HTTPS origin for **this dedicated listener**; the management API/Console is not its upstream. Production should supply a stable HTTPS reverse proxy. The smoke harness uses user-authorized temporary Cloudflare tunnels and closes them after each test. Temporary ingress is not production availability, and does not remain running after acceptance.

Direct egress rejects non-public DNS results at connection time and never follows redirects. Environments with synthetic/fake DNS may configure `HEXAGON_ACCESS_EGRESS_PROXY_URL` to a trusted HTTP(S) CONNECT proxy, together with mandatory `HEXAGON_ACCESS_EGRESS_HOSTS` (comma-separated exact upstream hostnames, no wildcard). In this explicit mode the trusted proxy resolves destinations; only administrator-approved hostnames can be contacted. Do not select arbitrary/untrusted egress proxies. No automatic acceptance of private upstream endpoints is enabled.

Close existing Sessions before upgrading. Sessions/invocations created before the protected-credential boundary cannot resume with the new worker; old guest files are not retroactively scrubbed. Keep the local encryption key and database together in backups; this feature does not rotate the master encryption key.


For an explicitly opted-in local development session, install `cloudflared` on PATH and start with `HEXAGON_ACCESS_TUNNEL=cloudflare npm run dev`. This opens only the dedicated credential listener, automatically sets the temporary HTTPS origin before starting execution, and terminates the tunnel on graceful shutdown. It carries delegated tokens and API request/response content through Cloudflare. Do not set this option unless you accept that data path; it is off by default. The local acceptance authorization does not leave this mode enabled on the user's persistent service. Synthetic-DNS environments must also set the trusted egress proxy and exact host list described above. Hosted deployments should supply a stable `HEXAGON_ACCESS_URL` instead.

## Session configuration in Console and SDKs

API Playground separates **Environment variables** from **Protected API access**.
Ordinary `env` values are passed to the Agent process, persisted encrypted by the
control plane and restored with that Session. Add key/value rows or paste literal
`KEY=value` lines (no shell evaluation). Names reserved by the runtime are rejected.
Generated Python, TypeScript and REST creation requests carry the same authored
values. Treat downloaded programs as configuration files: ordinary env is not a
place for passwords or API keys.

Create or rotate reusable Secrets under Infrastructure → Credentials and secrets.
Existing connection-managed credentials remain managed by their connection editor;
users do not need to duplicate them. Bind a managed Secret to a model, Tool or
protected HTTP Connection, then select that Connection when creating a Session.
Protected HTTP access is restricted to its configured endpoint, methods and paths.
The Sandbox receives delegated access, not the original upstream credential.
The credential proxy remains necessary for protected outbound requests; a missing
public ingress is a readiness failure, not a reason to inject the original key.

Session → Initialization keeps the immutable, redacted initialization snapshot
separate from **Current authorization**. Current authorization shows referenced
connection versions, managed Secret links and revoked/unavailable states. The
owner may explicitly reveal ordinary environment values. Full initialization JSON
continues to redact them and never exports raw Secret values. Reusing a Session in
Playground can explicitly load its ordinary env values; exported reuse programs
continue to obtain those values from the caller's environment.

Owner-only management endpoints and matching SDK methods:

| REST | TypeScript | Python |
| --- | --- | --- |
| `GET /v1/sessions/:id/environment` | `sessionEnvironment(id)` | `session_environment(id)` |
| `GET /v1/sessions/:id/authorization` | `sessionAuthorization(id)` | `session_authorization(id)` |
| `DELETE /v1/sessions/:id/connections/:connection` | `revokeSessionConnection(id, connection)` | `revoke_session_connection(id, connection)` |

These routes validate tenant ownership. Environment responses are `no-store`.
Application-scoped API tokens cannot invoke these management routes.

Per-Session revocation supports Tool and protected HTTP Connections. It does not
alter the original definition or another Session's binding. A durable revocation
blocks old delegated tokens, new grant issuance and future Tool dispatch, including
after pause/resume or control-plane restart. New Runs omit revoked capabilities.
Already dispatched upstream work cannot be recalled. Reauthorize by creating a new
Session; this release does not restore a revoked binding in place.

Secret details show linked connections and the newest 200 Session assignments,
including closed Sessions and per-Session revocation. Assignment does not prove a
call occurred. Tool invocation records remain in their existing audit path; HTTP
proxy requests associated with a Run record `protected_api.response` transport
status and connection/version metadata. These records omit credentials, request
bodies and response bodies. Manually issued grants without a Run do not produce
Run events. This is not a complete organization-wide credential activity report.

Rotating/disabling a managed Secret invalidates dependent connections and requires
verification and enablement again. Existing model/HTTP Sessions retain their pinned
connection version and must be recreated after a version change. Tools keep their
existing account/schema authorization rules; this feature does not promise
transparent credential rotation across all connection types.
