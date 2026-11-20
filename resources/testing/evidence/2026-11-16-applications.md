# Application connectors — 2026-11-16

## Delivered implementation

11 named application adapters: Notion, Todoist, Google Calendar, Exa, Tavily, Gmail, Google Drive/Docs, GitHub, Slack, Linear, DeepL. Built-in operation schemas and per-connection operation selection feed the existing Session/Harness ToolBroker path. All write operations require approval; uncertain writes remain unresolved rather than replaying. Platform Sandbox configuration remains separate.

API-key connections support managed Secrets. OAuth uses oauth4webapi 3.8.8 for standards-based exchanges and PKCE where supported; Notion's JSON token exchange is an explicit provider adapter. OAuth state is hashed, persisted, single-use, tenant/connection-version bound and expires after 10 minutes. Token values are encrypted in the existing SecretStore. Refresh is serialized and does not change policy version; reauthorization does. GUI includes app/provider selection, operation checkboxes, API-key/OAuth choice, OAuth application registration, authorization link/status/cancel and account verification. English and Simplified Chinese are complete for the added copy.

Activepieces community Todoist create-task, Tavily search and DeepL translation request mappings were adapted. Exact source snapshots, MIT license, upstream URLs and SHA-256 digests are in `third_party/activepieces/`. The other provider wrappers are original API mappings; they are not claimed as migrated upstream implementations. No Activepieces workflow runtime or enterprise code was imported.

## Verified

- `npm run check`: passed.
- Full isolated-PostgreSQL regression: **53 files, 150 tests passed**.
- Subsequent OAuth lock-order, provider scope formatting and localization changes: focused OAuth, connector and localization checks **3 files, 9 tests passed**.
- New tests cover provider selection/schema defaults, write approvals, unavailable operations, request mappings, credential redaction, 401/rejected/unknown outcomes, broker deduplication and uncertain-write suppression; durable OAuth tenant scope, cancellation, replay rejection, denied consent and concurrent refresh.
- `tooling/verify-sdk-packages.ts`: TypeScript tarball and Python wheel built, installed in isolated consumers; SDK interoperability and authorization-denial tests passed. Artifact hashes retained in `.local/evidence/sdk-packages.json`.
- `tooling/check-applications.ts`: official Exa verification + search, Tavily verification + search, DeepL verification + translation all passed using existing authorized credentials.
- Ego browser: Exa created with search-only operation, verified and enabled through Console. English/Chinese application forms inspected. OAuth selector keyboard navigation, disabled raw credential entry in OAuth mode and language-switch preservation of unsaved name, OAuth mode, client ID and write selection verified. Test draft cancelled without saving. Product uses custom selectors/dialogs and styled checkboxes.

## Actual cloud SDK journeys

Both runs used Instabox cloud Sandbox, the existing SiliconFlow-backed model connection, the registered custom Python Harness, and the three real application connections. Both Agents called Exa search, Tavily search and DeepL translate_text through the ToolBroker, then returned nonempty conversation text through their respective SDK. DeepL returned `Hello, world.`.

| SDK | Session | Run | Outcome |
|---|---|---|---|
| TypeScript | `5a9f1dd1-f06c-46e3-aee9-821b558a40ab` | `ac7138dc-8ea9-47da-b25a-f63467b2a2f6` | 3 successful tool calls; completed; closed |
| Python | `ba56de31-397e-47fa-a2de-11c3c8c03ae5` | `4a75f31d-5c34-4d47-b2a5-db992c08ecff` | 3 successful tool calls; completed; closed |

`tooling/audit-application-journeys.ts` independently checked persisted results (no `isError`), Session closure, raw application-key absence from tool results and event logs, and both provider resources absent via Instabox inspect. Resource IDs remain in private `.local/evidence/application-journey-audit.json` for audit/recovery. No actual email, Slack message, issue or document write was performed. The three verified application connections remain enabled for user testing.

## Explicit limits

Notion/Todoist/Google/GitHub/Slack/Linear real-account OAuth and individual write operations have **not** been live-verified; usable app registrations and account consent are required. Mock OAuth tests are not real provider consent tests. Named app support does not imply full upstream API coverage.

Generic remote MCP, Microsoft 365, Feishu, merged Google identity/grants, incremental least-privilege scope negotiation, provider-side revocation and GitHub App installation authentication remain follow-up scope. GitHub currently accepts PAT/OAuth App. Disabling a connection blocks Hexagon use but does not revoke external credentials at the provider. Existing open-source Harnesses reuse the common tool-definition path; these new app cloud journeys used the custom Harness, not a fresh exhaustive Harness × Sandbox matrix. Daytona remains deferred.
