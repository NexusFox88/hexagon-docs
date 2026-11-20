# Minimal Session journey — 2026-11-17

User contract: connect a Sandbox and model, verify them, create sessions via API with execution parameters, optionally authorize Tools and bind them to additional sessions, observe each session's execution. No mandatory Agent registration.

## Delivered behavior

- Three primary destinations: Sessions (default), Runtime connections, Tool connections. Settings is secondary. No four-step journey tab or mandatory Agent-management page.
- Empty workspace points directly to Sandbox/model setup. Tool authorization remains separate and optional.
- Python/TypeScript downloadable examples create Sessions directly with harness, Sandbox/model connection IDs, optional Tool bindings and env. Their install/token/run instructions, private journals, resume/new-turn/close modes remain explicit.
- Direct Session snapshots have null agent_id/revision; they reuse tenant ownership, connection locking, capability/network validation and credential isolation. Legacy saved-Agent requests remain supported. Migration 016 makes the references nullable without deleting existing data.
- Session list shows latest task/state. Detail shows turns, tool activity, input/output, observable execution milestones, authorization/approval handling, continuation and cleanup. Raw logs and resource diagnostics remain expandable. Progress is observable activity, not a claim to expose private model reasoning.

## Deterministic verification

- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify`: **62 files / 184 tests passed**, 23:50:08 local, 28.39 seconds.
- Direct public-API regression verifies no Agent creation, preflight, pinned definition, optional binding, conflicting request rejection, session-name search and latest-run state. Generated program tests execute both languages with direct session definitions and lost-submission recovery.
- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify:packages`: actual TypeScript tarball/Python wheel built and installed; **2 packaged interoperability/authorization tests passed**.
- After final presentation refinements, `npx vitest run testing/console-i18n.test.ts testing/console-session-code.test.ts`: **2 files / 6 tests passed**; `npm run check` passed.
- Initial verification exposed one obsolete navigation assertion (`sandboxes` as primary nav); updated to the new runtime entry. An initial package-verification invocation correctly refused to run without TEST_DATABASE_URL; rerun above passed. These are not cloud-provider failures.

## Browser review

Ego task space 35. Reviewed Chinese and English runtime/API generation screens, actual downloaded programs, optional Exa selection, keyboard language selection and draft retention, Session result and tool status in both languages. Reviewed a separate actual empty tenant and 390px Chinese layout (no horizontal overflow). Fixed invisible checkbox selected state, preserved deep links on locale switch, localized default Session display and execution milestones. Screenshots retained in local private evidence.

## Real cloud execution (not simulations)

Existing verified Vercel and SiliconFlow international connections; Pi 1.5.2; separate temporary application token. This round reused connection credentials rather than claiming fresh provider authorization coverage.

1. Python program downloaded from Console, no tools: Session `e1ad5a3a-8984-4fe4-a596-b29652377e85`; Run `8fe5fa4b-ab1d-4e41-bab3-e10f07c870db`; completed with `MINIMAL_PYTHON_OK`.
2. TypeScript program downloaded from Console, Exa selected on initialization: Session `805b1450-a16c-4376-a381-4cb13f1652db`; Run `52f55a26-a47f-488f-af1f-0ff108443785`; actual `tool_1.search` completed, final output `MINIMAL_TYPESCRIPT_OK` and `https://vercel.com/docs/sandbox`.
3. Both Sessions have null agent_id/agent_revision. Agent count remained 9 before and after.
4. Both SDK close operations succeeded; both Sessions closed and provider delete operations completed. Resource identifiers and create/delete evidence retained privately for reconciliation.
5. Temporary application token revoked and local token file removed. Empty review tenant removed. Authorized temporary credential ingress stopped. Local control-plane service remains running. Older unresolved Instabox resources were not touched.

Private evidence: `.local/minimal-session-journey/` includes generated clients, journals, redacted command output, screenshots and `evidence.json`. No secrets in this document. This is a focused new direct-session cloud journey, not a rerun of every historical provider/Web/approval matrix case.
