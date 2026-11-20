# Harness delivery and cloud user journey — 2026-11-18

This checkpoint separates deterministic tests, real cloud runs and browser actions. No images were published and no git commits were made. Daytona remains outside the supported acceptance set.

## Implemented

- One protocol catalog defines model protocol compatibility and native continuation. Catalog verification records match exact OCI digest, protocol and command; a published image alone is not a verification claim.
- Codex 0.169.0 uses a pinned **community** image (not an OpenAI publication); Hermes 2026.9.24 and OpenClaw 2026.11.5 use pinned upstream images. Templates preserve the executable command instead of starting an image's daemon or installer entrypoint.
- OpenAI-compatible and Responses harness configuration retains the scoped credential proxy prefix and authorized `/v1` route. OpenClaw stores its private state under the container user's home instead of an unsafe shared `/tmp` root. Hermes file writes use the Session workspace as the safe root.
- Fly Machines now advertises and executes public OCI images, overrides daemon entrypoints and rejects private registry credentials before creating an application. Image prerequisites remain Python 3, Bash and coreutils.
- Console templates show model protocols, image distribution, publisher and scoped verification scenarios. Registration carries the selected Harness into Playground. Details provide Python/TypeScript registration code and copying.
- Browser inspection caught a duplicate translation key that prevented the details modal opening and a reserved template ID in generated SDK registration. Both were fixed; catalog duplicate keys are now rejected by tests.

## Real cloud matrix

| Combination | Python | TypeScript | Verified scope |
|---|---|---|---|
| Modal / Codex / MiniMax-M3 Responses | Passed | Passed | OCI registration, native follow-up, remote Exa tool, environment value, downloaded JSON artifact, confirmed cleanup |
| Modal / OpenClaw / MiniMax-M3 Responses | Passed | Passed | Same full journey |
| Modal / Hermes / SiliconFlow DeepSeek-V4-Flash Chat | Passed | Passed | Same journey; Python failures preserved below |
| Fly Machines / OpenClaw / MiniMax-M3 Responses | Not run | Passed | Public OCI provisioning, real one-turn model response and confirmed cleanup only |

Python additionally uploaded and read an input file, repeated an idempotent submit, disconnected the event stream and replayed persisted events. Local private records are `.local/harness-delivery/{codex,hermes,openclaw}-{python,typescript}.json`. Resource IDs and operation states are retained in `.local/harness-delivery/resources.json`.

## Recovery

- **Passed:** real Vercel / Pi / SiliconFlow Chat Web journey with both SDKs, plus a worker SIGKILL during authorization. Recovery used the same cloud Sandbox: one create and one Harness invocation, generation 1 to 2, same original Run completed. Journal: `.local/evidence/api-smoke-7669018a-d12b-45ae-9193-489dbc84f344.json`.
- Resource-operation fault suite is recorded separately: create succeeds remotely but its response is lost; reconciliation must find it without creating again. Delete faults cover a pre-operation failure and a lost successful-delete response. Final combined Python/TypeScript result: **passed**, with product cleanup and provider absence confirmed (details below).
- Failed attempts are retained: an Anthropic-compatible SiliconFlow stream ended before `message_stop`; a Chat stream ended without `finish_reason`; a MiniMax/OpenCode attempt encountered Cloudflare 502 and timed out. These are **not** marked passed. Their resources were cleaned up.
- A real Codex Python Run was cancelled during execution and its Sandbox cleanup confirmed (`codex-python-cancellation.json`). Hermes Python's first attempt completed but returned an incorrect remembered value; another emitted only `I`. Neither is accepted as a passing journey merely because the CLI exited successfully.

## Personally exercised Console journey

A separate, empty local control-plane schema was used, with real cloud sandboxes; the user's original configuration was preserved.

1. Chinese Console auto-connected locally without manually providing a platform token.
2. Selected Modal and OpenAI Responses icon cards, entered provider credentials, validated and enabled both connections.
3. Selected Codex's OCI template, registered it and reached Playground with Codex selected.
4. Added public DeepWiki remote MCP, discovered tools, selected permissions and enabled it. The machine's outbound corporate proxy required the existing operator allowlist to include `mcp.deepwiki.com`; the initial discovery failure was retained rather than hidden.
5. Submitted a real cloud task; switched to English, approved the actual remote MCP call, then inspected the successful Chinese answer.
6. Opened initialization, copied its JSON, extracted Python and TS creation code, ran both generated programs against the fresh workspace and received `GUI_PYTHON_OK` / `GUI_TYPESCRIPT_OK` from real cloud executions. Both resources were confirmed closed.
7. Followed initialization reuse into Playground and inspected the Tool's assigned Sessions / call history navigation.
8. Reviewed 17 routes in each language for viewport overflow, header/content overlap and scrolling. Exercised the tool catalog using actual wheel input: modal body scrolled while the window stayed at zero; Escape restored trigger focus, keyboard reopening and focus containment worked.
9. Opened Harness verification/details in both languages, switched SDK language, copied code, and actually ran the generated registration programs. Inspected screenshots, not just DOM assertions.

Private browser/result evidence: `en-layout.json`, `zh-layout.json`, `en-initialization.png`, `zh-conversation.png`, `en-harness-details.png`, `gui-mcp.json`, `gui-python.json`, `gui-typescript.json` under `.local/harness-delivery/`.

## Automated checks

- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify`: 88 files / 273 tests passed, including the duplicate-key regression check.
- `npm run verify:packages` with the same test database: package build/install verification passed, 4 files / 7 tests. Actual Python wheel and TypeScript package installation were exercised.
- Final targeted localization verification: 5 tests passed, including duplicate translation key detection.

## Deliberate limits

This is not an all-Harness × all-Sandbox × all-model claim. DeepSeek/Pi/Claude Code recipes without a distributable configured OCI image remain explicitly build-required. OpenClaw's current native CLI returns final JSON; it does not expose the same native action stream as Codex/Hermes. Remote tool calls remain observable through the control plane. Fly's record is single-turn TypeScript, not the Modal dual-SDK full journey. The Codex community image is clearly identified, with a build recipe available for user-owned distribution.

## Re-running the OCI journeys

The reusable runners are `tooling/smoke-harness-oci.ts` and `tooling/smoke-harness-oci.py`. Set `HEXAGON_ACCEPTANCE_CONFIG` to a private JSON file containing connection IDs (`sandbox`, Responses `model`, Chat `chat`, Exa `tool`) and a `harnesses` mapping keyed by template name with registered `{id,version}`. No credential values belong in that config. Run each with the Harness name after installing the SDK / setting `PYTHONPATH=sdk/python`. Results use unique files under `.local/evidence`; failures and resource IDs are preserved rather than overwritten. These runners use the running local control plane and real configured cloud providers.

Historical OpenCode full TypeScript and Aider single-turn cloud records were imported from the earlier OCI acceptance evidence, matching exact image and command. They retain their original scope and are not presented as new reruns.

### Recovery harness correction and transport diagnostics

Combining resource fault injection with independent Python and TypeScript Sessions exposed an acceptance-helper defect: it injected faults into every Session but asserted one create/delete globally. `ResourceFaults` now scopes uncertainty and counters to the first operation/resource; unrelated SDK Sessions execute normally. The isolation regression test passes. The earlier combined run is preserved as failed (`api-smoke-e1c46956-adb2-4928-9140-22fc26cafbfd.json`), and its cloud resources were removed by the failure cleanup path.

Subsequent transport-only attempts failed before resource creation: Cloudflare startup unavailable (`e79af98e...`, `causes: upstream/proxy EOF`) and the previously authorized localhost.run fallback unavailable (`5566d39f...`). No management API was exposed. The final retry isolates the cloudflared process from the machine's HTTP proxy; model/tool egress configuration is unchanged. The explicit acceptance-only fallback is available through `HEXAGON_ACCEPTANCE_TUNNEL=localhost-run` but is not claimed as a successful network path.

## Final resource-fault verdict

`CLOUDFLARED_BINARY=<private direct-connection wrapper> HEXAGON_RESOURCE_FAULTS=1 HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 HEXAGON_SANDBOX=vercel HEXAGON_HARNESS=pi HEXAGON_MODEL=siliconflow HEXAGON_MODEL_PROTOCOL=openai-compatible npx tsx tooling/smoke-api.ts` completed with `state=verified`, `product_cleanup=confirmed`, `resource_cleanup=confirmed`, `template_cleanup=not_created`.

Journal: `.local/evidence/api-smoke-ca48f40e-bfd7-4550-9eb1-43a6e7398a08.json`. The targeted resource has exactly **one create**, **one reconciliation**, **two delete attempts**, **one actual delete**. The independent Python Session is not counted as a duplicate targeted create. Both SDKs completed the fixed Web task, tool authorization/approval, preview, artifact download, native follow-up and cross-language continuation. The uncertain delete states were observed before final provider absence was confirmed. The isolated listener and temporary Cloudflare tunnel were closed by the suite.

All 15 Session records in the Harness/GUI/Fly private resource audit are closed. The fresh Console acceptance process group was stopped. The original local service was restarted with the delivered code and remains available at `http://127.0.0.1:8787/console/`; user configuration was preserved. The final browser was returned to the Chinese Harness catalog.
