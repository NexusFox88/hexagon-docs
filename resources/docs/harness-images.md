# OCI Harness integration

A Harness registration identifies executable agent code. Its distribution artifact is an OCI image, not a JSON object containing source files. Sandbox providers own cloud resource lifecycle; the Runtime supervises the process inside the selected image. The control plane owns Sessions, Runs, credentials and persisted events.

## Register and run

Local SDK clients discover the workspace automatically. Hosted clients need an owner credential for registration; application tokens can run registered Harnesses but cannot administer the registry.

```python
import time
from hexagon import Hexagon
client = Hexagon.local()
harness = client.register_harness(
    image="ghcr.io/anomalyco/opencode:1.2.27",
    id="custom.opencode", version="1.2.27",
    protocol="opencode-v1", capabilities=["conversation", "tools"],
)
session = client.create_session(
    harness={"id": harness["id"], "version": harness["version"]},
    sandbox_connection_id="YOUR_MODAL_CONNECTION_ID",
    model_connection_id="YOUR_MODEL_CONNECTION_ID",
    env={"APP_ENV": "development"},
)
run = client.submit(session["id"], "Hello", "a-unique-operation-key")
while True:
    result = client.run(run["id"])
    if result["state"] in ("completed", "failed", "cancelled"):
        break
    time.sleep(1)
print(result["output"])
# Close the Session explicitly when finished; this requests cloud cleanup.
client.close(session["id"])
```

```typescript
import { Hexagon } from '@hexagon/agent-sdk';
const client = await Hexagon.local();
const harness = await client.registerHarness({
  image: 'ghcr.io/anomalyco/opencode:1.2.27',
  id: 'custom.opencode', version: '1.2.27',
  protocol: 'opencode-v1', capabilities: ['conversation', 'tools'],
});
const session = await client.createSession({
  harness: { id: harness.id, version: harness.version },
  sandbox_connection_id: 'YOUR_MODAL_CONNECTION_ID',
  model_connection_id: 'YOUR_MODEL_CONNECTION_ID',
});
const run = await client.submit(session.id, 'Hello', crypto.randomUUID());
for await (const event of client.stream(run.id)) console.log(event);
await client.close(session.id);
```

Registration is `POST /v1/harnesses`. `image` is required. Optional fields: `id`, `name`, `version`, `protocol`, `command` (argv array), `capabilities`, `registry_secret_id`. If omitted, ID derives from the repository, version from the resolved digest, and command from the image's Entrypoint + Cmd. The protocol defaults to the `ai.hexagon.harness.protocol` image label, then `hexagon-json-v1`.

The server resolves tags and multi-platform indexes to a **verified Linux amd64 manifest digest**, verifies the config blob and pins that exact reference in the Harness and Session. Re-registering an identical definition is idempotent. Changing a pinned version is rejected; register a new version. Each lookup is tenant-scoped. Legacy source-package IDs share the same version namespace and cannot overwrite an image registration.

## Supported boundaries

- Registry origins: Docker Hub and GHCR. Registry authorization is restricted to their token services; blob redirects are allowlisted and never receive registry authorization headers. Other registries need an explicit connector policy, not arbitrary server-side URL fetching.
- Native cloud execution: Modal and Fly Machines (public images only on Fly). E2B accepts public OCI images through a Session-owned Template build; its expanded Harness matrix remains individually unverified until recorded. Unsupported providers fail Session preflight before allocation; private image support is a separate capability.
- Modal derives an execution image from the pinned image to add Python, Node and common Runtime prerequisites. Alpine and Debian-family images are supported. Distroless and unsupported package managers fail the build. Modal runs containers as root and ignores the image USER directive. Do not treat the declared image user as an enforced security boundary. The Claude adapter uses explicit tool permissions, not root-incompatible bypassPermissions. Entrypoint and Cmd are cleared for the Sandbox supervisor; a dedicated `sleep infinity` keeps the resource alive. The Runtime launches the registered command separately.
- Registry credentials use an enabled managed Secret containing `{"username":"…","password":"…"}`. The control plane resolves metadata with pull-only authorization; Modal's image builder receives a registry Secret. These values are not injected as agent environment variables. Rotation is read at provisioning; referenced Secrets cannot be deleted.
- Ordinary `env`/`variables` remain readable by Sandbox code. Model and tool credentials continue to use scoped proxy grants. OCI does not introduce an LLM Gateway.
- Runtime protocol and capabilities are declarations; successful image resolution is not proof of a successful agent execution. The actual run, model compatibility, connected tools and cleanup must be tested separately.

## Runtime contracts and templates

| Template | Adapter | Distribution | Connected tools |
| --- | --- | --- | --- |
| Codex 0.169.0 | `codex-v1` | Pinned public community image + Dockerfile | MCP bridge |
| Hermes Agent 2026.9.24 | `hermes-v1` | Pinned upstream image + Dockerfile | MCP bridge |
| OpenClaw 2026.11.5 | `openclaw-v1` | Pinned upstream image + Dockerfile | MCP bridge |
| DeepSeek Harness 0.2.2-rc.1 | `deepseek-v1` | Build recipe; publish to your registry | MCP bridge |
| OpenCode 1.2.27 | `opencode-v1` | Public upstream pinned image + Dockerfile | MCP bridge |
| Aider 0.86.2 | `aider-v1` | Public upstream pinned image + Dockerfile | Not supported by this adapter |
| Pi 1.5.2 | `pi-v1` | Build recipe; publish to your registry | Pi extension |
| Claude Code 2.1.327 | `claude-code-v1` | Build recipe; publish to your registry | MCP bridge |
| Python Agent | `hexagon-json-v1` | Build recipe; publish to your registry | Runtime mailbox |

Build without publishing:

```
node --import tsx tooling/build-harness-images.ts all
```

Build contexts are minimal temporary directories and never include workspace credentials. Built local tags are `hexagon-local/<template>:<version>`. A recipe is not a published artifact. Follow upstream software licenses and provider/model compatibility requirements when distributing derived images. No automatic push occurs.

The custom JSON protocol reads one object from stdin containing `protocol`, `run_id`, `input`, `model` (base URL/name only), `native_session`, `artifact_directory`, and `tools`. Scoped `HEXAGON_MODEL_KEY` and `HEXAGON_TOOL_TOKEN` are process environment values. Emit exactly one final JSON line:

```json
{"type":"hexagon.result","text":"Answer","native_session":"opaque-session-reference","failed":false}
```

Persist conversation state within the Session workspace; put deliverables in the supplied artifact directory. Duplicate/missing/malformed final results fail the run. A nonzero process exit cannot be promoted to success by a final-looking line. The Python example implements model calls, shell execution, remote tools and continuation. The OCI Dockerfile embeds it; a command override is useful for development but not a substitute for distributing your normal dependencies in an image.

## Compatibility migration

`registerHarness` / `register_harness` now register images. Existing source-package callers use `registerHarnessPackage` / `register_harness_package`; `POST /v1/harness-packages` and previously pinned Sessions remain supported. Built-in installer rows are visibly distinct from OCI images. They remain for existing Sessions and providers without OCI support; they are not advertised as OCI executions.

See `testing/evidence/2026-11-18-oci-harness.md` for actual verification and unresolved limits.


DeepSeek Harness uses the official `@deepseek-ai/dsh` headless CLI, JSON final records and persisted Session IDs. The adapter supplies the configured Messages endpoint and scoped model grant, connects assigned tools through the existing MCP mailbox bridge, and disables upstream telemetry and session-log upload. Its pinned release is a release candidate. Actual local container tests cover two turns and an MCP call; this is separate from real cloud/model verification.

Current delivery and exact scenario evidence: [Harness delivery acceptance](../testing/evidence/2026-11-18-harness-delivery.md). Catalog `verification` entries are scoped to image, command, provider, model and clients. Recipes without a registry reference require an operator-built image.

Fly Machines prepares Python, Bash and timeout inside its owned VM when the image lacks them, using Alpine or Debian-family package managers. It uses timeout flags supported by both BusyBox and GNU. The image digest identifies the source image; Runtime prerequisite installation mutates the VM filesystem. Fly command execution is root; the declared image user is not an enforced security boundary. Unsupported package managers or failed installation end the Run with `harness_runtime_prerequisites_unavailable`.

## E2B image preparation (2026-11-19)

E2B creates a private, Session-owned template from the registered immutable image reference, using its SDK Template builder with 2 CPUs and 4096 MiB. The configured template remains the path for non-OCI Harnesses. Template building and Sandbox creation have separate persisted operation records. The builder records template/build IDs before status polling. A recovered operation polls the same build; a missing receipt uses exact operation-name lookup and never automatically starts another build. The template list exposes the last successful build, so incomplete or failed list rows cannot prove which build was accepted. Such missing receipts remain unresolved.

Session close deletes compute before deleting its owned execution template. Unknown build or deletion outcomes keep cleanup pending. This first implementation intentionally has no cross-Session template cache; private OCI registration is still rejected by E2B preflight. No template-build capability implies that every Harness image has passed execution or recovery acceptance. Image preparation uses the same API/SDK Session request without an extra user configuration step.
