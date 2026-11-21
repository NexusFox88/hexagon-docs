# Acceptance ledger

Latest Session credential UX: [env, Secret references and per-Session revocation](evidence/2026-11-19-session-credentials-ui.md), including limited Vercel cloud success and an unresolved initial creation outcome.

Current expanded MiniMax acceptance: [Sandbox × Harness × protocol matrix](evidence/2026-11-18-minimax-matrix.md). This record separates exact dual-SDK passes, failures, unverified images and unresolved resource operations. Historical checked items below do not certify untested expanded combinations.

Latest observability: [Session initialization across Console and both SDKs](evidence/2026-11-18-session-initialization.md).

Latest integration expansion: [remote MCP, Feishu/Lark and Responses](evidence/2026-11-18-mcp-lark-responses.md), with separate real cloud MCP and deterministic Lark/Responses evidence.

Latest local dependency readiness: [automatic credential ingress and dual-SDK recovery](evidence/2026-11-18-automatic-credential-ingress.md).

Latest entry experience: [2026-11-17 minimal Session Console and direct dual-SDK cloud journey](evidence/2026-11-17-minimal-session-console.md).

Current scope closure: [Daytona moved to future candidates](evidence/2026-11-16-daytona-candidate.md) records the explicit user scope change, API/Console removal and verification. The historical baseline was covered at that checkpoint. The expanded Harness catalog and MiniMax protocol matrix require new combination-specific evidence; they are not covered by that closure.

Latest current-code verification (2026-11-16): [fresh Instabox/Pi dual SDK Web journey and local application form review](evidence/2026-11-16-current-dual-sdk-journey.md). Both independent cloud tasks passed, including fixed tests, runtime authorization, approval, replay, previews, cross-language continuation and cleanup. The 17 added SaaS forms were reviewed locally in both languages without external account validation, following the user's explicit waiver for that expansion. [Fleet quota diagnosis](evidence/2026-11-16-fleet-quota-audit.md) and [uncertain application writes](evidence/2026-11-16-application-write-outcomes.md) have separate focused evidence. On 2026-11-16 the user explicitly removed Daytona from current compatibility and retained it only as a future candidate. Historical notes below remain chronological evidence, not the current support scope.

Source: User-supplied acceptance journey (original attachment retained privately).

Checked items have direct evidence linked below. Unchecked items remain incomplete or lack full-scope evidence. Evidence includes commands, runtime observations and relevant resource/run IDs; secrets are excluded.

## Minimal entry journey (2026-11-17 user specification)

The entry experience is: connect and verify at least one Sandbox and model → create Sessions and converse via API with harness/model/Sandbox/env parameters → optionally authorize third-party Tools → create more Sessions with selected Tool bindings → observe each Session's execution and tool activity in Console. Reusable Agent registration is optional. This replaces the previous mandatory saved-Agent entry flow; the full Web, authorization, approval and recovery acceptance below remains in scope.

## Main journey
- [x] Clean application startup, Console, authenticated API, health of DB/worker/secrets; restart persistence (local prerequisites installed).
- [x] GUI cloud connection creation, scoped verification, enablement, masked credentials (E2B).
- [x] GUI authenticated requirements Tool onboarding and actual ACCEPTANCE-001 read.
- [x] Discover harness/provider capabilities; register AgentDefinition; reject incompatible combinations before execution.
- [x] Create Session with pinned configuration, resource/network policy and tool bindings.
- [x] Upload input project; verify exact workspace bytes; idempotent Run submission.
- [x] Provision actual cloud sandbox; bootstrap runtime and actual harness automatically.
- [x] Agent reads requirement, edits actual application and executes fixed tests.
- [x] Fleet shows separate sandbox/runtime/run states and meaningful events/errors.
- [x] Authenticated Web preview works and the implemented filter can be operated.
- [x] Missing report Tool authorization suspends original Run; GUI validation resumes it.
- [x] Report write waits for API/SDK approval; verify zero writes before and one after approval.
- [x] Final assistant answer, terminal state, artifacts and durable query agree.
- [x] Disconnect/reconnect event subscription without duplicate Run or lost events silently.
- [x] Preview process can remain while completed Run is terminal.
- [x] Follow-up conversation uses the same Session and a new Run.

## Clients and integration matrix
- [x] Python full journey including upload, events, GUI auth, approval, artifacts, follow-up, cancellation and close.
- [x] TypeScript full journey with GUI initialization/authorization, upload, events, approval, artifacts, follow-up, cancellation and close.
- [x] Cross-language Session continuation in both directions.
- [x] Alternate actual harness through the same client API (Pi and OpenCode on E2B).
- [x] Alternate cloud provider through the same client API.
- [x] Registered custom harness package executes in cloud sandbox (tenant-owned Python package on E2B).
- [x] Current executable provider/Harness/MiniMax protocol matrix: 84 combinations / 168 independent Python and TypeScript journeys / 336 completed Runs. Anthropic, Chat Completions and Responses are separately tested. Recipe-only images remain unverified, unsupported intersections remain unsupported, and Daytona remains excluded. See [exact scope and unresolved early creation outcomes](evidence/2026-11-18-minimax-matrix.md).

## Branches
- [x] Connection configuration update, credential replacement and revalidation.
- [x] Disabled connection rejects new provisioning but permits old-resource cleanup.
- [x] Dependency-aware deletion; preserve shared credentials and provider accounts.
- [x] Tool authorization refusal, expiration and reauthentication.
- [x] Worker restart, runtime loss, cancellation races and stale approval handling.
- [x] Create timeout reconciliation; delete failure visible and recoverable through API/Fleet and Console cleanup retry.
- [x] Cross-tenant reads/bindings/subscriptions/artifacts denied.
- [x] Real allowed/denied network probes through API-configured Sessions and unknown-state reporting.
- [x] Unauthorized/expired preview denied; current catalogs audited for conditional extended capabilities (none advertised).

## Teardown
- [x] Session close preserves exported artifacts and completed conversation.
- [x] Provider confirms sandbox/owned endpoints removed; Fleet reflects cleanup.
- [x] Preview becomes inaccessible; connection deletable after dependencies clear.
- [ ] Current global resource cleanup: the historical Blaxel/Sprites audit confirmed its own resources, but the 2026-11-18 MiniMax matrix has six unresolved early creation outcomes (Boat, E2B and Upstash: two each). Successful combination journeys have individually confirmed cleanup. See [current matrix evidence](evidence/2026-11-18-minimax-matrix.md); do not infer zero orphans from historical audits.

## Current evidence
The checked execution, preview, approval and retention items are supported by [real Web preview journey](evidence/2026-11-15-web-preview-journey.md). The recorded cleanup display is supported by [Console browser acceptance](evidence/2026-11-15-console.md). These checks do not establish a complete GUI initialization/authorization journey, full Python journey or the required integration and failure matrix. All remaining boxes stay pending.

Python Web task, exact SSE replay and bidirectional cross-language continuation: [independent Python Web journey](evidence/2026-11-15-python-web-journey.md). The later GUI evidence below completes the client rows.

Runtime report authorization through Fleet and GUI preview interactions: [GUI authorization journey](evidence/2026-11-15-gui-authorization.md). This run needed manual release of a browser preconnection during server shutdown; the defect has a passing TCP regression, and the record does not claim unattended shutdown for that run.

Second actual open-source Harness, both independent SDK Web journeys and cross-language continuation: [Pi cloud journey](evidence/2026-11-15-pi-harness.md). This extends Harness coverage without claiming an additional provider or a GUI-first Pi initialization journey.

Second provider implementation and actual failed attempts: [Daytona evidence](evidence/2026-11-15-daytona-attempts.md). Provisioning and bootstrap worked with a 4 GiB snapshot; outbound model connectivity prevented full acceptance. The provider matrix remains pending.

Confirmed resource absence versus transport uncertainty during worker recovery: [resource-loss regression](evidence/2026-11-15-worker-resource-loss.md). This covers a deterministic part of the fault branch; cloud loss, cancellation races and the full branch remain pending.

An additional directly called model endpoint passed both API-driven SDK Web tasks: [SiliconFlow international journey](evidence/2026-11-15-siliconflow-web-journey.md). GUI onboarding and the remaining matrix requirements are unchanged.

Tenant-owned package registration, immutable version resolution and both independent SDK tasks on E2B: [custom Harness cloud journey](evidence/2026-11-15-custom-harness.md). This completes the custom-package execution item; the remaining provider/GUI/fault matrix stays open.

Fresh GUI connection onboarding, original-Run GUI authorization and Fleet preview, followed by both real SDK tasks and unattended teardown: [GUI initialization journey](evidence/2026-11-15-gui-initialization.md). Python’s separate report-credential GUI path and startup/restart have later evidence below.

Explicit caller-verified reconciliation of uncertain remote writes, dispatch-policy pinning, concurrency guards and both SDK routes: [Tool reconciliation evidence](evidence/2026-11-15-tool-reconciliation.md). This closes a recovery mechanism gap but does not complete the broader cloud fault branch.

Documented migration/start commands against a fresh isolated schema/data directory, authenticated health, retained configuration and decrypted credentials after process restart, wrong-key detection and full process-group shutdown: [startup/restart evidence](evidence/2026-11-15-startup-restart.md). In-flight cloud worker recovery has separate evidence below.

Actual unrestricted and domain-allowlisted E2B instances with allowed/denied HTTPS probes and confirmed cleanup: [egress policy evidence](evidence/2026-11-15-network-egress.md). This verifies connector enforcement; the full API network journey and combined permission branch remain pending.

SIGKILL of an actual worker subprocess during a cloud task's authorization wait, normal lease-expiry recovery by a new process, same Sandbox, one invocation and one approved report write: [worker restart evidence](evidence/2026-11-15-worker-restart.md). Both SDK tasks and cleanup passed; Runtime loss and the rest of the fault branch remain pending.

Actual E2B connection configuration/credential replacement, failed and successful revalidation, dependency guards, disabled new-Session/new-Run rejection, cleanup while disabled, preview revocation on close and preserved shared account credentials: [connection lifecycle API evidence](evidence/2026-11-15-connection-lifecycle.md). This completes the remaining teardown row. The remaining connection GUI lifecycle still needs end-user checks; Tool expiry/reauthentication has separate evidence below, and the broader connection branch remains open.

Expired report Tool credential (HTTP 401), invalid and valid replacement through actual Console forms, fresh approval after rotation, same cloud Run completion and exactly one write: [GUI Tool reauthentication](evidence/2026-11-15-tool-reauthentication.md). Deterministic approval refusal also produces no write. Dedicated credential-authorization refusal and the remaining connection GUI lifecycle are still pending.

Independent Python cloud task with actual Console report-credential registration, original-Run continuation, exact 815-event replay, approval/write-count checks, artifacts, preview, bidirectional SDK continuation, cancellation and cleanup: [Python GUI journey](evidence/2026-11-15-python-gui-journey.md). Together with the common GUI onboarding evidence, this completes the Python client row; the broader integration/fault matrix remains pending.

Two authenticated tenants and anonymous callers against 21 actual HTTP routes, four foreign-resource binding attempts, scoped lists/catalogs, unchanged owner state and zero unauthorized provider operations: [tenant isolation evidence](evidence/2026-11-15-tenant-boundaries.md). This completes the cross-tenant control-plane boundary row; network and preview-expiry coverage remain separate.

Actual HTTP capability discovery and Agent/Session creation with exact versions, resolved Tool approval support, pinned resource/network/configuration/bindings, and rejected incompatible combinations before provider access: [execution preflight evidence](evidence/2026-11-15-execution-preflight.md). This completes the two selection/pinning rows; actual cloud execution and network enforcement use their separate evidence.

All seven uploaded application files read back and hashed in a real E2B workspace before Harness execution, a fenced durable verification receipt, exact manifest comparison and repeated submission returning the same Run: [input delivery evidence](evidence/2026-11-15-input-delivery.md). This completes initial upload/integrity/idempotency acceptance.

Persisted pending writes withheld after supervisor reconstruction, worker remote-state checks before Tool dispatch, explicit interruption during cancellation, and atomic Run/Runtime failure state: [Runtime interruption regression](evidence/2026-11-15-runtime-interruption.md). Deterministic tests pass; actual cloud Runtime termination, network uncertainty display and browser inspection remain pending, so Fleet and the full fault branch are still unchecked.

Actual E2B Runtime SIGSTOP, API-visible unreachable state without false Run completion, SIGKILL/relaunch quarantine, original Run failure, zero report writes, one resource/invocation, and verified product/provider/template cleanup: [cloud Runtime loss evidence](evidence/2026-11-15-runtime-cloud-loss.md). This adds real cloud interruption and unknown-state evidence. Browser rendering and the broader cancellation/create/delete recovery matrix remain pending.

Resource operation visibility, zero/multiple-match create reconciliation, pre-delete failure and lost delete-response regressions: [resource reconciliation evidence](evidence/2026-11-15-resource-reconciliation.md). Local tests pass; the real cloud attempt failed during template construction before Sandbox creation. The named test template still requires absence verification after API connectivity recovers, so global no-orphan confirmation is reopened.

Controlled real HTTP response barriers around Run cancellation, preserved success/401/503 outcomes, no resumed Run or additional dispatch, idempotent cancellation events and stale pending-approval rejection: [cancellation race evidence](evidence/2026-11-15-cancellation-races.md). This adds deterministic race coverage; it does not by itself complete the full cloud fault branch.

Real E2B create-response loss, same-resource recovery and successful MiniMax task, pre-delete failure, post-delete response loss, API/Fleet unknown states, absence-confirmed retry without duplicate deletion, artifact retention and confirmed sandbox/template cleanup: [cloud lifecycle fault journey](evidence/2026-11-15-resource-cloud-faults.md). This completes the create/delete recovery branch through API/Fleet data and restores no-orphan confirmation. Console browser checks remain pending.

Actual Console browser inspection of unreachable/interrupted Runtime, unknown create/delete operations, error/event display, cleanup retry to closed/destroyed/stopped, and unsupported-preview capability display: [Fleet fault browser evidence](evidence/2026-11-15-fleet-fault-browser.md). Combined with the real cloud fault journeys and earlier normal Fleet/preview checks, this completes the Fleet state/error row and the Console portion of resource cleanup recovery.

The user-requested Daytona → SiliconFlow international endpoint recheck again failed at TLS before authentication while npm worked; the short-lived Sandbox was deleted and absence confirmed. Existing-key MiniMax international authentication returned 401. See the updated [Daytona attempt evidence](evidence/2026-11-15-daytona-attempts.md). The alternate-provider task remains unverified; working SiliconFlow/E2B evidence is unchanged.

TypeScript SDK/public API → pinned Agent/Session policy → ordinary worker → real E2B Runtime/custom Harness network probes, with unrestricted baseline, allowed/denied HTTPS results, downloaded report/result agreement, retention and confirmed cleanup: [network API journey](evidence/2026-11-15-network-api-journey.md). Together with the separate cloud uncertainty and Fleet evidence, this completes the network-probe/unknown-state branch.

Actual cloud Web task with natural 30-second preview expiry, expired ticket/cookie rejection, cross-grant isolation, revocation, another grant remaining valid, Session-close denial and confirmed cleanup: [natural preview expiry](evidence/2026-11-15-preview-natural-expiry.md). Combined with cross-tenant and proxy-boundary tests, this completes the preview boundary row. Current catalogs do not advertise pause/resume, snapshot creation or desktop streaming; the alternate-provider matrix remains open.

Per-invocation credential-authorization refusal through public HTTP API and both SDKs, durable broker error delivery, no external writes/credential mutation, duplicate and stale refusal handling, tenant/hash/concurrency guards: [authorization refusal implementation and regression](evidence/2026-11-15-tool-authorization-denial.md). Console control is implemented; its browser interaction and real cloud Harness continuation remain pending, so the authorization lifecycle row stays open.

Actual Console refusal during an E2B/OpenCode/MiniMax task, original-Run completion explaining the refusal, exactly one report invocation and zero writes, unchanged tests, retained artifacts and confirmed cleanup: [cloud authorization refusal](evidence/2026-11-15-tool-authorization-denial.md). Together with GUI Tool expiry/reauthentication and both SDK regressions, this completes the authorization lifecycle row.

Actual Console configuration edit, invalid/valid E2B credential replacement, validation and enablement, disablement with SDK scheduling rejection, dependency-blocked deletion, Fleet cleanup of the real cloud resource and successful connection deletion with preserved shared-account credentials: [connection lifecycle GUI evidence](evidence/2026-11-15-connection-lifecycle-gui.md). Combined with the real-task API lifecycle journey, this completes the three connection lifecycle rows.

Active cloud cancellation exposed and fixed a detached-child termination defect. Real OpenCode/MiniMax rerun now confirms both Harness and child stopped before cancelled, and all nine Runtime tests pass on E2B Linux: [active cancellation evidence](evidence/2026-11-15-active-cloud-cancellation.md). The [fault branch audit](evidence/2026-11-15-fault-branch-audit.md) reconciles this with worker restart, Runtime loss, race/stale approval and resource-recovery evidence, completing the remaining fault row.

Pi 1.5.2 with the existing SiliconFlow international credential passed both independent SDK Web tasks, cross-language continuation, tool approvals, previews, event replay, retention and confirmed cleanup: [Pi / SiliconFlow evidence](evidence/2026-11-15-pi-siliconflow.md). The [execution matrix](execution-matrix.md) separates passed and pending combinations. The user deferred Daytona network configuration; its provider/full-matrix items remain open.

The [delivery audit](evidence/2026-11-15-delivery-audit.md) maps the source journey to evidence and rechecks five retained cloud journeys/eight primary Runs against current database bytes, hashes and events. All pass; original alternate-provider and complete-matrix requirements remain open pending the user-deferred Daytona connectivity condition.

Modal / OpenCode / SiliconFlow international passed both independent SDK Web journeys with authorization/approval, fixed tests, private previews, event replay, continuation, queued cancellation, retention and confirmed cleanup: [Modal evidence](evidence/2026-11-15-modal.md). This completes the alternate-provider row without changing the pending Daytona or full-combination matrix.


Blaxel / OpenCode / SiliconFlow international passed both independent SDK Web journeys, tool authorization/approval, fixed tests, private previews, cross-language continuation, retention and confirmed cleanup. Real GUI configuration CRUD also passed: [Blaxel evidence](evidence/2026-11-15-blaxel.md). This extends provider evidence; Pi/custom combinations and the later requested provider expansion remain active work. The earlier delivery audit has been updated to stop treating Daytona as the sole remaining dependency.

Modal and Blaxel Pi/custom dual-SDK expansion, explicit Blaxel endpoint cleanup, the post-run 39-resource absence audit and retained output/event/artifact verification are recorded in [expanded Harness matrix evidence](evidence/2026-11-15-expanded-harness-matrix.md). Earlier concurrent Blaxel preview failures remain a stability concern; the successful sequential runs are not evidence that this concern is resolved. The remaining provider expansion and deferred Daytona rows stay open.

Fly Sprites is registered and now has real GUI connection CRUD, Connector/Runtime/anonymous-auth checks, natural 90-second persistent-resource expiry, and OpenCode/SiliconFlow Web journeys through both SDKs with confirmed cleanup and retained-record audit. See [expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md). Pi/custom and sleep/recovery-specific cases remain open; this does not complete provider expansion.

Sprites Pi/SiliconFlow subsequently passed both independent SDK journeys and the retained-record audit. Upstash ephemeral private HTTP transport and a detached server passed real feasibility probes with confirmed resource deletion; Upstash remains unregistered pending production lifecycle/transport, GUI and SDK integration. See the latest entries in [expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md). Provider expansion remains active; Daytona remains explicitly deferred.

Sprites custom.python-agent/SiliconFlow also passed both SDK journeys. The combined retained audit passed 2 new journeys / 4 primary Runs, and all resources from these journeys and the Upstash probes were confirmed deleted. This completes the current three-Harness Sprites matrix; sleep/recovery and additional provider integration remain open.

Upstash is now registered: real Connector command/file/Runtime/auth/reconciliation checks, GUI credential CRUD, OpenCode/SiliconFlow dual SDK Web journeys and retained-record audit all passed, with confirmed resource deletion. See [Upstash evidence](evidence/2026-11-15-upstash.md). Pi/custom and provider-specific TTL/sleep/recovery verification remain open; this does not close provider expansion.

Upstash Pi/custom fresh dual SDK reruns subsequently passed after clarifying artifact paths; their two initial missing-artifact attempts remain failed evidence. A real native TTL probe did not establish timely deletion, so Upstash now uses the shared durable control-plane expiry workflow in addition to requesting native TTL; its 90-second managed-expiry cloud probe passed. The combined retained audit passed 2 journeys / 4 primary Runs. Vercel real create/execute/binary files/exact-name cleanup also passed, but private transport, Connector registration and GUI/SDK journeys remain pending. See [Upstash evidence](evidence/2026-11-15-upstash.md) and the [provider ledger](../docs/sandbox-providers.md).

Vercel is now registered with private binary HTTP transport and no public provider routes. GUI connection CRUD, Runtime/authentication, real 90-second managed expiry and OpenCode/SiliconFlow through both SDKs passed, with confirmed cleanup and independent retained-record audit. See [Vercel evidence](evidence/2026-11-15-vercel.md). Pi/custom and provider-specific recovery remain pending; the remaining supplier expansion is still active.

Vercel Pi/custom dual SDK journeys and combined retained audit passed; the initial Pi missing-report attempt remains failed evidence with confirmed cleanup. Agent37 is registered and has real primitives, account-header isolation, GUI CRUD, Runtime protocol/auth, 90-second managed expiry and OpenCode/SiliconFlow dual SDK evidence with confirmed cleanup. Its edge-reserved `/health` exposed a false-readiness defect, now fixed with a dedicated authenticated Runtime route and protocol verification. See [Vercel](evidence/2026-11-15-vercel.md) and [Agent37](evidence/2026-11-15-agent37.md). Provider expansion remains active.

Agent37 Pi and custom package fresh dual SDK journeys also passed using the dedicated Runtime health route; combined retained audit passed 2 journeys / 4 primary Runs, with confirmed cleanup. Seven non-deferred providers now have the current OpenCode/Pi/example-custom SiliconFlow matrix; Boat, Freestyle VMs and Fly Machines remain under expansion, and Daytona remains user-deferred.

Freestyle v5 VM Connector is registered and has actual primitives/private HTTP, GUI CRUD, Runtime protocol/auth, natural 90-second managed expiry and OpenCode/SiliconFlow dual SDK acceptance with retained audit and confirmed cleanup. Its private-probe attached firewall rule also returned 404 after VM deletion. Boat create returned billing_required before allocation; the user explicitly deferred billing and requested continuing other suppliers. See [Freestyle](evidence/2026-11-15-freestyle.md) and [Boat](evidence/2026-11-15-boat.md).

Freestyle Pi and custom Harness both completed dual SDK full journeys and confirmed cleanup; their combined retained audit passed 2 journeys / 4 primary Runs. Fly Machines real isolated App/network/VM plus command/binary-file primitives also passed, with whole test App deletion confirmed. Fly private transport/Connector/GUI/full journeys remain open. Boat and Daytona remain explicitly deferred by the user.


Fly Machines now has registered Connector, private binary HTTP/EOF/auth evidence, Runtime protocol checks, real 180-second managed whole-App expiry, GUI CRUD and 97 passing regression tests. The initial Runtime file-upload 413 was fixed by exec stdin; the failed App was deleted. See [Fly Machines evidence](evidence/2026-11-15-fly-machines.md). Full dual-SDK Harness journeys are in progress; Boat and Daytona remain user-deferred.


Fly Machines OpenCode, Pi and fresh custom Harness all passed both SDK full journeys with the pooled private proxy. The initial SSH timeout attempts and later custom first-preview failure remain failed evidence with confirmed cleanup; remote HTTP readiness fixes the preview startup boundary. Combined retained audit passed 3 journeys / 6 primary Runs, all successful test Apps were deleted, and no local Fly proxy processes remained. Full regression passed 37 files / 100 tests. See [Fly Machines evidence](evidence/2026-11-15-fly-machines.md). Nine non-deferred integration targets now have the current three-Harness dual-SDK matrix; Boat and Daytona remain explicitly deferred.


The final Fly provider audit independently re-read all 20 recorded test-owned App IDs from successful and failed attempts; every App returned HTTP 404. Together with the no-local-proxy process check, this confirms cleanup for the current expansion batch.


Final source-to-implementation audit found the Tool account/scope display requirement was not covered by earlier ready-state checks. The bounded metadata extraction and actual Console display are now implemented and browser-verified: [Tool identity evidence](evidence/2026-11-15-tool-verification-identity.md). All 29 passed matrix rows / 58 primary SDK Runs were independently rechecked against retained database bytes, hashes, test reports, terminal events and closed Sessions. Full regression passed 37 files / 103 tests. The [delivery audit](evidence/2026-11-15-delivery-audit.md) now reflects the complete expansion and the two explicitly deferred external conditions.

Boat's updated key cleared the former billing blocker. The Connector and Console configuration are implemented, but full SDK/Harness acceptance remains pending. Tests cover persisted asynchronous purge handles, reconstruction/reconciliation after a failed poll, blocked purges, unknown deletion outcomes, private preview credential isolation and truncated command output. Initial real Runtime startup failed and was cleaned up; the Boat localhost relay setting conflicted with the all-interface Runtime listener and has been removed for a fresh test. Do not count the foundational probe as a completed product journey.

Boat's updated-key integration is now accepted for OpenCode, Pi and registered custom Harness with SiliconFlow through both SDKs. GUI CRUD, Runtime protocol/auth, natural 90-second managed purge, independent retained-record checks and provider resource reconciliation are recorded in [Boat evidence](evidence/2026-11-15-boat.md). Initial concurrent attempts exceeded the account's two-instance trial cap and remain failed records; fresh serial attempts passed. The combined accepted matrix now has 32 journeys / 64 primary Runs across 10 non-deferred integration targets; current regression passed 38 files / 110 tests. Daytona remains user-deferred.

The known Blaxel concurrent-preview concern now has a reproduced 409 allocation race fix, a passing two-instance/four-caller probe, and fresh overlapping Pi/custom full dual-SDK journeys with Python previews and cleanup. Eight exact test-owned resources and associated endpoints were independently confirmed absent. See [Blaxel evidence](evidence/2026-11-15-blaxel.md). This supersedes the earlier open concurrency regression note for the tested scope, without reclassifying old failures or claiming exhaustive load testing. Full regression: 38 files / 111 tests; updated selected matrix: 32 combinations / 64 primary Runs independently audited.

## User-defined environment (2026-11-15)

Contract: Agent defaults plus Session overrides, frozen per Session; initialization and Harness/child-process injection use the shared execution path for any connector. Both SDKs expose `env`. Plaintext values must not appear in public resource responses or ordinary definitions; encrypted records must be tenant/purpose scoped. Invalid and reserved variables fail before provisioning. Native VM boot/image-build env and GUI editing are outside this increment.

Verification is recorded in `testing/evidence/2026-11-15-environment.md`; previous provider/model matrix results do not by themselves establish env-specific acceptance for every provider.


Managed Secret CRUD/rotation/disable, Connection references, Session HTTP bindings, protected model access, GUI and both SDKs are implemented. The common external proxy and Vercel native Header injection of delegated grants have real cloud evidence; full Pi and custom-Harness dual-SDK journeys passed. OpenCode's additional TypeScript journey passed, but its independent Python cloud allocation attempt failed and was cleaned up. E2B/Modal expansion attempts also failed before credential-path verification and were cleaned up. These results do not replace the historical provider matrix or count failed attempts as new secret-isolation coverage. See [Secret management acceptance](evidence/2026-11-15-secret-management.md) and [the API/deployment contract](../docs/secret-management.md).


The unified local startup/stop/restart workflow, actual ingress reachability display, and shipped Python/TypeScript protected quickstarts passed on 2026-11-16. GUI verification/enablement, protected HTTP, ordinary variables, real Agent replies and independent provider cleanup checks are recorded in [local journey evidence](evidence/2026-11-16-local-journey.md). The reusable configuration and local development ingress remain running for the user's own walkthrough.

2026-11-16 follow-up: Boat/OpenCode, E2B/OpenCode and Modal/Pi now have fresh credential-proxy dual-SDK Web journeys with independent retained-record audits and confirmed cleanup. Runtime preparation recovery and OpenCode report delivery were corrected; safe stage diagnostics were added. Historical failures are preserved with the limits of their evidence. See [provider recovery acceptance](evidence/2026-11-16-provider-recovery.md). Daytona remains user-deferred.

2026-11-16 Console redesign: Vercel/Geist reference styling, separated platform Sandbox and Agent integration configuration, and application-owned dialogs/selectors/menus/validation are implemented and browser-verified. Draft CRUD, Secret reference/rotation, keyboard/focus behavior, Fleet detail and narrow-view controls passed; all disposable records were cleaned. Final regression: 46 files / 124 tests. See [Console redesign evidence](evidence/2026-11-16-console-redesign.md) and [UI contract](../docs/console-design.md).

2026-11-16 Instabox: registered Connector and bilingual GUI/managed Secret configuration are implemented. Pi, OpenCode and the registered custom Python Harness each passed independent Python/TypeScript Web journeys with SiliconFlow international, using serial Sessions for the account’s one-machine quota. Custom Harness protected HTTP passed in both SDKs. Native expiry, managed expiry, Runtime auth, provider/model credential scans, retained-record audit (3 journeys / 6 primary Runs), and exact cleanup audit (13 cloud resource IDs) passed. Earlier SSH-hostname and concurrent-quota failures are preserved. See [Instabox acceptance](evidence/2026-11-16-instabox.md) and [capability boundaries](../docs/instabox.md). Daytona remains user-deferred.

2026-11-16 Instabox P0 follow-up: definitive quota refusal now terminates the Run and leaves a closable rejected intent; OpenSSH preflight runs during connection verification and before worker provisioning. Real SSH interruption, external deletion, lost create response, lost delete HTTP response before persistence, persisted delete-handle recovery, and Pi dual-SDK Web execution with an actual worker SIGKILL/recovery all passed. Same-machine recovery retained one create and one invocation. See [P0 evidence](evidence/2026-11-16-instabox-p0.md) for exact commands and simulation boundaries.

2026-11-16 Console onboarding follow-up: real-state setup guidance, provider search preserving drafts, prioritized lifecycle actions and Python/TypeScript SDK binding fragments passed focused static checks and bilingual browser review. A disposable credential-free Tool draft was created/deleted, and generated fragments were syntax/type-checked without cloud execution. See [Console onboarding evidence](evidence/2026-11-16-console-onboarding.md).

2026-11-16 API onboarding: navigation now separates Infrastructure, Operations and Agent capabilities. The new API & SDK page generates complete programs from real connections and Harness catalog selections. Twelve generated-program lifecycle tests plus five UI/i18n checks passed; fresh Python and TypeScript first-conversation cloud calls returned Agent answers and closed their Sessions, with independent provider absence verification. The initial proxy-reset attempt remains an explicitly uncertain create record (no matching machine observed), separately from the two successful calls. See [API/SDK onboarding evidence](evidence/2026-11-16-console-api-quickstart.md).

2026-11-18: Local automatic Console/SDK identity passed fresh Python and TypeScript cloud journeys, startup/restart and installed-package checks. See [local identity evidence](evidence/2026-11-18-local-automatic-identity.md). Infrastructure navigation, flat lists, dense Session detail and Tool catalog were revised and browser-reviewed in English and Chinese; see [Console evidence](evidence/2026-11-18-flat-console.md).

2026-11-18 complete Console body review: 17 page routes in both locales and at 390px, 86 localized configuration variants, chronological conversation UI, shared body hierarchy, and a fresh isolated GUI → Python multi-turn → Tool onboarding → TypeScript Tool-result journey. Both cloud Sessions closed with completed create/delete operations; artifact download remains available. See [complete Console review](evidence/2026-11-18-complete-console-review.md).

2026-11-18 readable-scale correction: shared 14px body/16px conversation hierarchy, Harness infrastructure navigation, self-hosted integration identity artwork and first-level API Playground with actual public-API submission. Evidence: [readable Console review](evidence/2026-11-18-console-readable-scale.md).


## OCI Harness acceptance — 2026-11-18

See [OCI evidence](evidence/2026-11-18-oci-harness.md). Image registration and immutable pinning are exposed through both SDKs and Console. Real Modal journeys passed for Python custom JSON protocol and TypeScript OpenCode, including continuation, env, Exa, artifact download and reconciled cleanup; Aider passed real model execution. Five actual local template binaries passed deterministic protocol fixtures. Only Modal is currently verified for native OCI; Pi/Claude recipes and private registry pulls are not labeled as real cloud acceptance.

2026-11-18 overflow/keyboard audit: 114 page-layout checks, 82 localized form checks and 14 Harness dialogs; actual Playground → Modal/OpenCode result → UI cleanup passed. Official DeepSeek Harness actual Docker binary passed deterministic two-turn/MCP execution; cloud execution is not claimed. See [audit evidence](evidence/2026-11-18-console-audit-deepseek.md).

2026-11-18 connection catalog and OpenAI protocol: 11 Sandbox icon choices, two model protocols, 33 named applications plus HTTP; real Python/OpenCode and TypeScript/Pi Vercel cloud Chat Completions journeys passed and cleaned up. [Evidence](evidence/2026-11-18-catalog-openai.md).

Current Harness delivery evidence: [real cloud and bilingual Console journey](evidence/2026-11-18-harness-delivery.md).

2026-11-18 local distribution and recovery: production-only compiled installation, fresh GUI → installed Python/TypeScript → Modal/OpenClaw journeys, automatic ingress process-loss recovery, full offline backup/restore, restored-workspace dual-SDK regression and native OpenClaw activity. See [scoped delivery evidence](evidence/2026-11-18-local-beta-delivery.md).

2026-11-19 appearance/serverless follow-up: Console system/light/dark appearance and provider-specific idle/wake/workspace preservation are implemented. Real cloud results, earlier failed probes, recovery boundaries and bilingual browser evidence are tracked in [appearance and serverless acceptance](evidence/2026-11-19-theme-serverless.md). See [the serverless contract](../docs/serverless-sessions.md); a provider capability declaration is not a substitute for its recorded live SDK result.

2026-11-19 Harness recovery expansion: Codex/Hermes/OpenClaw/OpenCode pause and automatic wake are tracked separately from Pi and historical single-turn acceptance. See [the per-SDK ledger](evidence/2026-11-19-harness-serverless-matrix.json) and [scope, attempts, UI review and cleanup](evidence/2026-11-19-harness-serverless-ui.md). Unsupported OCI connectors and unverified cells must not be presented as passes.
