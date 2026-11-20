# Instabox integration

Provider ID: `instabox`. Configuration: `{ "template": "agent-browser" }`; an explicit template/version may be used if allowed by the account. Connect with an API key scoped for machine read, write and delete. Use Console → Platform → Sandbox connections → Instabox, save, verify, then enable. Both SDKs select the resulting connection ID through the existing Agent/Session APIs; no provider-specific SDK method is required.

## Boundaries

- The control plane owns the provider API key, encrypted through the shared Secret store. Creation explicitly sends `vault:false`, `secrets:[]`, `envSecrets:[]`. Existing account Vault/Org Secret values are not implicitly selected for a new machine.
- User `env` and protected model/API bindings use the existing runtime/credential-proxy paths. Original upstream keys stay in the control plane. Instabox native Org Secret provisioning is **not** implemented or advertised by this adapter; the shared external proxy is the supported credential-access implementation.
- Lifecycle uses official HTTPS APIs, stable create/delete idempotency keys, operation metadata and paginated reconciliation. A lost create or exec response is not blindly retried. Delete operation IDs are persisted before polling, and completion also requires machine absence.
- Both provider `deleteAfterSeconds` and control-plane deadline reconciliation are used. Provider-native deletion can operate while the control plane is offline; control-plane cleanup still records and confirms the result. Idle suspension is not deletion, and a suspended/manual-stopped machine is never represented as absent.
- Files use native binary upload/download endpoints; uploads verify size and SHA-256. Downloads are bounded to 64 MiB. Foreground commands are bounded to 600 seconds; detached background commands have a remote GNU timeout of at most 3600 seconds. Truncated/invalid UTF-8 command output is rejected as incomplete. Large binary output belongs in files.
- Runtime and HTTP previews use official SSH certificates and native TCP forwarding through `ssh.instabox.sh` (legacy `api.instabox.sh` also allowed), with strict host-CA verification. The control-plane host requires `ssh` and `ssh-keygen` (OpenSSH). User SSH config, agent and global known-hosts are not used. Request-scoped local keys, tunnels and processes are released after response delivery. Key directories record the owning PID in their names; preflight and new tunnel creation periodically reap same-user directories only after confirming the owner process is absent. Live owners, symlinks and unmarked legacy directories are preserved. No provider key is sent to the guest, and no public cloud port is published.
- Network allowlists are unsupported and rejected by the common preflight before provisioning. Only unrestricted egress is advertised. Snapshot management, desktop/VNC, pause/resume controls and provider-native Secret administration are outside the present common Connector contract, not implicitly supported.

## Sources and tests

Official sources inspected 2026-11-16: [API overview](https://instabox.sh/docs/api.md), [machines](https://instabox.sh/docs/api/machines.md), [commands/files](https://instabox.sh/docs/api/commands.md), [SSH](https://instabox.sh/docs/api/ssh.md), [OpenAPI](https://api.instabox.sh/v1/openapi.json).

`integrations/sandboxes/instabox.test.ts` covers the adapter's failure and trust boundaries. `tooling/probe-instabox.ts` performs a real disposable-resource command/binary/private-HTTP probe and confirms cleanup. Full model-driven Web journeys use:

```sh
HEXAGON_SANDBOX=instabox HEXAGON_MODEL=siliconflow HEXAGON_HARNESS=pi HEXAGON_BOTH_SDKS=1 HEXAGON_WEB_SMOKE=1 npx tsx tooling/smoke-api.ts
```

Set `HEXAGON_HARNESS=opencode` or `custom` for the other registered adapters. These are billable cloud/model tests, require authorized local test credentials and a temporary credential-proxy tunnel, and retain isolated evidence under `.local/evidence`. Execution results belong in the acceptance evidence, not inferred from registration or unit tests.

For accounts limited to one machine, add `HEXAGON_SERIAL_SDKS=1` to the dual-SDK Web command. Python first continues the TypeScript Session, cancels a queued TypeScript task and closes that Session; only then does it provision its independent Session. TypeScript still continues the Python Session. The same task, approval, test/artifact, preview, retention and cancellation assertions remain enabled. The unmodified concurrent journey remains available for accounts with capacity. `tooling/probe-instabox-expiry.ts` separately checks native expiry without invoking the control-plane sweeper.

## Creation refusal and local prerequisites

A synchronous `POST /machines` HTTP 429 with structured `error.code=quota_exceeded` and no operation ID is a definitive refusal. The control plane persists a `rejected` create operation and terminates the Run with `sandbox_quota_exceeded`. It does not poll for a nonexistent machine, retry automatically, or allocate another machine after restart. The Session can be closed without provider reconciliation. Release account capacity, close the refused Session, then create a **new Session and Run**. Reusing the refused Session remains refused, including after reconstruction; this fences the crash window between persisting rejection and terminating the Run. Generic 429s, rate limits, transport failures, and operation-polling errors retain unknown-outcome reconciliation.

Connection verification and fresh provisioning check OpenSSH in the environment where they execute: `ssh -V` must identify OpenSSH and `ssh-keygen` must generate an ed25519 key in a writable temporary directory. Failure produces `sandbox_openssh_unavailable`; provisioning records no create intent and contacts no provider. Install OpenSSH in both control-plane and worker images, ensure PATH and temporary-directory permissions, then verify the connection again. These checks do not change host SSH configuration or use the SSH agent.

`tooling/check-instabox-recovery.ts` runs serial real-cloud quota, owned SSH-process interruption, external deletion, lost-create-response and durable-delete-handle recovery checks. It saves private operation/resource IDs before effects and confirms cleanup. This test deliberately occupies one machine and expects the authorized account's one-machine quota. It never deletes unrelated machines. The API smoke test's `HEXAGON_WORKER_RESTART=1` mode additionally kills an actual worker subprocess during authorization and verifies exactly one create and one persisted invocation after recovery.
