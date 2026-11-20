# Public API connection lifecycle on an actual cloud task

Command: `HEXAGON_CONNECTION_LIFECYCLE=1 HEXAGON_WEB_SMOKE=1 npx tsx tooling/smoke-api.ts`.

Final result: exit 0, verified, product cleanup and provider resource/template cleanup confirmed. Private journal: `.local/evidence/api-smoke-af86e58c-c6f0-4afd-b0e1-8668f35c20b5.json`. Finished 2026-11-15 03:16:41 UTC. An earlier successful run, before adding the new-Run guard, is retained at `.local/evidence/api-smoke-b068436e-ab0b-45c5-b34a-e81f941a281e.json`; the final run above covers the repaired behavior.

The test executes the existing real E2B/OpenCode/MiniMax Web task, authorization and approval, fixed application tests, preview, artifacts, follow-up and cancellation. It then drives connection lifecycle through the public HTTP API using the TypeScript SDK:

1. Deleting the Sandbox connection while its Session is open returns `409 connection_in_use`.
2. Updating name and template configuration is observable, changes the connection to draft/disabled, and makes enablement return `409 validation_required`. The existing Session's pinned definition is unchanged.
3. Replacing only this test Connection's credential with a deliberately invalid value fails actual provider validation. A new Session is rejected. No provider key is revoked or account setting changed.
4. Restoring the original credential and configuration, validating against E2B and explicitly enabling succeeds.
5. A second independent Connection using the same account credential validates successfully.
6. Disabling the primary Connection blocks both new Sessions and new Runs on the existing Session with `409 connection_not_ready`. Deletion still fails while a Session depends on it.
7. Closing the existing Session while disabled succeeds. Provider inspection confirms the actual Sandbox is gone; artifacts and final conversation remain available, and the old preview returns 401.
8. Deleting the now-unreferenced primary Connection succeeds; reading it returns 404. Revalidating the sibling against E2B succeeds, proving that connection deletion did not invalidate the shared account credential. The sibling is then deleted too.

## Product correction and regression coverage

Previously, disabling a connection blocked new Sessions but Run submission on an existing Session did not inspect its connections. `Runs.submit` now locks and validates the Sandbox/model bindings before inserting a new Run. Existing idempotency keys return the original Run before this check. The worker rechecks readiness before saving a new invocation, while an already persisted invocation is still eligible for recovery. An unprovisioned Run whose connection is disabled after acceptance fails explicitly with `connection_not_ready`, rather than repeatedly reporting an uncertain execution outcome.

`npm run check` passed. The full regression suite passed 18 files / 41 tests after the submission guard; the subsequently added worker case passed in a targeted run (3 worker tests), covering absent resources, transport uncertainty and disabled provisioning. The submission regression covers both Sandbox and model connections, exact idempotent retries and absence of a rejected Run row.

Scope: actual E2B resource lifecycle, public API/TypeScript operations and shared-credential preservation. GUI edit/rotation/disable/delete interactions and Tool credential refusal/expiry/reauthentication are separate remaining acceptance work. This evidence does not claim a second provider or a complete connection GUI journey.
