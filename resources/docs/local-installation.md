# Install, operate and recover a local control plane

Main source repository: [NexusFox88/Hexagon](https://github.com/NexusFox88/Hexagon).

Local and hosted describe the control plane. Sandboxes remain cloud resources. This source checkout is not a published npm/PyPI distribution.

## Prerequisites and startup

Install Node.js 22.19 or later, PostgreSQL, and Python 3.10 or later for the Python SDK. Instabox also needs an OpenSSH client; temporary development ingress needs `cloudflared`. `npm run local -- doctor` reports these independently, with PostgreSQL connection checks bounded to 10 seconds. Optional provider prerequisites do not make management unavailable.

From the checkout:

```sh
npm ci
# Set DATABASE_URL to a PostgreSQL database owned by your development account.
# For an existing local PostgreSQL installation, createdb hexagon creates a fresh database.
npm run local -- doctor
npm run local -- start
npm run local -- status
```

If `DATABASE_URL` is absent, the development default is `postgres://hexagon@127.0.0.1:55432/hexagon`. PostgreSQL must be running; the launcher migrates this database but does not silently install a database server. The role must be able to create tables. Never reuse an unrelated application's database.

The Console is `http://127.0.0.1:8787/console/`. `HEXAGON_DATA_DIR` selects a private data directory (default `.local/control-plane`). Local Console connects automatically; Python `Hexagon.local()` and TypeScript `await Hexagon.local()` discover the same workspace without a manually entered token. Owner and encryption files remain private. A retained database must always use its matching encryption key. Hosted clients still require explicit API credentials.

The managed launcher uses `deployment.json`. Explicit process environment overrides saved proxy/ingress settings; saved and environment bypass domains are merged, always including loopback. Console → Settings → Network & ingress edits this file with optimistic revision protection. Restart after saving. Alternatively, `npm run local -- configure /absolute/path/config.json` validates and saves the same schema. No provider secrets belong in that file.

```json
{
  "no_proxy": ["api.instabox.sh"],
  "ingress": {"mode": "cloudflare"}
}
```

For an externally managed ingress, use `{"mode":"external","url":"https://your-credential-service.example"}`. For management-only setup use `{"mode":"disabled"}`. The ingress must route only to the credential listener (default `127.0.0.1:8789`), not to management port 8787. Temporary tunnels are development infrastructure and can fail independently. Console remains available, and the network page can retry a failed ingress when no Runs are active. A control-plane loopback check does not prove a cloud Sandbox can reach the endpoint. The same page can stop an owned temporary ingress after testing while keeping management available; stopping/retrying is blocked while Runs are active. Stopping is a runtime action, not a change to saved deployment configuration: a later service restart will use the saved ingress mode. The next SDK call restores a stopped development channel automatically. Save disabled mode only when credential access should remain disabled. The background monitor checks an enabled channel every 15 seconds with failure backoff; it never rotates an origin in use by an active invocation.

`npm run dev` is a low-level foreground entry point: run migrations first and supply network environment explicitly. Use the managed launcher for saved deployment configuration and ordinary local operation.

## Guided configuration and daily SDK access

1. Open Console → Infrastructure → Sandbox. Select a provider, enter its credentials, then verify and connect.
2. Open LLM, select the endpoint protocol, enter the endpoint/model/key, then verify and connect.
3. Open API Playground. Select a compatible Harness and those connections. Reusable Agent registration is optional.
4. Copy the Python or TypeScript program, install its SDK and execute it. Local mode does not require creating an application token. Inspect actual REST requests in the same Playground.
5. Optionally add Tool connections, authorize them, and select which tools to bind when creating a new Session.
6. Follow Sessions for actual execution, authorization/approval requests and results. Initialization exposes the pinned configuration, copyable JSON, SDK code and reuse in Playground.

Generated SDK journals support `--resume`, `--new-turn` and `--close`. They preserve Session/Run identifiers and per-turn idempotency keys; do not run concurrent clients against one journal. A lost Session creation response requires inspecting Sessions before creating again. Existing Run submissions can resume with their original key. Closing waits for confirmed cloud cleanup; an uncertain outcome remains pending.

## Local package distribution

```sh
npm --prefix sdk/typescript run build
npm pack ./sdk/typescript --pack-destination /absolute/path/artifacts
python3 -m pip wheel --no-deps --no-build-isolation --wheel-dir /absolute/path/artifacts ./sdk/python
```

Install the resulting `.tgz` and `.whl` into a clean project/virtual environment. These commands do not publish anything. `tooling/verify-sdk-packages.ts` builds and installs both artifacts into isolated consumers and runs actual API interoperability tests. It requires `TEST_DATABASE_URL`; artifacts, hashes and evidence location are retained in `.local/evidence/sdk-packages.json`. Wheel building needs locally installed setuptools >=68.

## Backup, upgrade and restore

Cancel/finish active Runs and close cloud Sessions before planned downtime. Persistent providers rely on the running control plane for expiry enforcement. `npm run local -- stop` refuses active Runs and verifies the service PID before signalling it. Unknown cloud outcomes remain in the database across restarts.

Use the integrated offline commands with the service stopped and all cloud Sessions closed:

```sh
npm run local -- stop
npm run local -- backup /absolute/private/new-backup-directory
# Provision a NEW empty PostgreSQL database before restoring.
DATABASE_URL=postgres://user@localhost/hexagon_restored HEXAGON_DATA_DIR=/absolute/private/restored npm run local -- restore /absolute/private/new-backup-directory
```

Backups contain a schema-scoped PostgreSQL archive, matching key/owner files, deployment settings, hashes and a migration inventory. Files are private; never commit or upload the bundle. Only restore trusted backups: hashes detect corruption, not a malicious archive. Restore refuses a nonempty target database or data directory and verifies every encrypted secret after restoring. For a non-public source schema, use the returned schema as the target connection's search path. Discovery/PID files are regenerated on startup, not copied from the old machine.

To upgrade, retain the backup and matching old release, install the new release's locked dependencies and start it. Migrations run in one transaction under a database lock. The first upgrade of legacy databases records migration checksums; later edits to applied migrations and schemas newer than the running code are rejected. Repeating startup preserves data. Rollback means restoring the matching older code and backup into a fresh target, not applying reverse migrations over live data.

Resource operations retain provider IDs, uncertainty, check times, backoff and operator review notes. “Acknowledged” pauses automatic review and retains unknown outcome; it is not proof of cleanup. Query the provider or escalate with the recorded operation ID. Only confirmed provider evidence can establish final resource outcomes.

## Hosted boundary

The same core services and SDKs accept an explicitly hosted control plane. `HEXAGON_DEPLOYMENT_MODE=hosted` requires `DATABASE_URL`, a canonical base64 32-byte `HEXAGON_MASTER_KEY`, an existing owner `HEXAGON_BOOTSTRAP_TOKEN`, and stable `HEXAGON_ACCESS_URL` HTTPS ingress. It rejects temporary tunnels and does not generate or read local owner/master-key files. Provision the database identity separately and migrate it before startup. Hosted identity bootstrap, organizations, billing and managed service operations are not implemented as a commercial SaaS in this iteration.

## Verification and recovery examples

Run `TEST_DATABASE_URL=... npm run verify` for the type and deterministic test gates; it refuses a missing database rather than silently skipping database-backed tests. `npm run verify:packages` checks isolated SDK installations; `npm run verify:startup` uses a fresh schema and data directory to check startup/restart/encryption recovery. These do not substitute for cloud acceptance; the original task remains in `testing/journey-source.md`.

HTTP examples require curl, jq and Python 3. `HEXAGON_HTTP_JOURNAL` selects their private state directory; SDK examples use `HEXAGON_JOURNAL`. Never run multiple clients against one journal concurrently. An abrupt process kill may leave a `.lock` file/directory containing its PID: check that process has exited before removing only that stale lock. Keep the journal itself. Failed/cancelled Runs and unconfirmed cleanup return a nonzero exit status; the Session is retained until explicit `--close` confirms deletion.

`tooling/console-browser-review.mjs` is an Ego browser regression recipe. Set its task-space/root constants to the current authorized local workspace, then run it through `ego-browser nodejs`. It checks 15 functional pages in both supported languages at desktop and narrow widths and writes screenshots plus a machine-readable report. Review the screenshots as well as the DOM checks. State-changing approvals, token lifecycle and error-path reviews are recorded separately in acceptance evidence.

## Install a local release without development dependencies

Maintainers build with `npm run build:local -- /absolute/new-release-directory`. The output contains compiled JavaScript, Runtime assets, Console and a locked production dependency manifest. It contains no credentials or user database. In a clean copy of that directory:

```sh
npm ci --omit=dev
# Configure a fresh PostgreSQL database using DATABASE_URL.
npm run local -- doctor
npm run local -- start
```

Node.js and PostgreSQL remain explicit host prerequisites. Cloud execution uses cloud Sandboxes, not a local Docker daemon. Python is required for Python SDK consumers; OpenSSH is required only for providers that use it. `pg_dump` and `pg_restore` are required for backup/recovery. This build is a local distribution artifact, not a published release.

Only the temporary Cloudflare tunnel process can retry direct transport when its inherited HTTP proxy fails with EOF/reset before an origin is established; model/tool egress settings remain unchanged. Set `HEXAGON_TUNNEL_PROXY_FALLBACK=disabled` when all outbound traffic must use the proxy. The total startup deadline remains bounded. Existing in-flight invocation URLs are preserved.

## Repeatable cloud regression

Run `TEST_DATABASE_URL=... npm run verify:packages` first to build and install both SDK artifacts in isolated consumer directories. Create a private JSON configuration using existing verified connections:

```json
{
  "data_directory": "/absolute/path/to/local-workspace",
  "sandbox": "sandbox-connection-id",
  "model": "responses-model-connection-id",
  "chat": "chat-completions-model-connection-id",
  "tool": "public-deepwiki-mcp-connection-id",
  "harnesses": {
    "openclaw": {"id": "custom.openclaw", "version": "2026.11.5"}
  }
}
```

The MCP connection must authorize `read_wiki_structure` without an approval requirement for this unattended fixture. The model/harness protocol must match; `chat` is used for Hermes. No credential values belong in this file.

`npm run verify:cloud -- /absolute/private/config.json openclaw` runs Python and TypeScript sequentially against real cloud resources. It checks native continuation, uploaded input, idempotent submission, stream disconnect/replay, a remote MCP call, environment variables, downloaded artifacts and confirmed cleanup. Python also registers the OCI image through its installed SDK. A unique private `.local/evidence/cloud-*/` directory keeps every Session/Run ID and the matrix result. A failed cell stays failed; cleanup uncertainty must be reconciled using its recorded Session ID before discarding evidence. This command uses provider/model quota and is not part of deterministic unit tests.

`npm run verify:backup` separately exercises PostgreSQL backup/restore, decryption, retained definitions, migration replay, schema-version refusal, checksum tampering and overwrite guards in isolated databases. It needs local PostgreSQL create-database permission and PostgreSQL client utilities; it is not a substitute for backing up a real workspace.

## Shareable support diagnostics

`npm run local -- diagnostics /absolute/new-report.json` creates a new private-permission JSON file with an allowlisted projection: host runtime version and coarse API/database/worker/credential-access states. It deliberately excludes credentials, endpoints, workspace/resource IDs, user content and logs. It refuses overwriting an existing file. Review even this small report before sharing. The private vulnerability contact is not yet configured; see `SECURITY.md`.
