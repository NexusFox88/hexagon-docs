# Real cloud compatibility runner

`npm run verify:compatibility -- /absolute/path/to/private-config.json` runs the installed Python wheel and TypeScript npm package against the local control plane and real cloud sandboxes. Run `verify:packages` first. Local refers to the control plane, not simulated compute.

The plan comes from `/v1/catalog`. It excludes Daytona, separates unsupported model protocols, providers without OCI image support, and image recipes that still need a build. Registration and credential validation are not execution evidence. Aider's declared conversation-only contract gets two-turn conversation/cleanup checks; it is not credited with tools or artifacts.

The other executable rows check two independent SDK journeys: pinned Session initialization, upload, idempotent submission, event subscription disconnect/replay, actual model response, same-Session continuation, assigned remote tool execution, environment use, artifact download/content verification, cancellation on failure and confirmed Session cleanup. OCI harnesses are registered through each SDK before execution. These checks supplement the full Web/GUI/approval/recovery journeys in `acceptance.md`; they do not replace those scenarios or claim fresh coverage for them.

Provide connection IDs, never keys:

```json
{
  "data_directory": "/absolute/path/to/control-plane-data",
  "model_name": "MiniMax-M3",
  "sandboxes": {"modal": "connection-id", "e2b": "connection-id"},
  "models": {
    "anthropic-compatible": "connection-id",
    "openai-compatible": "connection-id",
    "openai-responses": "connection-id"
  },
  "harnesses": {
    "builtin:opencode": {"id": "opencode", "version": "1.2.27"},
    "builtin:pi": {"id": "pi", "version": "1.5.2"},
    "oci:codex": {"id": "your-registered-harness-id", "version": "0.169.0"}
  },
  "tool": "verified-deepwiki-mcp-connection-id",
  "providers": ["modal", "e2b"],
  "run_timeout_ms": 900000
}
```

Optional `harness_filter` and `protocols` arrays select a slice. `clients` can select `python` or `typescript` for a failed-client rerun; successful single-client rows are `partially_verified`, never a dual-SDK pass. Only combined successful evidence for both clients, with confirmed cleanup, can certify the combination. Optional `cells` selects exact combinations; `skip_cells` excludes exact `provider/harness-key/protocol` strings. Excluded rows remain unverified in that invocation; skipping never produces a pass. Each required connection must match its provider/protocol and the configured model name. Missing or mismatched configuration is explicitly `unverified_configuration` and makes the command fail.

Each invocation creates a new private `.local/evidence/compatibility-<uuid>` journal. It preserves Session/Run IDs, per-client assertions, failures, cleanup outcomes and exact input connection IDs. Never overwrite failed attempts when rerunning. A row passes only when both SDK processes exit successfully; each process requires both its assertions and confirmed cleanup. A successful answer with unresolved cleanup is a failed acceptance.

SIGINT/SIGTERM asks the supervisor to finish the current combination and clean it before stopping. A Run timeout cancels the Run before closing the Session. An unknown remote tool outcome is recorded and ends that attempt; it is not approved or blindly retried. A create operation escalated to `needs_review` stops that acceptance attempt early and preserves its operation record; it is not left waiting until a generic conversation timeout. Unknown sandbox creation must be reconciled using its operation ID before claiming cleanup. Keep those private IDs for provider follow-up.

E2B's default `base` template may be below OpenCode's 2 GiB requirement. Use a verified 2 GiB template. E2B owns its transport dispatcher; the connector forwards the operator's proxy selection, honoring `NO_PROXY` and `NODE_USE_ENV_PROXY=0`. The SDK applies that selected proxy to both API and sandbox requests.

MiniMax uses separate connections for Anthropic (`https://api.minimaxi.com/anthropic`) and OpenAI protocols (`https://api.minimaxi.com/v1`). Chat Completions success is not evidence of Responses support. Test each protocol independently. Registered user-defined packages/images are an unbounded extension surface; passing a known template does not certify arbitrary submitted code.
