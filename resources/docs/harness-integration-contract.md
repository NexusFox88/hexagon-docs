# Harness integration contract and expansion

Implementation scope: Codex 0.169.0 (pinned public community image; local 0.170.0 probes are separate evidence), Hermes Agent source f97608f178d1ffeca59860195ab7da295f7c8e5f (2026.9.24), OpenClaw 2026.11.5. No image publication or git commits. Local and hosted remain control-plane deployments; real acceptance uses cloud Sandboxes.

`protocols.ts` owns executable model compatibility, tool support and continuation semantics. Registration and catalog consume this contract. Tenant-owned registrations pin OCI manifest digests; templates without published images remain build recipes. Registered does not mean verified. Evidence records distinguish deterministic adapter tests, actual upstream binaries with fixture models, and actual cloud/model/SDK journeys.

The control plane owns Session/Run, credential access, approvals, durable events and cloud cleanup. Runtime supervises one Harness invocation at a time and terminates descendants on cancellation. An adapter owns only configuration/launch, upstream events/result interpretation and native continuation IDs. Never introduce a second gateway daemon, background scheduler or account-credential store. The new runners use isolated per-Sandbox state, scoped model/tool grants and the existing MCP mailbox. Memory and channel integrations are not enabled implicitly.

Codex uses the Responses API only. Hermes initially declares Chat Completions. OpenClaw uses its embedded local turn, with a fixed Session identifier and no Gateway. No protocol conversion is performed. Unsupported combinations fail before resource creation.

Acceptance: both SDKs register an image, create a Session with model/Sandbox/tools/env, complete two turns retaining native state, exercise assigned tools, observe durable events and final result, cancel a running turn, close and confirm cleanup. Test parser failures and incompatible binding rejection deterministically. Real-binary fixtures prove CLI/config/MCP compatibility only, never real model quality or cloud portability. Existing templates must be reviewed against the same boundary; evidence remains specific to tested versions and providers.

## Published image delivery and verification

The catalog joins protocol contracts, distribution templates and exact-image verification records. A published image, registered definition and successful model credential check are separate facts. A verification record specifies image digest, launch command, provider, model protocol/name, SDK languages, scenario scope and evidence path. Console must display the scope; a single-turn result is not a full journey badge. Unknown combinations remain usable only when their declared contracts pass preflight, without being labelled tested.

Codex's public template is a community image, explicitly labelled as such. Hermes and OpenClaw use upstream images with explicit CLI command overrides; their daemon entrypoints are never started. Modal derives a Runtime-capable image. Fly Machines uses the pinned public image directly; the image must include Python 3, Bash and coreutils needed by Runtime. Fly does not accept private registry credentials. Provider account credentials remain in the control plane.

OpenAI-compatible CLIs receive the scoped proxy prefix followed by `/v1`; omitting it produces an authorization failure rather than bypassing the proxy. OpenClaw state uses the guest user's private home because some cloud providers mount `/tmp` without sticky protection. The adapter does not weaken OpenClaw's filesystem checks.

OpenClaw's embedded JSON command returns a final response; assigned remote-tool calls and Runtime lifecycle events remain observable during execution. It does not provide the same native action stream as Codex/Hermes, and the Console must not manufacture hidden reasoning or intermediate native actions.

## Reusable cloud acceptance

After registering the desired images and validating connections, put only resource references in a private acceptance config:

```json
{
  "sandbox": "<enabled OCI Sandbox connection ID>",
  "model": "<Responses connection ID>",
  "chat": "<Chat Completions connection ID>",
  "tool": "<Exa connection ID with search allowed>",
  "harnesses": {
    "codex": {"id": "custom.codex", "version": "0.169.0"},
    "hermes": {"id": "custom.hermes", "version": "2026.9.24"},
    "openclaw": {"id": "custom.openclaw", "version": "2026.11.5"}
  }
}
```

Run `HEXAGON_ACCEPTANCE_CONFIG=/absolute/path/config.json npx tsx tooling/smoke-harness-oci.ts codex` and `HEXAGON_ACCEPTANCE_CONFIG=/absolute/path/config.json PYTHONPATH=sdk/python python3 tooling/smoke-harness-oci.py codex`; repeat for `hermes` and `openclaw`. These commands incur real provider/model usage. They retain unique local evidence files, use strict downloaded-artifact assertions and confirm Session closure. Protocol fixtures are separate from these commands. Never promote a run to verification merely because its process exited zero.
