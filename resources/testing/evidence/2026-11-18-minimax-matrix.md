# MiniMax cloud compatibility acceptance — 2026-11-18

Status: **84 / 84 executable combinations passed through both SDKs (168 independent cloud journeys / 336 completed Runs)**. Global cleanup is **not fully closed**: six early failed creation attempts remain unknown after explicit reconciliation. The machine-readable [matrix](2026-11-18-minimax-matrix.json) retains failed attempts and distinguishes unsupported and unverified catalog rows.

## Scope

The current catalog yields 84 executable Sandbox × Harness × model-protocol combinations, requiring 168 independent Python/TypeScript SDK journeys. Daytona is excluded. All model connections use MiniMax-M3: Anthropic at `https://api.minimaxi.com/anthropic`; OpenAI Chat Completions and Responses at `https://api.minimaxi.com/v1`. Those protocols are tested separately.

There are 66 built-in combinations: eleven cloud Sandbox providers × OpenCode/Pi × three protocols. Eighteen OCI combinations cover the five published, digest-pinned templates on Modal and Fly Machines. Codex uses Responses; Hermes uses Chat; OpenClaw and OpenCode cover all three protocols; Aider has an Anthropic conversation-only contract.

The remaining catalog rows are explicit boundaries: unsupported model protocol, provider without OCI capability, or recipe without a built image. A registered image or validated credential is not execution evidence. Arbitrary user code/images are not certified by a known template's result.

## Current observed results

Final snapshot: `2026-11-18T14:54:52.956Z`. All 66 built-in and 18 published OCI combinations passed; each has independent Python and TypeScript evidence and confirmed Session cleanup.

| Sandbox | Built-in combinations passed / 6 | OCI combinations passed / 9 |
|---|---:|---:|
| instabox | 6 / 6 | Not advertised |
| boat | 6 / 6 | Not advertised |
| fly-machines | 6 / 6 | 9 / 9 |
| freestyle | 6 / 6 | Not advertised |
| agent37 | 6 / 6 | Not advertised |
| vercel | 6 / 6 | Not advertised |
| upstash | 6 / 6 | Not advertised |
| sprites | 6 / 6 | Not advertised |
| blaxel | 6 / 6 | Not advertised |
| e2b | 6 / 6 | Not advertised |
| modal | 6 / 6 | 9 / 9 |

Catalog boundaries: **132 unsupported model-protocol rows**, **81 unsupported OCI/provider rows**, and **66 unverified build-required rows**. The last group contains recipe-only DeepSeek, Pi OCI, Claude Code and custom Python templates, not runnable published images; none is marked verified. These row counts are intersections of the catalog, not counts of separate products.

## What a pass means

Both installed SDK packages independently create Sessions and execute real cloud workloads. The tool-capable journey checks pinned initialization, upload/readback, idempotent Run submission, event-stream disconnect/replay, two-turn conversation, actual assigned DeepWiki MCP invocation, explicit environment injection, JSON artifact download/content, and confirmed cloud cleanup. OCI registration is performed through each SDK. Aider verifies two-turn restored-history conversation and cleanup; it is not credited with tools or artifacts.

These combination tests supplement the historical full Web/preview, approval and recovery journeys. They do not claim fresh execution of every historical scenario on every cell. Real-provider results are separate from deterministic tests. Single-client reruns remain partial until successful evidence exists for both clients. The Fly/Codex Python session used for a manual Runtime dependency probe is excluded. A separate fresh, unassisted Python Session subsequently passed and is the accepted evidence.

## Fixes found by real execution

- Freestyle's filesystem writes are root-owned with mode 0600, while its default command user can be uid 1000. Foreground/background execution now explicitly uses guest root.
- E2B's own SDK dispatcher now receives the operator's proxy configuration. OpenCode acceptance uses a verified 2 GiB template instead of assuming the default base template is sufficient.
- Lost immutable Runtime-file upload responses are reconciled against exact remote bytes before treating preparation as successful.
- Cancellation before any Harness invocation no longer requires an unreachable Runtime to become healthy first.
- MCP initialization/discovery failures are distinguished from an unknown outcome after `tools/call`. Only pre-dispatch reconnection is retried; a lost tool response is never blindly replayed.
- Fly supports BusyBox-compatible timeout flags and prepares Python/Bash/timeout before the first shell operation. OCI images without those dependencies no longer fail merely because preparation itself assumed Bash/Python were present.
- Image registry GET failures have a bounded retry and actionable API/Console error instead of leaking a generic internal error. Registry credentials remain origin-bound.

## Verification and evidence

- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify`: 90 test files / 285 tests passed at the latest complete regression checkpoint. Later acceptance-runner configuration changes are type-checked separately.
- Python runner compilation and TypeScript checks passed. Registry GET, MCP non-replay and Fly shell/timeout regressions have focused tests.
- A real completed MiniMax Session and its pinned initialization were inspected in English and Chinese Console. Private screenshots: `.local/minimax-matrix/console-en.png`, `console-zh.png`. This is not a claim of a new full GUI onboarding journey for every provider.
- Private per-attempt logs, Session/Run IDs and cleanup state: `.local/evidence/compatibility-*`, `.local/minimax-matrix/attempt2-*` and `.local/minimax-matrix/merged.json`.
- Independent retained-state audit confirmed all 168 accepted Sessions are closed and their 336 Runs completed. Journal: `.local/minimax-matrix/retained-audit.json`.
- Six early failed creation outcomes remain `unknown / needs_review`: Boat (2), E2B (2), Upstash (2). Explicit final reconciliation still cannot prove allocation or absence; no resource ID was returned. This is an unresolved operational limitation, not a cleanup pass. IDs and final observations are preserved in `.local/minimax-matrix/unresolved-resources.json` and `final-unknown-review.json`. Do not blindly recreate or acknowledge them as deleted.
- Exact accepted OCI image/provider/protocol evidence is reflected in the Harness catalog. Post-metadata checks: catalog + localization tests (7 passed), TypeScript type check passed.

Final operational check: no active Runs; all eight additional acceptance workers exited. The local service was restarted with the updated catalog, Console returned HTTP 200, the API and database were ready, and automatic credential ingress was reachable. The live catalog exposes 18 distinct new exact MiniMax OCI verification records. Private checks: `.local/minimax-matrix/final-operations.json` and `final-service.json`.

Reproduction: see [the runner guide](../compatibility-runner.md). The local connection-ID-only configuration is `.local/minimax-matrix/all-providers.json`; it contains no keys. `npm run verify:compatibility -- .local/minimax-matrix/all-providers.json` starts a fresh full matrix and new journals. No images were published and no git commits were made.
