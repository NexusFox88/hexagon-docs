# Harness serverless matrix and Console corrections

## Acceptance scope

User requested real pause/automatic-wake/file/conversation restoration for Codex, Hermes, OpenClaw and OpenCode across Sandbox providers through Python and TypeScript; dark-theme icon correction; parallel SDK and API levels in API Playground. Daytona is excluded. Previous Pi acceptance is not counted as proof for another Harness.

## Matrix definition

The machine-readable `2026-11-19-harness-serverless-matrix.json` distinguishes passed, failed, unverified and unsupported OCI-provider combinations. OpenCode builtin is executable on eleven providers. The four digest-pinned OCI Harnesses are executable on Modal and Fly Machines; other provider connectors currently do not support these OCI images. Unsupported cells are not passing tests and are not hidden by falling back to Pi or another Harness.

Each executable cell has independent Python and TypeScript journeys with MiniMax-M3. SDK protocol selection follows the Harness contract: Codex uses Responses, Hermes Chat Completions, OpenClaw/OpenCode Messages for TypeScript and Chat Completions for Python. Every journey creates a Session, writes a distinct file, waits for automatic idle, submits another message without explicit resume, checks file content and prior conversation content, and closes. A local independent inspection reads actual cloud file bytes and persisted native session identity before/after recovery; it does not trust the final answer alone. Provider credentials stay in the control plane and never appear in the evidence.

`npm run verify:serverless -- <provider> <opencode|oci-codex|oci-hermes|oci-openclaw|oci-opencode>` runs one pair. `npx tsx tooling/serverless-matrix.ts` regenerates the public status ledger from private attempt reports. Exact resource identities remain in `.local/serverless-harness-acceptance` for cleanup/reconciliation.

## Console changes

The old dark-theme image treatment selected a few class names and omitted `application-icon` catalog images. The new rule covers the shared brand asset namespace on every surface; monochrome marks adapt to dark foreground while raster/color artwork retains its palette on light backing. Interface SVGs continue to use currentColor.

A shared Playground output component makes SDK and REST API sibling tabs. Python/TypeScript remain SDK language choices. New and reused Session forms share this output component. Switching representations retains the same configuration and never submits requests. The component supplies tab/panel relationships, roving focus, arrows and Home/End; active output scrolls independently beneath its tabs.

## Recorded attempts

- The first E2B/OpenCode pair selected the existing base (1 GiB) template and both Runs were rejected by the real 2 GiB prerequisite check. Both Sessions closed. The failed report is preserved in `e2b-opencode-first-attempt.json`. The runner now selects the already-configured 2 GiB E2B template for non-Pi acceptance.

## Verification status

`TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify` passed 99 files / 311 tests after the UI changes (private log `.local/harness-ui-verify.log`). After the SQLite recovery fix, the same complete command passed 99 files / 314 tests (`.local/harness-serverless-final-verify.log`).

Actual browser review used Ego TaskSpace 49 (closed after review): dark Tool catalog (all 39 assets loaded and their palette treatment inspected), all 11 Sandbox catalog icons, nine Harness template icons, model catalog and table identities. Screenshots were visually inspected. New-session and reused-session Playground views were checked in English/Chinese and light/dark; switching SDK/API and SDK languages preserved the task draft, including across locale changes. Arrow/Home/End navigation and panel selection were exercised. At 390px, keyboard activation selected REST API with no document horizontal overflow; a pointer attempt under device emulation did not select the tab and is not counted as mobile pointer proof. No cloud request was sent during UI-only review. System appearance and zh-CN were restored.

Private screenshots: `.local/harness-ui-*.png`. The matrix ledger remains authoritative for execution results; final cleanup is recorded below after completion.

## Modal / OpenClaw recovery defect

Both SDKs initially completed the first turn but failed after Modal filesystem restore with `SQLite database file identity changed before existing-only open`. The original failed pair is preserved in private `modal-oci-openclaw-first-attempt.json`.

A separate real Modal probe created a SQLite database, snapshotted and restored it, then measured identity before opening, after an `O_RDWR` open without writes, and after SQLite access. Identity changed from `(dev=29, inode=1950)` to `(dev=18, inode=6)` on writable open and stayed stable for SQLite. The stored row was unchanged. Both compute instances and the snapshot were deleted (private `.local/modal-sqlite-probe.json`). This confirms image-layer copy-up, not a lost conversation or an authentication problem.

The managed OpenClaw runner now opens owned regular SQLite files in its private state directory for writing before starting the CLI, without writing or deleting content. It identifies SQLite by its header, skips symlinks and linked directories, and preserves database and WAL bytes. OpenClaw's admission/identity checks remain enabled. A deterministic regression test verifies database content, sidecar bytes, and exclusion of external symlink targets. Real rerun results are recorded in the matrix; the implementation alone is not treated as acceptance.

The copy-up-only attempt exposed a second defect: OpenClaw's native `exec` returned `Client credential migration is incomplete or stale` because its migration receipt retained the prior shared database identity. The Python Run was cancelled after diagnosing the repeated errors and its Session closed; the attempt is preserved in `modal-oci-openclaw-copyup-only-attempt.json`. The runner now invokes upstream `doctor --client-credentials --repair --non-interactive` before native continuations (and detected copy-up), with a bounded timeout and no credential-bearing output. This also handles device identity changes on cold boot. It does not edit upstream credential tables. A failed repair prevents the Agent invocation. Regression tests cover successful repair and failure propagation. OpenClaw acceptance additionally requires a successful persisted native `exec` event after waking, so a read-tool fallback cannot hide broken shell access.

## Final recorded results

All **19 executable provider/Harness pairs × 2 SDKs = 38 real cloud journeys** passed. Each journey contains two completed Runs with automatic idle/wake between them. The final ledger has **38 passed, 0 failed, 0 unverified, 72 unsupported OCI-provider cells**. The 72 cells are 9 providers × 4 OCI Harnesses × 2 SDKs; these connectors do not currently implement OCI image execution and are explicitly outside executable support, not inferred passes.

| Harness | Real Sandbox providers | Python | TypeScript |
| --- | --- | --- | --- |
| OpenCode builtin | E2B, Freestyle, Instabox, Boat, Agent37, Vercel, Upstash, Sprites, Blaxel, Modal, Fly Machines | 11/11 | 11/11 |
| Codex OCI | Modal, Fly Machines | 2/2 | 2/2 |
| Hermes OCI | Modal, Fly Machines | 2/2 | 2/2 |
| OpenClaw OCI | Modal, Fly Machines | 2/2 | 2/2 |
| OpenCode OCI | Modal, Fly Machines | 2/2 | 2/2 |

Independent database audit (`.local/serverless-harness-acceptance/history-audit.json`) checked all 38 final journeys: both Runs completed, native conversation identity unchanged, actual file bytes verified, conversation markers retained. All four OpenClaw journeys have successful persisted native `exec` events after wake. Modal's final pair passed with both copy-up preparation and upstream client-credential repair enabled.

Provider cleanup audit (`cleanup-audit.json`) covers **44 Sessions**, including six superseded attempt Sessions. All are closed, all allocated compute resources inspect as absent, checkpoint cleanup is recorded, and there are zero unknown resource operations. The separate Modal SQLite probe also deleted both compute instances and its snapshot. IDs remain in private evidence for reconciliation; they are not copied into public docs.

Final verification: full `npm run verify` with the local test database passed **99 files / 314 tests**. The final continuation-repair guard was additionally checked by all six managed CLI regression tests and `npm run check`. Temporary extra workers were gracefully stopped with zero active Runs. The temporary acceptance ingress was stopped; the local Console remains available (HTTP 200). No commits or publications were made.

Blaxel/Sprites results prove the provider-managed idle/next-task continuity path; their APIs do not provide independent confirmation of billable compute suspension. No zero-cost or memory-preservation guarantee is inferred from those results. Daytona remains excluded.
