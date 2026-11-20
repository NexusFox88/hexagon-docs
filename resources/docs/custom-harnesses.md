# Legacy source Harness packages

New Harness integrations use [OCI images](harness-images.md). This document describes the compatibility source-package API; it is not the OCI registration format.

A package is versioned source code plus a small runtime contract. Registration stores data; the control plane never imports or evaluates the source. The worker installs the selected package in a cloud Sandbox using the same SandboxConnector interface as built-in Harnesses. No provider-specific code is required in the package.

## Registration and versioning

Use authenticated `POST /v1/harness-packages`, TypeScript `client.registerHarnessPackage(package)` or Python `client.register_harness_package(**package)`:

```json
{
  "id": "custom.my-agent",
  "version": "1.0.0",
  "protocol": "hexagon-json-v1",
  "interpreter": "python3",
  "entrypoint": "main.py",
  "capabilities": ["conversation", "tools"],
  "model_providers": ["anthropic-compatible"],
  "files": [{ "path": "main.py", "content": "<your source code>" }]
}
```

Source packages allow Python 3 or Node as the entry interpreter, up to 32 UTF-8 files and 512 KiB in total. Paths must be relative and cannot traverse directories. The interpreter must exist in the selected sandbox image. The example uses Python standard library only. Other dependencies can be included as source files or managed by the package in the Sandbox; this first package format does not offer npm/pip lockfile installation orchestration or binary archive upload.

The API returns the SHA-256 digest and the definition. Registrations belong to the authenticated tenant. Re-registering identical content is idempotent; changing any content under an existing id/version returns `harness_version_conflict`. Publish a new version to change behavior. Both catalog discovery and execution resolve the tenant's exact version. Packages survive control-plane restarts. There is no package deletion endpoint yet, so existing pinned Sessions retain their dependency.

Select the returned id/version in an AgentDefinition, then create a Session and submit Runs through the usual API. Capabilities are author declarations; they enable compatibility checks but do not certify that arbitrary uploaded code fulfills the contract. Each deployment should validate the combinations it exposes.

## Runtime contract: hexagon-json-v1

The program starts in the Session workspace and receives one JSON object on stdin, followed by EOF:

- `protocol`, `run_id`, `input`.
- `model`: the user-configured `base_url` and `model` name. Call this endpoint directly.
- `native_session`: omitted on the first Run; the previously completed result's opaque native identifier on follow-up Runs.
- `artifact_directory`: workspace-relative export directory for this Run.
- `tools`: approved binding definitions, including `name`, `binding`, `operation`, `description`, `inputSchema`.

`HEXAGON_MODEL_KEY` contains the model credential. `HEXAGON_TOOL_TOKEN` authorizes the Run-scoped local tool mailbox. Neither the provider account credential nor a control-plane API token is supplied. Runtime supervises the Harness process. Cancellation stops its process group and captured Linux descendants, including separate descendant process groups, before reporting termination; see the Runtime lifecycle boundary in architecture.md.

For an external tool, POST to `http://127.0.0.1:8765/tools/<run_id>/call` with `Authorization: Bearer <HEXAGON_TOOL_TOKEN>` and `{ "id": "<UUID>", "name": "<declared name>", "arguments": {} }`. Poll/retry using the *same* id and arguments until `state` is `completed`; consume `result`, including `isError`. The control plane handles authorization and approval waits. Do not bypass this mailbox to call a bound credential Tool directly.

Emit exactly one final JSON line on stdout:

```json
{"type":"hexagon.result","text":"The actual assistant response","native_session":"opaque-id","failed":false}
```

`native_session` is optional. Ordinary logs cannot stand in for this result. Missing, malformed or duplicate result records fail interpretation. A successful result also requires exit code zero and a successful common artifact export. `failed:true`, nonzero exit or Runtime interruption cannot complete the Run successfully. Never print keys or export them as artifacts.

## Working example

`examples/harnesses/python-agent/main.py` is a small model-driven Agent loop: it calls the configured Anthropic-compatible model, exposes a shell tool within the Sandbox, connects declared external tools through the mailbox, and keeps conversation history inside the same Sandbox. It has bounded steps and generic failure output. It is an illustrative Harness, not an additional isolation boundary inside the Sandbox.

Real acceptance command:

```sh
HEXAGON_HARNESS=custom HEXAGON_MODEL=siliconflow HEXAGON_WEB_SMOKE=1 HEXAGON_BOTH_SDKS=1 npx tsx tooling/smoke-api.ts
```

This registers the source through the public API and executes actual cloud/model tasks; it incurs provider usage. Evidence is recorded separately and the complete product acceptance ledger remains authoritative.
