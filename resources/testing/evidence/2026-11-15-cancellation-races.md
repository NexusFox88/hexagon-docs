# Cancellation racing with external Tool responses

Date: 2026-11-15. Scope: controlled real HTTP service, actual PostgreSQL transactions, deterministic response barriers. No model or cloud execution is claimed by these tests.

Before this change, cancelling a Run while an approved external request was in flight caused the subsequent response settlement to fail the active-Run guard. A successful external write could therefore remain recorded as executing even after its result was received.

ToolBroker now permits the current fenced lease to settle an already dispatched request while the Run is cancelling. It records a known response or the waiting/unknown call outcome, keeps the Run cancelling, and never accepts a new dispatch on that Run. An unsuccessful late response emits `tool.result_after_cancellation` instead of asking the user to authorize or approve continuation of a cancelled task.

Tests use a local HTTP server that signals request receipt, then withholds its response until after two idempotent cancellation requests have committed. Separate cases release HTTP 200, 503 and 401 responses. They verify persisted call outcome, unchanged cancelling state, one external request, rejected replay/new dispatch, and one cancelling/one cancelled event. The 200 case additionally creates a fresh Run, cancels while approval is pending, rejects both late approval decisions as stale, and proves no new external request occurred.

Validation:

- `npm run check`: passed before the final assertion-only additions.
- Full isolated PostgreSQL suite: 21 files / 52 tests passed.
- Final cancellation test rerun after adding stale-approval and event assertions: 3 cases passed.

Cancellation cannot roll back an external request already accepted by a remote service. Unknown outcomes remain visible in the Tool-call audit; this change does not claim automatic reconciliation or rollback of external writes, or cloud cancellation-race coverage. No commits made.
