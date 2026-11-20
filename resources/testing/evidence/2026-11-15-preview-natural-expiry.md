# Natural preview expiry in a real cloud Web journey

Date: 2026-11-15. Status: passed.

Command: `HEXAGON_PREVIEW_EXPIRY=1 HEXAGON_WEB_SMOKE=1 npx tsx tooling/smoke-api.ts` (exit 0). `npm run check` passed.

Private journal: `.local/evidence/api-smoke-79e630ed-c2c6-455b-8942-cd5a5d7470ff.json`.
Session `9ea5e683-11d6-4f4a-a349-bbd8aaabd95d`; Run `04b0a4ce-c47a-4c48-85e6-f407d41b7aed`.

The real E2B/OpenCode/MiniMax Web task completed, independently passed all 8 fixed assertions, exported artifacts, and produced 949 durable events with stream/cursor replay checks. Tool authorization/approval and exactly-once report write, follow-up, cancellation and retention also passed.

The TypeScript SDK created a separate 30-second preview grant for the actual cloud Web service. Its entry ticket returned 302 and issued a cookie; the cookie then retrieved HTTP 200 with the expected application content. The test waited using wall clock; it did not edit grant timestamps or mock authorization.

- Grant: `f2a64641-c7a0-4509-806f-e0e0368dc3ba`.
- Successful content access: 04:24:10.875 UTC.
- Declared expiry: 04:24:40.182 UTC.
- Recheck completed: 04:24:40.689 UTC.
- Manually presenting the old cookie after expiry: HTTP 401.
- Reusing the original entry ticket after expiry: HTTP 401.
- Presenting the first grant's cookie to another grant's host: HTTP 401.
- Another grant revoked via the SDK rejected both its cookie and original ticket with HTTP 401.
- The original longer-lived preview remained accessible after the short grant expired, distinguishing access control from a stopped app or provider outage.
- Anonymous access was denied; closing the Session subsequently denied access through the original preview as well.

The loopback HTTP test transport preserves each grant's virtual Host header and exercises the actual proxy and provider private-preview target. This is a network-level test, not a claim that browser cookie expiry alone enforces access. The server rejected the manually supplied expired cookie itself.

Product cleanup, provider resource absence and temporary template absence were all confirmed at 04:24:55 UTC. No credential or ticket values are included in evidence output. No commits made.

Capability audit: current E2B/Daytona adapter catalogs advertise files, commands and Web preview (E2B also network allowlisting). They do not advertise pause/resume, snapshot creation or desktop streaming, as already documented in `docs/execution-combinations.md`. These conditional capability scenarios are not being claimed as implemented or tested; the still-open provider-combination matrix remains separate.
