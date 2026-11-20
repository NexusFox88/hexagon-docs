# Sandbox provider integration status

Updated 2026-11-16. The current supported scope is 11 integration targets across 10 vendors: Fly Sprites and Fly Machines have different resource and execution APIs. Authentication success, resource execution, registered Connector support, and full SDK acceptance are separate milestones.

| Integration | Current evidence | Next integration work |
| --- | --- | --- |
| Instabox | Registered; OpenCode, Pi and custom Harness dual-SDK journeys, GUI credentials, expiry and P0 recovery passed | Maintain regression coverage; account quota requires serial tests |
| E2B | Registered; full Python/TypeScript journeys across OpenCode, Pi and custom Harness | Maintain regression coverage |
| Modal | Registered; OpenCode, Pi and custom Harness/SiliconFlow dual SDK journeys; domain allowlist verified | Maintain regression coverage |
| Blaxel | Registered; real primitives, GUI CRUD and OpenCode, Pi and custom Harness/SiliconFlow dual SDK journeys passed | Concurrent caller and overlapping Pi/custom dual-SDK regressions passed; network allowlist unsupported |
| Fly Sprites | Registered; GUI CRUD, Runtime/private auth, natural expiry and OpenCode/Pi/custom SiliconFlow dual SDK journeys passed | Sleep/recovery semantics |
| Upstash Box | Registered; GUI CRUD, managed expiry, Runtime/auth and OpenCode/Pi/custom SiliconFlow dual SDK journeys passed; deletion confirmed | Sleep/recovery-specific cases |
| Vercel Sandbox | Registered; GUI CRUD, private transport, Runtime/auth, managed expiry and OpenCode/Pi/custom SiliconFlow dual SDK journeys passed | Provider-specific recovery cases |
| Agent37 | Registered; GUI CRUD, private transport, Runtime protocol/auth, managed expiry and OpenCode/Pi/custom SiliconFlow dual SDK journeys passed | Provider-specific fault/sleep cases |
| Boat | Registered Connector; GUI CRUD, Runtime/auth, 90-second managed purge and all three Harness dual-SDK journeys passed | Trial limit: two concurrent Sandboxes; run dual-SDK acceptance combinations serially |
| Freestyle VMs | Registered v5 Connector; primitives, private PTY HTTP, Runtime/auth, managed expiry, GUI CRUD and OpenCode/Pi/custom dual SDK journeys passed | Provider-specific recovery/fault cases |
| Fly Machines | Registered; isolated App/network, pooled private HTTP, files, Runtime/auth, GUI CRUD, managed expiry and OpenCode/Pi/custom dual SDK journeys passed | Provider-specific recovery/fault cases |

Read-only audit evidence: `.local/provider-audit/results.json` and `.local/provider-audit/vercel.json`. These are historical account-access observations, not evidence of successful resource allocation for the remaining providers. No new billing/subscription settings were enabled by this audit.

## Engineering boundaries

The API, worker and acceptance harness use `integrations/sandboxes/registry.ts`. Each provider owns account authentication, creation reconciliation, resource inspection, file/process primitives, and private ingress. Harness installation and model execution remain provider-independent above `SandboxConnector`.

A provider must not silently weaken a requested policy. Unsupported network allowlists fail before allocation. Hibernation is not deletion; a persistent provider needs explicit resource expiry/reconciliation semantics. GUI shows per-provider configuration and stores credentials in the control plane. The public preview broker enforces tenant/session/grant ownership and never sends account keys or provider preview tokens to the browser.

The next implementation order is Sprites, Upstash Box/Vercel, Agent37/Boat/Freestyle, then lower-level Fly Machines. Existing account limitations may change execution order without reducing acceptance requirements.

Vercel uses official SDK 4.0.0 for the current probe in the existing sandbox-cost-bench project. The first attempt created compute and executed commands/files but its list query omitted the required `sortBy: name` alongside `namePrefix`; a follow-up exact-name reconciliation confirmed deletion (`vercel-hexagon-3d7fdb88-87d5-4fde-a5ae-86ade55af56b.json.reconciliation.json`). Corrected fresh probe `vercel-hexagon-67921a85-9b76-4379-ad7a-19cda77e1a24.json` passed and confirmed deletion. Neither result is full Connector acceptance. See the [official SDK](https://github.com/vercel/sandbox) for authentication and lifecycle contracts; local probes use per-call credentials and do not publish or modify deployments.

## Sprites implementation and remaining verification

Sprites is registered in the shared API/worker registry and Console. Real Connector validation passed creation, exact-name lookup, file transfer, Runtime bootstrap, anonymous rejection and control-plane deletion after a natural 90-second deadline. GUI create/validate/enable/edit/delete also passed. OpenCode, Pi and custom Harness/SiliconFlow passed both independent SDK journeys, including private previews, tools/approvals, artifacts, continuations and cleanup. Sleep/recovery behavior remains unverified.

## Upstash transport feasibility

The official [Ephemeral Box API](https://upstash.com/docs/box/overall/ephemeral-box) supplies provider-enforced TTL and interactive exec but no public preview URLs. A real probe now carries private HTTP through an authenticated exec session using the existing stdio-to-TCP helper. Both length-delimited and EOF-delimited 256 KiB binary responses, application-authentication rejection and local listener release passed. A second probe starts an HTTP server through ordinary exec with detached process/stdio, then verifies it remains reachable after the initiating command has returned. Both test boxes were deleted with provider absence confirmed.

The registered Connector now uses this transport with bounded buffers and explicit failure handling. Real Connector checks cover command exit 127, remote timeout exit 124, binary files, Runtime bootstrap, unauthorized 401, reconstruction/exact operation reconciliation and confirmed deletion. Console CRUD and OpenCode/SiliconFlow through both SDKs also passed. A natural provider TTL probe did not confirm deletion within 90 seconds of its deadline, so the Connector now uses the shared durable control-plane expiry mechanism as well as requesting native TTL; a real 90-second managed-expiry probe passed. Pi and the example custom Harness subsequently passed fresh dual SDK journeys after artifact-path instructions were clarified. Provider-specific sleep/recovery cases remain open. The provider's built-in agent runner is unused: Hexagon's existing Harness/Runtime boundary remains responsible for execution. Exact journals are recorded in the expanded matrix evidence.

The selected private transport is `sprites-transport.ts`, using an authenticated command's stdio as a loopback TCP tunnel. The remote helper receives only a port; provider credentials remain in the control plane. Remote EOF becomes process exit, resolving the observed completion problem with unframed HTTP responses in the upstream SDK proxy. Two real command-transport probes passed explicit-length and EOF-delimited responses plus independent Runtime authentication. Local regressions cover binary integrity, closed listeners, late connection cleanup and shared request-scoped release. This does not claim an upstream SDK fix.

Sprites preserves disk while sleeping; its managed services restart on wake ([official lifecycle documentation](https://docs.sprites.dev/working-with-sprites/)). Hexagon uses bounded detached executions for arbitrary background commands so they are not automatically replayed. A unique remote startup marker and separate Runtime health check confirm startup. Nonzero command exits are normalized from the SDK's ExecError; network failures remain uncertain.

Published [create](https://docs.fly.io/sprites/api/sprites/create-a-sprite) and [update](https://docs.fly.io/sprites/api/sprites/update-a-sprite) schemas do not expose resource expiry. Hexagon records the deadline before creation and reconciles expiry independently of active execution, including after restart. It fences old workers, rejects new work/previews, and confirms deletion before terminal cancellation. The GUI states that a stopped control plane cannot enforce timely cloud deletion. Sleeping resources are never treated as deleted.

Evidence and exact private journals: [expanded matrix](../testing/evidence/2026-11-15-expanded-harness-matrix.md). The earlier full-run failure caused by nonzero-exit handling remains failed historical evidence; its resources were cleaned.

## Agent37 and next providers

Agent37 now has registered Connector and GUI CRUD, base-image commands/files, private HTTP with account-header removal verified in the guest, independent Runtime authentication, durable 90-second expiry, and all three current Harnesses through both SDKs. See [Agent37 evidence](../testing/evidence/2026-11-15-agent37.md). Dedicated Runtime health avoids the provider edge's reserved `/health` path.

Boat integration research uses the [official API](https://docs.boat.dev/api/v1) and [hosting contract](https://docs.boat.dev/hosting). Creation must set `noEnv: true` to avoid inheriting account secrets, use the operation ID as Idempotency-Key, and reconcile exact names/labels with pagination. Provider TTL stops compute but preserves snapshots; final cleanup must use confirmed asynchronous deletion, not just stop. Private hosted ports can use the `_port_auth` cookie in the control-plane proxy without exposing the provider URL/token to browsers. These are implementation requirements, not executed Boat acceptance. Freestyle VMs has completed the current three-Harness dual-SDK matrix. Fly Machines is registered with private HTTP, Runtime/auth, GUI CRUD and managed whole-App expiry; its current three-Harness dual-SDK journeys and retained-record audit have passed.

## Future candidates

Daytona was removed from current compatibility by user direction on 2026-11-16. It is absent from the public provider catalog and new-connection Console selector. Its prototype and historical acceptance attempts remain available for future evaluation, and the internal factory retains historical resource reconciliation/cleanup. It is not a current acceptance blocker. Promotion requires renewed full dual-SDK acceptance before registration.

## Credential setup discovery

The Console catalog exposes a `setup_url` for each supported adapter, separate from capabilities and historical verification. Links target provider-owned account/setup documentation: [E2B](https://e2b.dev/dashboard?tab=keys), [Modal](https://modal.com/docs/cli/latest/token), [Instabox](https://instabox.sh/docs/api.md), [Boat](https://boat.dev/), [Fly Machines](https://docs.fly.io/security/tokens), [Sprites](https://fly.io/sprites/), [Freestyle](https://www.freestyle.sh/docs), [Agent37](https://www.agent37.com/), [Blaxel](https://docs.blaxel.ai/Get-started), [Vercel](https://vercel.com/docs/rest-api), and [Upstash Box](https://upstash.com/docs/box/overall/quickstart). Scoped workspace/project permissions and current allocation quota still require account-specific checks; a successful listing request alone is not comprehensive permission verification.

2026-11-16 product completion regression: Instabox management connectivity was intermittent (`ECONNRESET`), and two creation attempts remain unconfirmed despite empty exact-operation resource queries. They remain visible for manual review; neither an empty list nor operator acknowledgement establishes non-allocation. One earlier delayed resource was found and its deletion independently confirmed. This current limitation is separate from the historical successful harness matrix. Private IDs/evidence are retained under `.local/product-completion`; public progress evidence records the limits without claiming cleanup of unknown resources.

## Execution prerequisites found by the MiniMax matrix

Historical provider-wide journey records above are scoped to their original Harness, model and protocol. The expanded plan is in `testing/minimax-compatibility-plan.json`; unrun combinations are not verified.

- E2B: Public OCI Harnesses are built into Session-owned E2B templates at 4096 MiB; template/build receipts and cleanup use the resource operation ledger. Individual image/Harness combinations require separate evidence. For builtin installations, OpenCode requires a template with at least 2 GiB of memory. The default base template is not assumed to meet that requirement. The SDK owns its network dispatcher, so its connector explicitly forwards operator proxy selection.
- Freestyle: filesystem writes are root-owned with mode 0600. The connector explicitly executes foreground and background commands as guest `root`, rather than inheriting the provider default (which can be uid 1000). This keeps Runtime files private and readable by the process that uses them.

## Serverless lifecycle update — 2026-11-19

The earlier Ephemeral Box/TTL-only notes above describe historical acceptance. New Upstash workspaces use persistent Box pause/resume; Instabox and Freestyle rely on the control plane's active-runtime deadline so sleeping resources are not deleted by a wall-clock TTL. Vercel uses persistent Sandboxes. Boat enables snapshots and retains a bounded active TTL for trial compatibility. See [serverless strategies and acceptance command](serverless-sessions.md) for the current per-provider contract, Runtime cache preservation, native snapshot handling, and the distinction between explicit suspension and provider-managed standby.
