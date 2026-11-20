# Per-invocation Tool authorization refusal

Implemented API, Python/TypeScript SDK methods and Console waiting-authorization controls. Status: deterministic public API/SDK verification passed; new Console interaction and actual cloud Harness continuation are not yet verified.

`POST /runs/:id/tool-calls/:call/deny-authorization` accepts the immutable `request_hash`. It shares the broker advisory lock, checks tenant/Run/call scope, and records an error result and audit events transactionally. It performs no external request and does not alter credentials. The broker replays the cached result to the original invocation. Refusal does not cancel the entire Run or ban subsequent distinct calls. It cannot undo a previous authentication-failed request.

Commands on 2026-11-15:

- `npm run check`: passed.
- `node --check apps/console/app.js`: passed.
- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm test`: 22 test files, 53 tests passed.

The new `modules/tools/authorization-denial.test.ts` starts actual loopback API and report HTTP servers with isolated database records. TypeScript and a Python subprocess each refuse a broker-created waiting call via the public API. Assertions cover cached error delivery through the broker, duplicate refusal with exactly one audit/completion pair per invocation, a new invocation independently asking again, cross-tenant denial rejection, hash mismatch rejection, broker-lock contention, stale refusal after cancellation, terminal idempotent response without Run revival, unchanged connection state, zero approvals, and zero report writes. All fixture servers close and fixture tenant records are removed.

The first targeted run failed because the fixture declared the report Tool required at Session creation. The fixture now explicitly declares `required_at_start: false`, matching the runtime-authorization scenario; the product's readiness guard was retained. Targeted rerun passed all six tests across four files before the complete suite above.

This evidence does not yet close the entire authorization-refusal/expiry/reauthentication acceptance row. Expiry and GUI reauthentication have separate evidence; browser refusal and actual Harness response to refusal remain pending.

## Real cloud continuation and Console refusal

Subsequent command: `HEXAGON_GUI_DENY_AUTH=1 npx tsx tooling/smoke-api.ts`. Exit 0, state verified. Started 2026-11-15 04:33:47 UTC; finished 04:36:52 UTC. Private journal `.local/evidence/api-smoke-ab246ab1-8370-4bc1-ae09-96a3bc7ceb84.json`.

Real combination: E2B / OpenCode 1.2.27 / user MiniMax endpoint. Session `e61f45bb-96bf-4aa3-94b9-56015ead75b4`, original Run `77148d9a-f091-41f1-8d1e-d9f1f24f28f2`, Sandbox `i06otn822hm1g0866amhw`.

The actual Harness read the authenticated requirement, implemented the uploaded calculation task and called the missing-credential report Tool. Ego-browser TaskSpace 13 logged into the actual Console using an in-memory decrypted test checkpoint, opened Fleet and the sole instance detail, observed waiting authorization and the `拒绝此次授权 · reports.write` button, clicked it and accepted the per-invocation confirmation. Console displayed `已拒绝此次授权，Agent 将收到拒绝结果。`; the refusal button disappeared. No API shortcut was used for this action. The browser space was finished and closed.

The original Run completed with a Chinese assistant response explicitly stating that the report was not uploaded because the user refused authorization. Exactly one report invocation was recorded (`d42c6acf-590e-4be9-8612-a512e2e1c3f7`); its authorization-denied event was `486`. The report connection remained draft. There was no report approval and zero report writes. The Harness did not retry that tool or substitute another write path.

Independent execution of the unchanged fixed tests returned exit 0 and `2 assertions passed`. Both required artifacts were downloaded, all 629 durable events were checked by the existing replay assertions, same-Session follow-up completed, cancellation completed, and exported artifacts/final output remained after Session close. Product cleanup, provider absence and temporary template deletion were all confirmed. This branch uses the calculation fixture; it is not a new full Web-preview acceptance claim.

`npm run check` passed for the new repeatable smoke mode. Together with the earlier API/SDK regression and separate GUI expiry/reauthentication evidence, this completes the currently supported API-key Tool authorization-refusal/expiry/reauthentication branch. OAuth is not advertised or claimed here.
