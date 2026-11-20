# Real Web filter journey and isolated previews

Implemented persistent, expiring/revocable preview grants; a separate HTTP preview server; unique origin per grant; HttpOnly host-only preview cookies; per-request Session/expiry checks; private provider-header forwarding; and Console + both-SDK creation/revocation methods. Management port 8765 is excluded. Origin checks reject cross-origin app requests, and external redirects are blocked. Header behavior was checked against MDN's CSP sandbox and Set-Cookie references:
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie

## Real cloud verification

1. An initial arithmetic-plus-preview attempt failed at preview bootstrap: `.local/evidence/api-smoke-65af1fef-aa63-4c28-a53b-0b496e18f289.json`. Sandbox and template cleanup confirmed. A localhost HTTP reproduction established that Node fetch replaced the supplied Host header in this environment, unlike Fastify injection. The test transport now uses node:http and checks actual virtual-host HTTP routing.
2. Arithmetic-plus-preview rerun succeeded: `.local/evidence/api-smoke-8c90d985-8608-4de5-b723-cef24bb2324c.json`.
3. Full Web fixture command: `HEXAGON_WEB_SMOKE=1 HEXAGON_BROWSER_REVIEW=1 npx tsx tooling/smoke-api.ts`.
   Successful journal: `.local/evidence/api-smoke-a01d7915-a097-4412-bf71-20a53ec63a46.json`.

The third run used actual OpenCode 1.2.27/MiniMax in E2B. Input project is `testing/fixtures/filter-app`. Agent read ACCEPTANCE-001 through MCP, implemented `filter.mjs`, passed 8 independent assertions with the fixed test file unchanged, launched its own detached HTTP server, waited for report Tool authorization and approval, wrote one approved report and produced downloadable module/test-report artifacts.

Actual Ego Browser interactions on the authenticated cloud preview:
- Initial page rendered 4 tasks.
- Query `  API  ` plus done status yielded only Launch API.
- A nonexistent query yielded no task cards and visible empty state.
- Clearing query and selecting open yielded Write SDK guide and Review API tests.
- Entry ticket was removed from the URL; document.cookie could not read the HttpOnly credential.
- Screenshot inspected: `.local/evidence/web-filter-preview.png`.

Run was already completed while its preview service remained accessible. Same-Session follow-up completed. All 808 persisted events replayed across pages. Closing Session invalidated preview access (401), retained artifact bytes and removed the sandbox; template cleanup independently confirmed. Browser test space closed; temporary browser-access file removed by the script.

## Local checks

- `npm run check`: passed.
- `node --check apps/console/app.js`: passed.
- TypeScript SDK build: passed.
- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm test`: 24 tests / 11 files passed.
- Preview test covers actual upstream HTTP, bootstrap over a real socket, assets, same-origin POST, no provider-cookie or client-auth forwarding, different-grant denial, expired/revoked grants, cross-tenant issuance/revocation denial, management-port rejection and Session closure.

## Remaining scope

This run initialized credentials and completed runtime Tool authorization through API automation, not GUI. Python has not yet independently run the full Web/tool/preview scenario. Live Fleet/GUI authorization, additional harnesses/providers/custom harnesses, real Exa/Tavily/DeepL integrations, network/fault branches and hosted-control-plane acceptance remain outstanding. WebSocket proxying, upstream application cookies and external browser dependencies are explicit current preview capability gaps. This evidence does not claim complete product acceptance.
