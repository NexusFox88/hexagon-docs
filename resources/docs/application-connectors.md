# Personal application connectors

Implementation work in progress. Registration, deterministic tests and real-provider acceptance are reported separately.

## Contract

Reuse permissively licensed connector request mappings and official protocol SDKs. Activepieces community pieces are MIT (enterprise directories excluded); preserved source snapshots and license live in third_party/activepieces. Do not import its workflow runtime or enterprise modules. SDK dependencies remain pinned in package-lock.json.

Keep Connections as tenant-owned accounts rather than introduce a duplicate credential store. Named application providers have immutable built-in operation catalogs; user config selects enabled operations. Existing Session tool bindings grant an Agent access to an account. ToolBroker remains the sole authorization/approval/side-effect journal. Application API execution happens in the control plane; upstream credentials never go into guest tool definitions. Uncertain writes never replay automatically. No third-party sends during acceptance without explicit user authorization; use drafts and disposable task/document writes where authorized.

Linear GraphQL mutation responses containing `errors` are uncertain writes, including responses with partial `data` or `data: null`. A resolver failure does not establish that no mutation occurred. The broker retains the call as `unknown` for reconciliation and does not re-dispatch after reconstruction. Read and account-verification GraphQL errors remain ordinary rejected results. This conservative classification can require manual reconciliation even when the provider did not perform a write; it avoids claiming an unproven absence of effects. See [GraphQL response semantics](https://graphql.org/learn/response/) and [Linear API documentation](https://linear.app/developers/graphql).

OAuth credentials are encrypted envelopes separate from ordinary API-key secrets. Token refresh does not increment a connection policy version. Changing account/permissions does, and invalidates prior approvals. OAuth app configuration is deployment/tenant-owned; installed applications need a usable client registration before user authorization. The open-source runtime has no mandatory authorization SaaS.

OAuth transactions are persisted, expiring and one-use, bound to tenant, connection version, redirect URI and provider. Console opens official browser authorization and polls an authenticated transaction endpoint; callback reveals no token. Remote MCP restricts destinations to public HTTPS with DNS-pinned SSRF checks and persists discovered schema snapshots; see [Remote MCP](remote-mcp.md). New/disappeared/changed tools must require validation rather than silently broadening an existing Session.

GUI: application directory, account identity, capabilities, API-key onboarding or OAuth, deployment app configuration, connection diagnostics, reauthorization and SDK binding examples. All user-visible copy has en/zh-CN translations. Platform Sandbox settings remain separate. No chat UI, memory subsystem or LLM gateway.

## Acceptance

Contract tests: provider request mapping, selected operations, input schema, tenant boundaries, OAuth state replay/expiry/version changes, refresh concurrency, rejected refresh, unknown writes, approvals, secret redaction and MCP discovery/version changes. Browser: both languages, keyboard, OAuth cancellation/return, multi-account, credential input clearing and existing connection CRUD. Both SDKs: same public API setup and a cloud Agent invocation using actual third-party read/search tools where credentials are available. Provider accounts requiring interactive consent remain explicitly unverified until authorized.

## Initial providers

| Provider ID | Implemented actions | Authentication |
|---|---|---|
| `notion` | Search, page properties, direct blocks, comments; create page, append/update paragraph, add comment | Integration/PAT token or registered OAuth application |
| `todoist` | Projects, tasks, task lookup; create/update/complete task | API token or OAuth |
| `google-calendar` | Calendars, events, free/busy; create/update event | OAuth or externally managed access token |
| `exa` | Search and URL highlights | API key |
| `tavily` | Search and extraction | API key |
| `gmail` | Search/read messages; create draft/send message | OAuth or externally managed access token |
| `google-drive` | Search files, read Docs; create Doc, append text | OAuth or externally managed access token |
| `github` | Repositories, issues, file contents; create issue/comment | PAT or OAuth App (GitHub App installation auth is not implemented) |
| `slack` | Channels, history, threads; post message | Bot token or OAuth; conversation access depends on token type |
| `linear` | Teams, issues; create/update issue/comment | Personal key or OAuth |
| `deepl` | Translate text | API Free or Pro key |

Confirm exact provider IDs using `GET /v1/applications`. Each connection selects operation names, defaults to read-only, and stores an independent account credential. The control plane owns these API calls; no Sandbox-specific implementation is needed.

### Console journey

1. Open Agent → Tools → Add Tool, choose a provider and name the account.
2. Choose allowed operations. Writes are explicitly marked as requiring approval.
3. For API keys, enter the credential or choose an existing managed Secret. Save, verify and enable. DeepL requires matching Free/Pro endpoint selection. Exa verification performs a billable search.
4. For OAuth, select OAuth authentication. Register an OAuth application with the provider, allow the exact displayed callback URL, and save its client ID/secret in Console. Save the connection's permissions, then choose Authorize account and follow the provider link. Console polls the durable flow; cancellation and expiry can be retried. Successful callbacks verify and enable the account.
5. Copy the connection ID and bind it to an Agent tool name when creating a Session. Fleet retains existing authorization/approval waits and tool outcome reconciliation.

`http://127.0.0.1:8787/oauth/callback` works only for providers that accept a loopback HTTP redirect for the chosen application type. Providers requiring HTTPS need a deployment callback they accept; the credential-proxy tunnel is not a management/OAuth callback tunnel. No hosted OAuth broker or shared application registration is supplied.

Google services currently use separate connections/consent grants. Provider scopes are declared per application, and can exceed the Agent's selected operations; the broker's operation selection always remains enforced. No incremental scope negotiation, merged Google account, external revocation API or GitHub App installation flow is claimed in this implementation. Connection disabling/deletion stops local use but does not revoke a provider token outside Hexagon.

### Public API and SDK additions

- `GET /v1/applications`: app catalog and tenant-owned OAuth client metadata (no secrets).
- `PUT /v1/applications/:provider/oauth-client`: encrypted client configuration.
- `POST /v1/connections/:id/authorize`: start a 10-minute persisted authorization flow.
- `GET /v1/authorization-flows/:id`: poll authenticated status.
- `DELETE /v1/authorization-flows/:id`: cancel pending consent.
- `GET /oauth/callback`: provider redirect; one-use hashed state, connection version binding, no token in response.
- Existing connection CRUD and Session tool bindings remain the integration API. Python and TypeScript include matching application/authorization methods.

Run `npx tsx examples/applications/run.ts` or `python3 examples/applications/run.py` after creating `.local/applications/connections.json` as documented in the example README. Both execute in a cloud Sandbox and close it after use. Test commands and actual verification scope are recorded in `testing/evidence/2026-11-16-applications.md`.


## Breadth expansion: 28 providers / 139 operations

The user explicitly prioritized broad source-based migration over account authorization and live validation. This batch adds 17 providers and 91 operations. No third-party account credentials were read, no OAuth consent was requested, and no external application operation or cloud Sandbox acceptance was run for these additions. They are implemented connectors, not a claim of production/provider validation.

| Provider ID | Scope | Credential support |
|---|---|---|
| `outlook` | List/read mail, create draft, send mail | Delegated Microsoft OAuth or access token |
| `outlook-calendar` | Calendars, events, create/update event | Delegated Microsoft OAuth or access token |
| `onedrive` | Folder listing, item metadata, folder creation, rename | Delegated Microsoft OAuth or access token |
| `microsoft-todo` | Task lists, tasks, create/complete task | Delegated Microsoft OAuth or access token |
| `microsoft-teams` | Teams, channels, chats, chat history/send | Delegated Microsoft OAuth or access token |
| `google-sheets` | Discover spreadsheets, metadata, read/append/update values, create | Google OAuth or access token |
| `google-contacts` | List/read/create contacts, etag-protected name update | Google OAuth or access token |
| `google-tasks` | Lists, tasks, create/complete task | Google OAuth or access token |
| `asana` | Workspaces, projects, tasks, create/update task, comments | PAT or OAuth |
| `airtable` | Bases, schema, list/read/create/update records | Personal access token |
| `clickup` | Workspaces, spaces, folderless lists, tasks, comments | Personal access token |
| `trello` | Boards, lists, cards, create/update card, comments | API key + account token |
| `discord` | Guilds, channels, history, send/edit bot messages | Bot token |
| `telegram` | Bot profile, chat details, send/edit messages | Bot token |
| `dropbox` | Paginated folder listing/search, metadata, create folder, move | Access token or OAuth |
| `hubspot` | Contacts, contact search/create/update, deals | Private-app access token |
| `calendly` | Profile, event types/events/invitees, single-use links, cancellation | Personal access token |

### Shared integration behavior

The application registry is still the single source for Console and `GET /v1/applications`, available through both SDKs. New adapters use existing connection CRUD, encrypted credential storage, Session bindings, Harness tool definitions and ToolBroker approval/unknown-outcome handling. There are no app-specific Sandbox implementations.

Trello's GUI exposes separate API-key/token password fields. Both are stored as one encrypted credential envelope (SDK input: `credential: JSON.stringify({api_key, token})`; Python: `json.dumps`). Authentication uses Trello's documented Authorization header, and redaction covers both individual credential components. Telegram inserts its token into the official API path only immediately before control-plane transport; no bot token enters public metadata or execution-policy records. It does not take over webhooks or consume updates.

Graph pagination accepts `next_page_url` only on the exact HTTPS origin and resource path of the selected operation. Dropbox, Asana, Airtable, HubSpot, Calendly and Google operations expose native pagination cursors; they do not silently fetch an entire account. OneDrive/Dropbox file operations here are metadata operations, not binary download/upload adapters. Sheets defaults to RAW input to avoid unintended formula evaluation. Discord sends suppress mentions by default. Google Contacts name updates require the latest etag. All writes, including drafts, scheduling links and cancellation, require approval.

OAuth client registration remains tenant/provider scoped. Google and Microsoft application entries have separate grants; multi-service shared account consent and tenant-specific Microsoft authority configuration are not included. Microsoft Teams requires delegated user access and organization consent where applicable; it is not an app-only bot connection. Direct access tokens require manual renewal unless the account was connected using the built-in OAuth flow.

### Source migration

Nineteen exact source/auth snapshots and per-file SHA-256 fingerprints live in `third_party/activepieces/expansion/`, with MIT notices inherited from `third_party/activepieces/LICENSE`. Thirteen snapshots additionally match upstream Git blob hashes discovered through the GitHub directory API. Modified mappings use Hexagon's typed action contract instead of importing Activepieces' runtime/UI. Source request construction and API SDK calls were translated into bounded JSON requests; this is not a full upstream piece feature-for-feature port.

License review covered Activepieces community (MIT), LangChain (MIT), Trigger.dev (Apache-2.0), n8n (Sustainable Use License) and Pipedream (Source Available License). Only Activepieces community code was migrated in this batch; n8n/Pipedream implementation code was not copied. See `third_party/activepieces/expansion/provenance.json` for the exact imported files, original URLs and adaptation notes.

## Research/development expansion — 2026-11-18

This expansion brought the application catalog to 33 named applications plus generic HTTP JSON. Five additions use fixed official request mappings and existing broker authorization, operation selection, write approval and no-replay behavior:

| Application | Operations | Credential / boundary |
|---|---|---|
| Firecrawl | Scrape to Markdown, discover site URLs | Bearer API key; read actions consume provider credits |
| Brave Search | Paginated web search | Subscription token; verification performs one billable search |
| Apify | List Actors, start Actor, inspect Run, read paginated dataset | Bearer token; starting an Actor requires approval and is never automatically replayed |
| GitLab | Membership projects, project issues, create issue | PAT; GitLab.com only; project namespaces are encoded |
| Readwise Reader | Paginated documents, save URL | Readwise Token; saving is a write; verification accepts official 204 |

These additions are contract/browser-tested, not real-account verified. Self-hosted GitLab and IM channel hosting are not implied by these adapters. Remote MCP was added separately below. The upstream ecosystems include broader extension mechanisms: [MCP servers](https://github.com/modelcontextprotocol/servers), [OpenClaw](https://github.com/openclaw/openclaw), [QwenPaw](https://github.com/agentscope-ai/QwenPaw). Application count alone does not establish parity.

Mappings verified against primary references: [Firecrawl OpenAPI](https://github.com/firecrawl/firecrawl-docs/blob/main/api-reference/v2-openapi.json), [Brave API](https://api-dashboard.search.brave.com/api-reference/web/search/get), [Apify API](https://docs.apify.com/api/v2), [GitLab projects](https://docs.gitlab.com/api/projects/) and [issues](https://docs.gitlab.com/api/issues/), [Readwise Reader](https://readwise.io/reader_api). No upstream Agent runtime was copied into the control plane.

## Remote MCP and Feishu / Lark — 2026-11-18

The current catalog contains **35 named applications**, generic HTTP JSON, and [remote MCP](remote-mcp.md). Remote MCP discovers arbitrary server tool definitions rather than requiring another application-specific card.

Feishu (`feishu`) and international Lark (`lark`) use separate official API origins. Choose the application in Console, enter App ID and App Secret, select operations, save, verify and enable. Credentials are one encrypted JSON envelope: `{"app_id":"...","app_secret":"..."}`. Python passes `credential=json.dumps(...)`; TypeScript passes `credential:JSON.stringify(...)` to ordinary connection creation. Bind its connection ID in a Session's `tools` map, just as for other applications.

Supported operations: list chats, read chat messages, send a plain-text group message, read a document's raw text, list Bitable records, create a Bitable record. Read/list operations expose bounded pagination. Writes require approval and never automatically replay an unknown outcome. Verification lists one chat page; the self-built app must have bot functionality, be published, and have the requisite chat read scope. Bots need membership in target groups; documents/tables must be shared with the app, and their scopes granted separately. Verification does not claim every optional operation has access to every resource.

The control plane obtains a tenant access token before each operation. App Secret and resulting access token stay outside the Sandbox. Requesting a token per operation avoids an expiring token being manually copied into configuration; upstream may return its existing valid token. There is no shared cross-tenant token cache. This is self-built app authentication, not delegated user OAuth or incoming chat/webhook hosting. Permission denial, API business errors, redaction, write approval and uncertain outcomes have deterministic tests. No real Feishu/Lark account was exercised, per the user's generic-integration instruction.

Primary protocol references: [Feishu tenant token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal), [official Lark SDK](https://github.com/larksuite/node-sdk), [document raw content](https://open.larksuite.com/document/server-docs/docs/docs/docx-v1/document/raw_content). The implementation adapts these request contracts to Hexagon's existing broker; it does not import a second agent runtime.

## Reverse usage

`GET /v1/connections/{id}/usage?section=agents|sessions|calls&offset=0` returns `items`, `offset`, and `next_offset` (25 records per page). The connection is tenant-authorized before reading any bindings or execution records. `agents` describes current saved-Agent default bindings; `sessions` includes all pinned Tool assignments, including closed Sessions; `calls` returns persisted broker call metadata with Session/Run links, binding name, operation, state, error flag and time. It does not return arguments, results or credentials. The execution policy's recorded connection ID takes precedence; records without one use the Session's pinned binding. Configuration does not prove execution, and direct Sessions need not have a saved Agent. Console exposes these three views from each Tool's name or Usage action.

## CRM authorization completion — 2026-11-18

Current catalog: 37 named applications. HubSpot supports private access tokens and OAuth authorization-code/refresh through `/oauth/v3/token`. Attio supports workspace tokens and OAuth with `/v2/self` active-token/workspace/scope checks. Salesforce supports externally managed access tokens and OAuth with PKCE through an explicitly configured HTTPS My Domain (`*.my.salesforce.com`), including sandbox My Domains. Its configured instance and returned OAuth instance must match. Generic login domains, arbitrary hosts, paths, credentials, ports and redirects are not accepted as an instance. Salesforce API mappings pin REST v62.0; Contact/Account/Opportunity recent-list/read/create/update are supported, not arbitrary SOQL or exhaustive export. Attio supports paginated list/read/create/update of people/companies/deals records. These CRM connectors have contract/fixture evidence, **not real-account acceptance**.

Verification now distinguishes:

- `allowed_operations`: local Agent policy selected by the user.
- `scope` with `scope_source: provider`: only scopes actually reported by the provider/token grant. Absent introspection is `scope_source: unknown`, never inferred from selected operations.
- `permission_checks`: `verified`, `denied`, or `unknown`, with the basis (`scope`, `read_probe`, `object_metadata`, `not_tested`). Scope/metadata checks do not prove every record's sharing or field-level access. Salesforce describe checks object flags; HubSpot reads check selected read resources. No write is performed to verify permissions. Private-token HubSpot write permissions therefore remain unknown unless provider grant metadata establishes them.
- `permission_coverage`: partial results remain visibly partial. Known denied permission fails validation. OAuth callback and manual token verification share the same checks. Generic application adapters without introspection remain explicit partial coverage, not silently fully verified.

OAuth grants bind to the registered client ID. A replacement client requires reauthorization; client-secret rotation for the same client remains possible. Old grants without that binding require reauthorization. Refresh intent is committed before the remote request; concurrent callers await the same attempt, and response loss/process interruption never blindly reuses a possibly rotated refresh token. Refresh has no open database transaction across the network. A new credential/version/disconnect while refreshing prevents the old result from replacing it. `401` invalidates the connection and blocks further calls; manual Verify can refresh an invalid OAuth grant if a refresh token exists. Providers without a reported expiry cannot receive speculative scheduled refreshes. Unknown refresh outcomes require reauthorization.

New owner API / SDK methods:

| API | TypeScript | Python |
|---|---|---|
| `GET /v1/connections/:id/authorization` | `connectionAuthorization(id)` | `connection_authorization(id)` |
| `POST /v1/connections/:id/disconnect` | `disconnectConnection(id)` | `disconnect_connection(id)` |

Authorization metadata contains state, expiry and refresh availability, never token values. Disconnect disables the connection, increments its version, cancels pending consent flows and removes its stored credential envelopes. A referenced Managed Secret remains independently owned and is not deleted. This is **local disconnect**, not provider revocation; `provider_revoked: false` is explicit. It cannot retract requests already dispatched. Revocation at the provider remains an explicit action in its account console.

New Sessions pin the verified account identifier; Broker refuses a later account identity swap. Older snapshots or providers without stable identity cannot obtain that retroactive guarantee. Operation policy remains the intersection of pinned and current configuration. Approval version checks, tenant checks, Managed Secret disable/rotation and unknown-write reconciliation remain enforced. Original credentials stay in the control plane; Sandbox transport is unchanged.

Console exposes the two new CRM cards, Salesforce instance field, OAuth settings, per-operation verification evidence, token lifecycle and local-disconnect confirmation in English and Chinese. See [development plan](plans/2026-11-18-crm-authorization.md) and [actual evidence](../testing/evidence/2026-11-18-crm-authorization.md).
