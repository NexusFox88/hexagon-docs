# Modal and Blaxel Harness expansion — 2026-11-15

The original journey requires actual records for advertised execution combinations. These tests use independent tenants/schemas and cloud resources; the user-owned local Console is not the test environment. Fixed fixture assertions are unchanged.

## Modal / Pi 1.5.2 / SiliconFlow international: passed

Command: `NODE_USE_ENV_PROXY=1 HEXAGON_SANDBOX=modal HEXAGON_HARNESS=pi HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_MODEL=siliconflow npx tsx tooling/smoke-api.ts`.

Private journal `.local/evidence/api-smoke-7e5a8c32-61c9-4c18-9252-a7e896864da9.json`, 07:34:08–07:41:03 UTC. Both independent SDK Web tasks completed, both passed 8 unchanged assertions. Tool authorization/approval, preview, event replay (1320 TypeScript events), same-session/cross-language continuation, queued cancellation and retained artifacts passed. Product and provider cleanup confirmed.

## Modal / custom.python-agent 1.0.0 / SiliconFlow international: passed

Command: same as above with `HEXAGON_HARNESS=custom`.

Private journal `.local/evidence/api-smoke-bc3dd50f-5416-46a9-a5f7-dbb42507c006.json`, 07:36:59–07:44:06 UTC. Tenant-owned source package registered through the SDK and executed inside Modal; both independent SDK tasks passed 8 unchanged assertions, authorization/approval, preview, replay (17 TypeScript events), continuations, queued cancellation, retention and confirmed cleanup. This record verifies the exact persisted package digest, not arbitrary custom code.

## Blaxel: earlier failed attempts retained

- Pi initially failed native Node version verification (`api-smoke-259d7c0b-4551-4191-9632-2c11a22fc28d`). The adapter now uses a compatible native Node >=22 when supplied by the image, preserving the pinned Node 22.19.0 fallback for older images. Deterministic tests cover both branches.
- After that fix, Pi completed the actual task, tools and 8 fixed assertions, but external preview failed (`api-smoke-6db1eb82-087c-495c-b0ec-dfe6efb7eb94`, `api-smoke-4747e375-4555-4763-a111-9c1c8e56beee`). The latter confirmed the instance-local IPv4 application returned 200 with expected content while the public broker returned 502.
- Custom Harness first omitted exported test-report.txt (`api-smoke-4a713e2b-a89f-4b19-8aa8-8b845365eca7`). Its example instructions now explain that only the artifact directory is exported and require checking all requested deliverables before finishing. A subsequent task reached the same external-preview failure (`api-smoke-bd941b0d-757f-41b9-bafb-a8da2dfdfd8d`).
- Failed journey resources were cleaned and confirmed absent. No failures were relabeled successful. Blaxel preview transport remediation remains under test.

Local regression before preview transport changes: 25 TypeScript files / 68 tests passed; 9 Python Runtime tests run, one Linux-only case skipped on macOS. Preview transport has a separate real-socket IPv6-to-IPv4 binary HTTP test.

## Preview resource cleanup and current regression

Blaxel returned a concrete preview quota error (`20/20 previews`) even though earlier compute resources were terminated. Compute absence was therefore insufficient cleanup evidence. The connector now explicitly lists/deletes/rechecks associated previews, and Session close invokes that boundary even for absent compute. A failed associated-resource cleanup leaves the same deletion operation unknown and the Session closing; a database regression verifies recovery without redundant compute deletion.

A sweep restricted to exact test-owned IDs from private journals and tenant-scoped resource-operation records confirmed 35 compute resources and their preview endpoints absent (`.local/evidence/blaxel-preview-cleanup.json`). This is a point-in-time audit before the next isolated run, not a claim about future runs or unrelated account resources.

An IPv6-only listener on the application's original port forwards to IPv4-only applications. The real primitive probe `blaxel-a6614a54-8a71-4c64-84cc-79d389b7cd16.json` passed private preview and cleanup. Expanded Pi/custom attempts `api-smoke-b7313fe6-5de3-4dd6-8445-96ffdf8022f6.json` and `api-smoke-894321bd-66fb-4354-9be1-c6746e065e98.json` passed their TypeScript task/preview/continuation but failed the independent Python preview assertion. They remain failed; one initial fallback cleanup required the subsequent owned-resource sweep. Python failure checkpoints now capture HTTP status and internal listener observations without credentials or preview tokens, and the fallback invokes associated-resource cleanup even when compute is already absent.

After these changes, `npm run check` passed; all 26 TypeScript test files / 71 tests passed. Python Runtime: 9 tests run, 1 Linux-only skip on macOS; IPv6 bridge: 1 real socket regression passed. Local socket tests require local network permission. The user-facing service was restarted after confirming its worker idle, preserving existing data and credential files; API, database, credential checks and worker were ready afterward.

## Blaxel / Pi 1.5.2 / SiliconFlow international: passed

Sequential full rerun `.local/evidence/api-smoke-ca4e7444-7317-48a3-a4fc-3f57347f73a6.json`, 08:14:15–08:17:42 UTC, passed both independent SDK journeys, each with 8 unchanged assertions, authorization/approval, actual private previews, exact event replay (TypeScript 1240 events; Python 1468), same-session and bidirectional SDK continuation, queued cancellation, retained artifacts and confirmed product/provider cleanup. No fixture assertions or model-task requirements were relaxed. The earlier concurrent runs' Python preview failures remain unresolved as a stability concern; this sequential pass does not prove concurrent preview reliability.

## Blaxel / custom.python-agent 1.0.0 / SiliconFlow international: passed

Sequential full rerun `.local/evidence/api-smoke-ebd73f3f-3d32-496f-a712-4dacf81d0156.json`, 2026-11-15T08:18:01.678Z–2026-11-15T08:21:35.096Z, passed both independent SDK Web tasks and fixed assertions, tool authorization/approval, private previews, replay, bidirectional continuation, cancellation, retained artifacts and product/provider cleanup. The TypeScript stream contained 17 events. This certifies the registered example package and tested protocol, not arbitrary source packages; earlier concurrent preview failures remain documented above.

## Sprites transport probe: incomplete

`tooling/probe-sprites.ts` now checks binary file roundtrip, a provider-managed HTTP service, and arbitrary private-port forwarding while preserving a separate Runtime Authorization header. The real attempt `sprites-hexagon-57941b75-ed52-4d58-9363-446cb546b6db.json` passed creation, command execution, a 256 KiB binary roundtrip, service startup and authenticated in-instance HTTP. The official SDK local proxy fetch timed out. This does not identify a credential or account failure: the tunnel path needs further diagnosis. Both diagnostic instances were deleted and absence confirmed. No full Connector or SDK journey is claimed.

## Post-run reconciliation

After both sequential Blaxel runs finished, `NODE_USE_ENV_PROXY=1 npx tsx tooling/cleanup-blaxel-previews.ts` confirmed all 39 recorded test-owned compute resources and associated preview resources absent at 08:22:35 UTC. Both Sprites diagnostic attempts separately confirmed deletion. No active acceptance runs remained during this sweep. The earlier failed Pi journal's initial `requires_reconciliation` is preserved as historical evidence; the later sweep establishes confirmed absence.

`npx tsx tooling/audit-retained-journeys.ts api-smoke-ca4e7444-7317-48a3-a4fc-3f57347f73a6 api-smoke-ebd73f3f-3d32-496f-a712-4dacf81d0156` passed for 2 journeys / 4 primary Runs. It verified persisted completion/output, exact artifact bytes and hashes, event consistency and completed resource operations, independently of transient test stdout. Private audit: `.local/evidence/retained-journey-audit.json`.

## Sprites private transport diagnosis and shared cleanup boundary

A phase-only WebSocket trace in `sprites-hexagon-6ff693b6-1d3c-47b9-bc35-38b794240da6.json` established successful upgrade, a text handshake response and 107 bytes of binary HTTP data. The fetch still timed out waiting for body completion; this is not evidence of rejected credentials. The diagnostic server originally used EOF-delimited HTTP/1.0 responses. With an explicit Content-Length, `sprites-hexagon-dddd39ac-51f5-4831-8268-486b8b08235d.json` passed both authenticated 200 and missing-Runtime-auth 401 through the provider-authenticated private tunnel, plus 256 KiB file roundtrip and service execution. All diagnostic instances were deleted and absence confirmed. No payload/header/credential bytes are included in the transport trace. EOF-delimited response completion remains a transport limitation to resolve before broad HTTP claims.

Shared control-plane support now makes HTTP-target cleanup explicit: leased Runtime endpoints are released after body consumption or failure and are reacquired on the next call. The preview proxy releases once on delivery, rejected external redirect or client disconnect, aborting the upstream on disconnect. Regression tests use a delayed Runtime response and real local HTTP/browser-disconnect transport. Stable targets remain cached, preserving the current cloud connectors' behavior. This is preparation for Sprites integration, not a new registered provider.

Verification after request-scoped target cleanup: `npm run check` and `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm test` passed (26 files / 73 tests, 08:28:54 UTC). The local control plane was restarted only after confirming its worker idle. At 08:30:03 UTC, API, database, credential roundtrip/stored-record check and worker were ready; existing configuration and secrets were retained.

## Sprites EOF-capable transport — verified

`NODE_USE_ENV_PROXY=1 HEXAGON_SPRITES_TRANSPORT=command npx tsx tooling/probe-sprites.ts` passed against a real private Sprite twice: `sprites-hexagon-a0efa883-30f2-4e1c-b97a-4060404c7c80.json` (initial implementation), then `sprites-hexagon-9cd11376-7d22-4435-85dd-f14a13cf5bbe.json` (extracted integration module with bounded handshake). Both include file roundtrip, provider-managed service, internal HTTP, correct/missing Runtime Authorization, and HTTP/1.0 body completion without Content-Length. Both confirmed resource deletion. This resolves the selected transport's EOF handling; the earlier upstream SDK proxy failures remain historical failures.

`command-tunnel.ts` owns the local listener and each remote command. It releases late-starting commands even after the request has gone away; `sprites-transport.ts` bounds handshake time and asks the provider to allow at most one second of post-disconnect execution for this relay. The Python helper targets only sandbox loopback and receives no provider credential. Generic local TCP tests verify exact 256 KiB binary EOF-delimited delivery, listener closure, idempotent release and cleanup of a late command. `npm run check` passed and the full database-backed suite passed 27 files / 75 tests at 08:34:58 UTC; typecheck and the final real cloud probe also passed after extraction. Persistent-resource deadline enforcement and sleep/restart behavior remain required before catalog registration.

## Sprites registered Connector and durable expiry

The Connector now implements private create, exact operation-name reconciliation, inspection (including cold/warm resources), observed command exits, bounded background commands, file transfer, EOF-capable private transport and absence-confirmed deletion. It declares control-plane expiry, with deadline persisted before creation. A database regression covers lost create response, no early deletion, expired submission rejection with preserved idempotency, lease fencing, approval invalidation, delete failure, restart recovery, retained completed output and exactly-once cancellation events. Preview regression rejects expired resources before the sweeper changes Session state.

Real primitive attempt `sprites-00d0ac94-d2e9-45a0-bcfc-61a42fbd0e2c.json` failed waiting for an upstream session_info notification that was not emitted. Startup now uses a unique shell marker and subsequent Runtime health verification. Rerun `sprites-f83caa95-2a8a-4e2f-89b5-25f40f2d8117.json`, 08:44:39–08:46:12 UTC, passed actual provisioning, file roundtrip, Runtime protocol 1, anonymous 401, natural 90-second expiry, product Session closure and provider absence. Private schema/journal/key are retained for audit. This is a lifecycle primitive, not full Harness acceptance.

GUI acceptance through ego-browser on local Console passed creation with memory/CPU and private credential fields, real provider validation, enablement, configuration read-back, memory update from 2048 to 3072 invalidating validation/enablement, and deletion. Credentials were masked; no account was deleted. The named test connection was removed, returning Console to its prior empty connection list.

First complete OpenCode/SiliconFlow attempt `api-smoke-bbd5153e-68e8-451e-b001-f4b6e2e75a29.json` timed out during provisioning and confirmed cleanup. Diagnosis established live Runtime but no Harness installation: upstream ExecError for a missing executable was being misclassified as transport uncertainty. The adapter now returns its observed stdout/stderr/exit code and preserves true transport exceptions. Two local regressions distinguish these cases. The fresh full journey remains separate evidence; no failed attempt is relabeled successful.

After registry/GUI integration and the observed-command-exit correction, `npm run check` and the complete isolated database-backed suite passed at 08:57 UTC: 29 files / 78 tests. The GUI test connection was deleted, and the local service was refreshed while idle to load the corrected adapter. The fresh full Sprites SDK attempt is tracked independently; this regression result does not certify its model task.

## Sprites / OpenCode 1.2.27 / SiliconFlow: both SDKs passed

`NODE_USE_ENV_PROXY=1 HEXAGON_SANDBOX=sprites HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_MODEL=siliconflow npx tsx tooling/smoke-api.ts` completed successfully. Journal `.local/evidence/api-smoke-810a0e7d-0169-4dd2-97b7-7eec5ccf6345.json`, 08:55:28–09:00:02 UTC. Both independent SDK tasks completed and passed the unchanged 8 assertions, actual requirement/report tools with authorization/approval, artifact byte/hash checks, private Web previews, exact event replay (683 TypeScript / 937 Python events), same-session and bidirectional SDK continuation, queued cancellation, retained outputs/artifacts and confirmed product/provider cleanup. It uses the normal registered Connector and worker, including durable control-plane deadlines; it does not claim a GUI-first model task on this provider.

`npx tsx tooling/audit-retained-journeys.ts api-smoke-810a0e7d-0169-4dd2-97b7-7eec5ccf6345` independently passed 1 journey / 2 primary Runs against persisted output, artifact bytes/hashes, terminal events and completed resource operations. The first failed full attempt and failed startup probe remain failed records; both confirmed cleanup. Pi/custom and sleep/restart-specific cloud cases remain pending.

## Sprites / Pi 1.5.2 / SiliconFlow: both SDKs passed

`NODE_USE_ENV_PROXY=1 HEXAGON_SANDBOX=sprites HEXAGON_HARNESS=pi HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_MODEL=siliconflow npx tsx tooling/smoke-api.ts` passed. Journal `.local/evidence/api-smoke-034ad255-c96b-44ec-aa3c-21a8f999f9f1.json`, 09:05:29–09:10:34 UTC. The independent TypeScript and Python tasks passed unchanged fixed tests, real requirement/report Tool authorization and approval, private previews, artifacts, replay (408 TypeScript / 1117 Python events), bidirectional continuation, queued cancellation, retention and confirmed product/provider cleanup.

`npx tsx tooling/audit-retained-journeys.ts api-smoke-034ad255-c96b-44ec-aa3c-21a8f999f9f1` passed 1 journey / 2 primary Runs, verifying retained results, artifact bytes/hashes, terminal events and completed resource operations. No new GUI-first or sleep/recovery behavior is inferred from this matrix expansion.

## Upstash private transport and detached server: feasibility passed

`NODE_USE_ENV_PROXY=1 npx tsx tooling/probe-upstash-transport.ts` passed at 09:07:35–09:07:51 UTC; private journal `.local/evidence/upstash-transport-hexagon-c4e1bac7-51fb-44a8-835f-7bce4533c5bf.json`. The authenticated exec-session relay carried exact 256 KiB binary HTTP bodies with both Content-Length and close-delimited framing. Application authentication remained independent (unauthorized request returned 401), and releasing the tunnel closed the local listener. The cloud resource was deleted and absence confirmed.

`NODE_USE_ENV_PROXY=1 HEXAGON_UPSTASH_DETACHED=1 npx tsx tooling/probe-upstash-transport.ts` repeated these checks with a detached server launched through ordinary exec, at 09:09:07–09:09:24 UTC; journal `.local/evidence/upstash-transport-hexagon-6f03e152-4d98-4f7f-bd61-e822fcbeeabe.json`. The startup command returned before separate readiness and relay requests; the server remained alive. Cleanup was again confirmed. This is not a full Runtime bootstrap, process-recovery or arbitrary long-lived background-command guarantee. No Upstash Connector is registered yet; production buffering, lifecycle and GUI/SDK integration remain pending.

## Sprites / custom.python-agent 1.0.0 / SiliconFlow: both SDKs passed

`NODE_USE_ENV_PROXY=1 HEXAGON_SANDBOX=sprites HEXAGON_HARNESS=custom HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_MODEL=siliconflow npx tsx tooling/smoke-api.ts` passed at 09:10:27–09:14:55 UTC. Private journal `.local/evidence/api-smoke-b11a766d-7400-4089-abb8-c8e6bdcdaff7.json`. Both independent SDK tasks used the registered custom package, real model and normal worker/Connector. Fixed tests, authorization/approval, previews, artifacts, exact event replay (17 events per primary task), bidirectional continuation, cancellation, retention and product/provider cleanup all passed. This certifies the example package, not arbitrary custom code.

Final `npx tsx tooling/audit-retained-journeys.ts api-smoke-034ad255-c96b-44ec-aa3c-21a8f999f9f1 api-smoke-b11a766d-7400-4089-abb8-c8e6bdcdaff7` passed 2 journeys / 4 primary Runs. Both new Sprites journeys and both Upstash feasibility probes confirmed cleanup. `npm run check` passed after the new probe was finalized. No production behavior changed in this expansion, so the earlier 29-file / 78-test regression result was not presented as a new run.

Local service verification at 09:13 UTC returned 200 for `/health/live`, authenticated `/v1/health` and `/console/`; API/database/credential checks were ready and the worker running. User configuration and local services were retained. Sprites sleep/recovery and the remaining provider integrations remain open.
