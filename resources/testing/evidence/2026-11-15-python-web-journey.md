# Independent Python Web journey

Command: `HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 npx tsx tooling/smoke-api.ts`.
Verified private journal: `.local/evidence/api-smoke-6e327633-f701-4268-937c-5bf70349ab52.json`.

The parent sets up test-owned cloud resources and services; `testing/python-web-client.py` independently drives the public Python SDK. No canned agent response is used. Both tasks use actual OpenCode 1.2.27/MiniMax in separate E2B sandboxes.

Python verified:
- Continues the TS-created Session and receives a completed response.
- Creates its own Agent, Session, and uncredentialed report Tool connection; uploads the complete Web fixture.
- Submits idempotently, disconnects the SSE stream after its first event, and reconnects from that cursor. All 812 observed event IDs exactly match persisted event history without duplicates or missing IDs.
- Handles authorization.required by registering, validating and enabling the report credential through SDK.
- Handles approval.required through SDK; actual report service counter has zero new writes before approval and one afterward, including repeated approval submission.
- Downloads module/report artifacts and verifies SHA-256 and test output.
- Creates an isolated preview, verifies actual cloud content and anonymous denial.
- Runs a same-Session follow-up. Parent independently checks unchanged acceptance.mjs and runs all 8 assertions, then TypeScript continues the Python-created Session successfully.
- Explicitly cancels a new Run and observes cancelled state.
- Revokes preview and observes denial, creates a new preview, closes Session and observes denial again.
- Downloads identical artifact bytes and final output after closure; removes its report connection.
- Provider confirms the Python sandbox was deleted. Both test sandboxes and test template were cleaned up.

Limits: credentials were handled through API/SDK rather than GUI during this run; Python preview content was checked over HTTP, while visual interaction is covered by the separate browser Web journey. Full GUI initialization and runtime authorization, additional harness/provider/custom combinations and remaining failure/security branches are still pending. TypeScript's additional live SSE/cancellation script checks were added while this process was already running and require their own subsequent execution evidence.

## TypeScript follow-up execution

Command: `HEXAGON_WEB_SMOKE=1 npx tsx tooling/smoke-api.ts`.
Successful journal: `.local/evidence/api-smoke-62212997-bfaa-4147-a214-bdf593f4fcf6.json`.
This separately executes the newly added TypeScript live SSE disconnect/reconnect comparison against complete persisted history and explicit task cancellation. The same real Web task, Tool auth/approval, artifacts, preview, follow-up and cleanup checks passed. Both SDKs now have complete API-driven task-path evidence; combined GUI authorization/setup remains pending.

An opt-in `HEXAGON_GUI_AUTH=1` acceptance hook is prepared for the next browser run. It stops automatic credential registration, exposes only a private test-access file and waits for the actual connection to become ready/enabled through external interaction. It has not yet been executed or counted as GUI evidence. Its temporary access file is removed in teardown.
