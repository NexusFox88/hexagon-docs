# Fleet quota diagnosis and post-expansion regression

The original supplied acceptance journey was reread. Its Fleet requirement includes meaningful resource errors, separately from Run and Runtime state. Inspection found that rejected create operations retained `sandbox_quota_exceeded` in the database but the Fleet query returned reasons only for unknown operations. Console already had English and Chinese quota guidance, so that guidance could not be reached through this resource-operation response.

The Fleet query now includes reasons for rejected operations as well as unknown operations. Completed operations still omit reasons. The worker quota regression checks the tenant's Fleet response, foreign-tenant exclusion, no duplicate create/reconciliation and successful closure after rejection. No credentials or raw provider responses are added to Fleet.

Verification on 2026-11-16:

- Full local PostgreSQL regression: `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm test` — 54 files / 154 tests passed. The test setup creates and removes an isolated schema.
- Type checking subsequently caught missing constructor dependencies in the newly added test fixture. After correcting those dependencies, `npm run check` passed and the complete worker suite passed again (8 tests).
- Reran `tooling/audit-retained-journeys.ts` with all journal names from `.local/evidence/final-acceptance-selection.json`: 32 journeys / 64 primary Runs verified. This checks retained completed replies, closed Sessions, artifact bytes/hashes, fixed eight-assertion reports, single completion events and absence of unresolved resource operations in those journals.
- This is retained-state verification, not fresh cloud execution or a new provider inventory. It does not cover every newer Instabox/application journal or establish live acceptance for the expanded SaaS catalog. SaaS account acceptance remains waived for that expansion; Daytona remains explicitly deferred.

No cloud resource was created, no SaaS account action was executed, and no code was committed or published during these checks. Full-goal completion is not asserted by this focused repair and regression.
