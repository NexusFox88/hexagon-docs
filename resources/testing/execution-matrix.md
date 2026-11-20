# Execution combination acceptance matrix

This is an evidence map, not a replacement for the source journey or the acceptance ledger. The public catalog lists registered adapters and capabilities; it does not imply every combination has passed. A new combination uses a new Session with pinned versions and resource bindings. Unknown/unverified rows stay open.

Current expanded scope: [MiniMax matrix plan](minimax-compatibility-plan.json) enumerates 11 cloud providers, built-in engines and OCI templates across Anthropic, OpenAI Chat Completions and OpenAI Responses. The historical rows below do not certify untested protocols or images. Run `npm run verify:compatibility -- <private-config.json>` as described in [the runner guide](compatibility-runner.md).

| Harness | Cloud Sandbox | Model endpoint tested | Python / TypeScript full Web tasks | Evidence |
| --- | --- | --- | --- | --- |
| OpenCode 1.2.27 | E2B | MiniMax | Both passed | [Python journey](evidence/2026-11-15-python-web-journey.md), [GUI initialization](evidence/2026-11-15-gui-initialization.md), [Python GUI task](evidence/2026-11-15-python-gui-journey.md) |
| OpenCode 1.2.27 | E2B | SiliconFlow international | Both passed | [SiliconFlow journey](evidence/2026-11-15-siliconflow-web-journey.md) |
| Pi 1.5.2 | E2B | MiniMax | Both passed | [Pi journey](evidence/2026-11-15-pi-harness.md) |
| Pi 1.5.2 | E2B | SiliconFlow international | Both passed | [Pi / SiliconFlow journey](evidence/2026-11-15-pi-siliconflow.md) |
| Registered custom.python-agent 1.0.0 | E2B | SiliconFlow international | Both passed | [Custom package journey](evidence/2026-11-15-custom-harness.md) |
| OpenCode 1.2.27 | Modal | SiliconFlow international | Both passed | [Modal journey](evidence/2026-11-15-modal.md) |
| Pi 1.5.2 | Modal | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md) |
| Registered custom.python-agent 1.0.0 | Modal | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md) |
| OpenCode 1.2.27 | Blaxel | SiliconFlow international | Both passed | [Blaxel journey](evidence/2026-11-15-blaxel.md) |
| Pi 1.5.2 | Blaxel | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md) |
| Registered custom.python-agent 1.0.0 | Blaxel | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md) |
| OpenCode 1.2.27 | Fly Sprites | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md): GUI CRUD, natural expiry and both independent SDK journeys |
| Pi 1.5.2 | Fly Sprites | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md): independent SDK tasks and retained-record audit |
| Registered custom.python-agent 1.0.0 | Fly Sprites | SiliconFlow international | Both passed | [Expanded matrix](evidence/2026-11-15-expanded-harness-matrix.md): independent SDK tasks and retained-record audit |
| OpenCode 1.2.27 | Upstash Box | SiliconFlow international | Both passed | [Upstash evidence](evidence/2026-11-15-upstash.md): GUI CRUD and independent SDK journeys |
| Pi 1.5.2 | Upstash Box | SiliconFlow international | Both passed | [Upstash evidence](evidence/2026-11-15-upstash.md): corrected artifact-path guidance, fresh full rerun and retained audit |
| Registered custom.python-agent 1.0.0 | Upstash Box | SiliconFlow international | Both passed | [Upstash evidence](evidence/2026-11-15-upstash.md): absolute artifact path in example package, fresh rerun and retained audit |
| OpenCode 1.2.27 | Vercel Sandbox | SiliconFlow international | Both passed | [Vercel evidence](evidence/2026-11-15-vercel.md): private transport, GUI, managed expiry and both SDK tasks |
| Pi 1.5.2 | Vercel Sandbox | SiliconFlow international | Both passed | [Vercel evidence](evidence/2026-11-15-vercel.md): fresh rerun after artifact-delivery clarification |
| Registered custom.python-agent 1.0.0 | Vercel Sandbox | SiliconFlow international | Both passed | [Vercel evidence](evidence/2026-11-15-vercel.md): full task, preview, tools, retention and cleanup |
| OpenCode 1.2.27 | Fly Machines | SiliconFlow international | Both passed | [Fly evidence](evidence/2026-11-15-fly-machines.md): pooled private proxy, full tasks, audit and cleanup |
| Pi 1.5.2 | Fly Machines | SiliconFlow international | Both passed | [Fly evidence](evidence/2026-11-15-fly-machines.md): full tasks, audit and cleanup |
| Registered custom.python-agent 1.0.0 | Fly Machines | SiliconFlow international | Both passed | [Fly evidence](evidence/2026-11-15-fly-machines.md): first-preview readiness fix, full tasks, audit and cleanup |
| OpenCode 1.2.27 | Freestyle VMs | SiliconFlow international | Both passed | [Freestyle evidence](evidence/2026-11-15-freestyle.md): private PTY transport, full task, GUI CRUD and expiry |
| Pi 1.5.2 | Freestyle VMs | SiliconFlow international | Both passed | [Freestyle evidence](evidence/2026-11-15-freestyle.md): full tasks, private preview, audit and cleanup |
| Registered custom.python-agent 1.0.0 | Freestyle VMs | SiliconFlow international | Both passed | [Freestyle evidence](evidence/2026-11-15-freestyle.md): full tasks, private preview, audit and cleanup |
| OpenCode 1.2.27 | Agent37 | SiliconFlow international | Both passed | [Agent37 evidence](evidence/2026-11-15-agent37.md) |
| Pi 1.5.2 | Agent37 | SiliconFlow international | Both passed | [Agent37 evidence](evidence/2026-11-15-agent37.md): dedicated Runtime health route, full task and cleanup |
| Registered custom.python-agent 1.0.0 | Agent37 | SiliconFlow international | Both passed | [Agent37 evidence](evidence/2026-11-15-agent37.md): full task, preview, Tools, retention and cleanup |
| OpenCode 1.2.27 | Boat | SiliconFlow international | Both passed | [Boat evidence](evidence/2026-11-15-boat.md): serial full journey, retained audit and confirmed cleanup |
| Pi 1.5.2 | Boat | SiliconFlow international | Both passed | [Boat evidence](evidence/2026-11-15-boat.md): serial full journey, retained audit and confirmed cleanup |
| Registered custom.python-agent 1.0.0 | Boat | SiliconFlow international | Both passed | [Boat evidence](evidence/2026-11-15-boat.md): GUI CRUD, Runtime/auth, managed purge and retained audit |
| OpenCode 1.2.27 | Instabox | SiliconFlow international | Both passed (serial, one-machine quota) | [Instabox evidence](evidence/2026-11-16-instabox.md) |
| Pi 1.5.2 | Instabox | SiliconFlow international | Both passed (serial); worker SIGKILL recovery passed | [Instabox evidence](evidence/2026-11-16-instabox.md), [P0 recovery](evidence/2026-11-16-instabox-p0.md) |
| Registered custom.python-agent 1.0.0 | Instabox | SiliconFlow international | Both passed, including protected HTTP | [Instabox evidence](evidence/2026-11-16-instabox.md) |

Successful Web-task records include actual fixture modification, unchanged fixed tests, external Tool authorization/approval, output/artifacts, private preview, event replay, same-Session continuation, cancellation and cleanup according to each linked record. Some use API-driven credentials; shared Console onboarding, refusal, expiry and connection lifecycle are separately exercised through the same public endpoints. This matrix does not claim a fresh GUI-first run for every model/Harness combination.

Custom package support verifies the package protocol and one real model-driven example; it cannot certify arbitrary user-supplied package behavior. Model compatibility denotes a protocol, not a promise that every remote model implements it identically.

The E2B network-allowlist capability has a real [API-to-cloud allowed/denied probe](evidence/2026-11-15-network-api-journey.md). Daytona does not currently advertise that capability. Neither provider adapter advertises pause/resume, snapshot creation or desktop streaming; no acceptance is inferred for them. Process cancellation of an active model-started child is covered by [OpenCode cloud cancellation](evidence/2026-11-15-active-cloud-cancellation.md), with shared Linux Runtime tests for detached/SIGTERM-resistant descendants.

The alternate-provider requirement is now supported by the Modal OpenCode/SiliconFlow journey. All 35 listed combinations have dual-SDK records; the current retained-state audit covers 70 primary Runs. Daytona was removed from this compatibility scope by explicit user direction on 2026-11-16.

## Modal (2026-11-15)

Historical context: the user selected Modal next; Daytona is now a future candidate outside current compatibility. Original credentials belonged to a different workspace and image builds terminated remotely. The user-authenticated workspace, with a dedicated local token, passed actual creation/files/commands/Runtime/private preview/cleanup, real domain-allowlist probes, and both independent OpenCode/SiliconFlow SDK Web tasks. Pi and the registered custom Harness subsequently passed both SDK journeys; see the expanded matrix evidence. MiniMax, provider-specific fault injection and active-running cancellation remain unverified on Modal. See [Modal evidence](evidence/2026-11-15-modal.md) and [configuration](../docs/modal.md).

## Additional providers

Blaxel passed OpenCode, Pi and custom Harness/SiliconFlow through both SDKs, including private previews and cleanup. Fly Sprites is registered and has full SDK evidence in the rows above. See the [provider status ledger](../docs/sandbox-providers.md) for all 11 integration targets; read-only authentication is never counted as full integration.

## Future candidate: Daytona

Daytona is not currently compatible/advertised and has no current acceptance gate. Historical OpenCode transport failures and unexecuted Pi/custom combinations remain documented in [Daytona attempts](evidence/2026-11-15-daytona-attempts.md); they are not reclassified as passed. Its prototype is retained for future evaluation.
