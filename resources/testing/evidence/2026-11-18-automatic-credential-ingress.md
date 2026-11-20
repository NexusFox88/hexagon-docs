# Automatic credential ingress — 2026-11-18

The user requires Sandbox/model configuration followed directly by SDK execution, without manual restoration of credential ingress.

## Implementation

Default local startup loads deployment settings and opens its credential-only channel. A shared readiness coordinator checks this listener's identity and automatically starts/restores ingress for Session preflight/create and before Worker provisioning. Concurrent callers share one recovery. Health cache invalidates on origin change. Python defaults to 90 seconds to accommodate bounded cold startup. Failure yields sanitized API/Run errors before new cloud provisioning. Console no longer makes network settings a normal calling prerequisite; both language catalogs explain automatic preparation.

An origin used by a nonterminal persisted invocation is not replaced. Idle Sessions do not block recovery: each new invocation gets current scoped access. Explicitly disabled and external/hosted ingress retain their deployment policy; no development tunnel is opened for them. Provider credentials remain in the control plane.

## Verification

- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify`: 63 files / 188 tests passed, 2026-11-17 23:58:29 local, 27.51 seconds. Includes concurrent recovery, stopped ingress, origin cache invalidation, in-flight protection, external/disabled policy and sanitized failure.
- `npm run verify:startup`: verified fresh boot, persistence/restart and hosted startup. Private evidence `.local/startup/hexagon_startup_18a1ad466e8849db89598451c6036db4/evidence.json`.
- Browser review in English/Chinese confirms the calling page has no manual network-settings prerequisite. Credentials remain hidden.
- Real Python: explicitly stopped ingress, then called `create_session` without preflight or manual recovery. Vercel/Pi/SiliconFlow returned `AUTOMATIC_PYTHON_OK`. Session `b4977906-2d8b-4f09-91f7-a16619d7c175`, Run `d0689564-bc40-48a9-826e-1a3ffd3b21be`.
- Real TypeScript: created Session, stopped ingress before submitting Run, then submitted via SDK. Worker restored ingress and returned `AUTOMATIC_TYPESCRIPT_OK`. Session `4ba8e8bb-7dec-4479-afa0-56bbf5eae8b7`, Run `04899fc6-f538-4be8-b7d0-a4cacf280fbf`.
- Both Sessions closed, provider delete operations completed. Test application token revoked and local token file removed. Default platform-managed ingress remains enabled for subsequent user SDK calls; no manual Settings step remains.

An initial acceptance helper sent an empty JSON POST and was corrected. Real acceptance also exposed an overly broad guard on any existing Runtime, including idle test sessions; it was narrowed to persisted, nonterminal invocations before the passing journeys. No original task resources were deleted to bypass that guard.

Private scripts, IDs, cleanup evidence and logs: `.local/automatic-ingress/`. This change does not yet remove manual local Console-token entry; that is a separate local identity/onboarding issue raised during final verification.
