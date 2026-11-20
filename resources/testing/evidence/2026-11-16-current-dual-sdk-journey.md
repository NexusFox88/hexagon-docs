# Current-code dual SDK Web journey and application form review

The original supplied acceptance scenario was reread before this run. This is fresh cloud execution after the SaaS expansion, Fleet quota reason correction and Linear uncertain-write correction. It is not real-account acceptance for the new SaaS connectors; that remains waived by the user. Daytona remains deferred.

## Real cloud execution

Command:

```sh
HEXAGON_SANDBOX=instabox HEXAGON_HARNESS=pi HEXAGON_MODEL=siliconflow HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_SERIAL_SDKS=1 NODE_USE_ENV_PROXY=1 node --import tsx tooling/smoke-api.ts
```

The command exited 0 with `state: verified`, `resource_cleanup: confirmed`, and `template_cleanup: not_created`. Started 2026-11-16 06:28:37 UTC; finished 06:37:08 UTC. Its isolated schema and private journal are `.local/evidence/api-smoke-86fd5268-2f52-45b0-a5c4-219be6ffd879.json`. Sessions ran serially under the account's one-machine quota. The test-owned credential tunnel closed when the process exited; the separate local development service remained running.

| Client | Session | Primary Run |
|---|---|---|
| TypeScript | `5948ca97-5334-43ad-8573-77cb9fd053d8` | `5b78ebf0-85b2-498e-8258-be91d3370ba5` |
| Python | `c2febfb8-d10b-47b5-a06d-e0d8dcad5647` | `a2b06ee2-84b6-4b94-9fc2-04e23bb840fe` |

Both completed the independent uploaded Web task with an actual Pi/SiliconFlow Agent. Independent execution of unchanged `acceptance.mjs` produced `8 assertions passed` for each client. The journals verify submission idempotency, cursor replay, requirement reads, runtime report authorization, approval with zero writes before and one write after, artifacts, authenticated previews, follow-up Runs and bidirectional cross-language continuation. Cancellation and close passed; artifacts and final results remain available after close and preview access is denied. These cancellation cases do not replace the separate active-process cancellation evidence.

Authorization/approval in this cloud run used SDK/API automation; this does not claim new GUI credential entry or interactive preview filtering for the cloud run. Earlier GUI journey evidence remains separate.

The primary Session's credential-isolation probe inspected 1,079 sources, found neither the original model key nor provider key, and verified that the original key was absent from the persisted invocation. This is a bounded probe, not an exhaustive security proof.

Independent `tooling/audit-retained-journeys.ts api-smoke-86fd5268-2f52-45b0-a5c4-219be6ffd879` passed: one journey / two primary Runs, checking retained terminal state, replies, closed Sessions, artifact bytes and SHA-256 hashes, fixed test reports, one completion event and no unresolved resource operations.

The separate read-only `tooling/audit-instabox.ts` provider reconciliation passed across 15 completed test journals, 22 operation IDs and 21 resource IDs, including this run: no matching test resource remained. Its first attempt failed during TLS setup with `ECONNRESET`; the same read-only audit was retried and completed successfully. Exact IDs and timestamp are retained in `.local/evidence/instabox-resource-audit.json`. This is an exact test-owned resource audit, not a whole-account deletion or inventory claim.

## Local Console review

Used the existing Console and actual local application catalog, without external OAuth consent or SaaS calls. The retained tab initially held pre-expansion translation modules; refreshing and reconnecting with the local owner token loaded current files. No stored credentials were printed or changed.

- All 17 new provider forms rendered their operation controls in English and Chinese, without untranslated-key placeholders.
- Trello showed two password fields, hid the generic credential input, selected only four read operations by default, and left three writes unselected.
- Submitting only one dummy credential showed the Chinese application-owned validation error and did not create a connection. Closing and reopening cleared the dummy fields.
- A pointer action targeting an option clipped below the list viewport was intercepted; scrolling the list normally then clicking succeeded. Keyboard focus/Enter selection also succeeded. No product fix was inferred from this automation positioning failure.
- Inspected the [English Trello screenshot](applications/trello-en.png). The form uses the existing application-owned dialog, scroll body and fixed footer.
- Closed all drafts, confirmed the three existing Tool connections remained, restored Chinese and retained the connected Console for the user.

No code commit or publication occurred. These checks strengthen current execution and local UI evidence but do not claim overall completion or live validation of all SaaS providers.
