# E2B OCI execution preparation

Status: E2B public OCI implementation and scoped OpenCode live acceptance completed. This increment does not complete the orthogonal-platform plan or certify every Harness on E2B.

## Implementation

- E2B public OCI images use native `Template().fromImage()` and `Template.buildInBackground()` with a unique operation name, 2 CPUs and 4096 MiB. Non-OCI Sessions keep their configured Template.
- Reuses `resource_operations` with `kind=image_prepare`. Template ID and build ID are persisted separately from Sandbox creation. Known builds are polled; missing receipts are reconciled by exact operation alias. No match is never permission to rebuild.
- Template-list build IDs represent the last successful build, so only a unique ready match can recover a missing receipt. Failed/in-progress receipts that cannot be recovered remain unresolved.
- Session close removes compute, then its owned template. Lost delete responses retain the handle for safe retry. No cross-Session template cache and no advertised private-image capability yet.
- Known building status is ordinary provisioning with a durable event and a five-second deferred worker lease, not a generic recovery failure. Stale workers cannot reuse the released lease.
- Console has en/zh-CN image operation labels/errors and build-ID diagnostics. SDK Session shape is unchanged.
- Cloud runner accepts exact Harness ID and installed SDK paths. The independent workspace inspector now supports a bounded filename and records the actual file SHA-256; headless acceptance checks bytes and native session ID before/after recovery.

## Deterministic verification

- TypeScript `npm run check`: passed.
- Initial image preparation/connector/lifecycle checks: 4 files / 8 tests passed.
- Full isolated-database regression after adding OCI integration: 105 files / 342 tests passed.
- After adding deferred provisioning: Runs + image preparation, 2 files / 10 tests passed.
- After adding build diagnostics: resource operations + localization + Runs, 3 files / 16 tests passed.
- These use deterministic cloud fixtures; real cloud results are separate below.

## Live execution evidence

Private records, with resource IDs, under `.local`:
- `.local/e2b-oci-probe-1edfd4c6-a838-40c4-962f-4fcae069c269.json`: source OpenCode image digest `sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e`; Template build, Sandbox create, real `opencode --version`, Sandbox absence and template deletion succeeded.
- Two earlier local probes failed before contacting the provider: the initial broad database lookup selected a historical fixture connection encrypted under a test key. Probe selection was corrected to the authenticated local workspace's connection list. No resources created by those attempts.
- `.local/headless-cloud/e2b-d5bfc202-f710-45f2-8d82-5fe77491a282/report.json`: Python strict initialization-output check failed because MiniMax reproduced one identity character incorrectly. Independent inspection confirmed the exact configured identity in the persisted invocation. Preserve this failure. TypeScript passed initialization, physical pause, automatic wake, native-history continuation, MCP call, artifact download/retention and cleanup. Both Sessions and templates cleaned.
- `.local/headless-cloud/e2b-f6de4b55-adb6-4183-8bcb-dc334979e665/report.json`: installed SDK follow-up; Python/OpenAI Chat passed, TypeScript/Anthropic passed. One close response was unconfirmed; exact-resource reconciliation subsequently confirmed cleanup. New immutable registration accepts all three OpenCode model protocols, unlike the older Anthropic-only registration. Registration was called successfully through both installed SDKs.

- `.local/headless-cloud/e2b-4acaa2ae-6fef-4bce-8bbb-64f33f93db5f/report.json`: installed Python/OpenAI passed the strengthened independent byte-hash and native-session-ID assertions, MCP execution, artifacts and retained results. TypeScript/Anthropic failed exact identity output (one character changed), while persisted initialization was correct; cleanup confirmed for both.
- `.local/headless-cloud/e2b-af43a2b9-9384-444f-9411-06e19cff1101/report.json`: TypeScript failed initial file content because the model wrote the full background sentence rather than only its identifier. Cleanup confirmed. The prompt was made explicit about exact file content; this failed attempt remains in evidence.
- `.local/headless-cloud/e2b-e20d7c2c-01e4-4cb7-bede-2542ea3928fe/report.json`: final installed TypeScript/Anthropic journey passed, including exact identity/background output, independent identical file SHA-256 before/after physical pause, unchanged native session ID, automatic wake, real MCP call, artifact download and retention after close. Cleanup confirmed. This run used the clarified exact-content prompt.
- Output identity assertions now run after restoration checks, so a model-text mismatch does not hide later restoration evidence. They still fail the overall journey; no generated output is repaired.

The original headless runner relied on model-mediated file readback. The subsequent strengthened Python run records actual workspace-byte hashes before and after pause; the older rows must not be retrospectively presented as that stronger assertion.

## Final resource audit

`.local/e2b-oci-resource-audit.json` records all eight Session IDs and their operations from these cloud attempts. Eight Sessions closed, eight per-Session templates deleted, eight compute deletion operations confirmed; no pending/unknown operations in this increment. The separate direct probe also confirmed compute/template deletion. This audit excludes the three historical operations the user explicitly parked.

Final `npm run check` passed after runner assertion/prompt updates. Final TypeScript runner exited 0. The two installed SDK journeys cover different MiniMax protocols: Python/OpenAI Chat and TypeScript/Anthropic Messages. They do not certify every SDK/protocol cross-product, Responses, or every E2B Harness. Earlier model-text failures remain failures, even though later runs passed.

## Browser scope

Actual ego-browser space 61: resource operations in Chinese/light and English/dark, dropdown keyboard Home/End/Enter selection, Escape dismissal, operation expansion and wheel scrolling. Observed resource list scrollTop 525 while document scrollTop remained 0; no horizontal overflow. Screenshots in `.local/oci-operations-dark-en.png` and `.local/oci-operations-light-zh.png`. The final running build was also visually checked as “镜像构建中” in Chinese/light and “Building image” in English/dark, with the persisted build ID in diagnostics; screenshots `.local/oci-building-light-zh.png` and `.local/oci-building-dark-en.png`. Space-key expansion and list-only scrolling passed again. This is scoped operations-page review, not the full blank-workspace journey.

## Remaining boundaries

Other E2B OCI Harnesses, private images, cross-Session cache, broader provider import/build paths and the full Console journey remain unverified/incomplete. Installed SDK artifact checks and the installed-SDK cloud journeys above are separate from repository-source SDK runs. Historical parked resource operations are untouched.

Vercel investigation: its supported custom-image path is project-scoped VCR, not passing an arbitrary external registry reference directly. See [Vercel Sandbox upstream README](https://github.com/vercel/sandbox/blob/main/README.md) and [official Docker/VCR guide](https://vercel.com/kb/guide/docker). No VCR image was pushed or published in this increment.
