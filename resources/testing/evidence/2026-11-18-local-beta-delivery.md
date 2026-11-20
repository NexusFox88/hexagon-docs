# Local distribution, recovery and cloud acceptance

Date: 2026-11-18. Scope: local control plane, real cloud Modal Sandboxes; no publishing or commits. Daytona remains excluded. This is not a claim that every provider × Harness combination was rerun.

## Implementation

- Compiled local distribution with production dependency installation, runtime/Console assets and both SDK directories. Launch uses Node directly; no installed TypeScript, tsx or Vitest is needed by the server.
- Background credential ingress checks and bounded retry metadata. Concurrent readiness requests coalesce; active invocation origins cannot rotate. A failed proxy transport can retry the same Cloudflare provider without inherited proxy variables; an explicit opt-out remains available.
- Private offline PostgreSQL backup/restore with matching owner/key/settings, checksums, empty-target guards and decryption of every retained secret. Identity validation is read-only and tenant/owner-scoped.
- Migration checksum/version guards. Legacy migrations are baselined once, rather than pretending historical checksums existed.
- Installed-SDK cloud matrix runner with per-run private evidence and cleanup IDs.
- OpenClaw public tool-activity observation, excluding arguments, output and reasoning. Completion still requires the native terminal result.
- Console recovery copy, readable MCP operation/session names in reverse usage, and stale-route protection after asynchronous health requests.

## Executed acceptance

An isolated workspace started at port 8897 from `.local/releases/beta-candidate-2` after `npm ci --omit=dev`. Console connected without a manually supplied API Token. Through the actual English GUI: selected Modal, entered the existing private token pair, verified/enabled; selected OpenAI Responses, configured MiniMax-M3, verified/enabled; selected remote MCP, discovered DeepWiki tools and authorized only `read_wiki_structure` without approval.

Installed Python wheel and TypeScript tarball clients used those GUI-created connection IDs. With OpenClaw 2026.11.5 in real Modal Sandboxes, both passed two-turn native continuation, remote MCP invocation, environment verification, artifact download and confirmed Sandbox cleanup. Python additionally uploaded input, checked idempotent submission and disconnected/replayed SSE. TypeScript's stronger upload/replay coverage is in the later matrix rerun, not this first run.

The first TypeScript run encountered a transient `harness_install` NotFoundError; the same Sandbox recovered. Python encountered an uncertain Runtime response during the second turn; persisted `runtime.reconnected` evidence shows recovery of the existing invocation. These were actual provider/transport failures, not simulated fault claims.

Private journals: `.local/beta-acceptance/clean-86776510185c4a558d459af6ed061955/openclaw-{python,typescript}.json`. All two original Sessions were confirmed closed before backup.

After those Runs finished, the test terminated only the owned Cloudflare child process. Without pressing retry or issuing a new Session, the background monitor replaced it with a reachable origin within three recorded samples. Evidence: `channel-recovery.json` in the same private workspace. This is process-loss recovery; it does not claim the host itself was physically put to sleep.

The real workspace was stopped, backed up and restored into a new empty PostgreSQL database and new data directory. All 27 tables matched by sorted-row SHA-256: including 2 Sessions, 4 Runs, 2,535 events, 2 artifacts, 3 connections and 10 encrypted secrets. Every secret decrypted. The first comparison caught a last-used timestamp mutation in identity validation; the read-only fix passed the second drill. Private evidence: `recovery-2/evidence.json`; the unsuccessful first drill is retained separately.

The restored service started using a newer compiled distribution and existing credentials. Console displayed prior history, initialization JSON and MCP call history without reconfiguration. The original user service at port 8787 was also safely restarted after verifying no active Runs.

## Commands and boundaries

- `TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify`: 88 files / 276 tests passed. Log: `.local/beta-acceptance/verify-final.log`.
- `npm run verify:packages` with the database environment: installed both artifacts and passed 7 package/API/interoperability tests. Evidence `.local/evidence/sdk-packages.json`.
- `npm run verify:startup`: fresh schema, restart, retained encrypted credentials and wrong-key detection passed; `.local/startup/hexagon_startup_98395a40281240b4b64ffddba53e3427/evidence.json`.
- `npm run verify:backup`: isolated real PostgreSQL dump/restore, repeated migrations, newer-schema refusal, changed migration refusal, corruption and nonempty target rejection passed. Latest record `.local/beta-acceptance/3514a7670a8348119389c82608daefa6/evidence.json`; live-process and wrong-owner/tenant rejection also passed.
- Real cloud tests are recorded separately from deterministic tests. Cloudflare availability and host uptime remain external operational dependencies. Source-specific provider capability limits are unchanged.

## Browser observations

Actual browser walkthrough used fresh GUI onboarding, both language menus, SDK/REST Playground, snapshot reuse, initialization JSON sidebar, session conversation, tool assignment/call history, catalogs and form validation. Verified application-owned validation, keyboard focus, Escape dismissal and no document horizontal overflow at the inspected desktop size. Screenshots under `.local/beta-acceptance/` retain observations. The original stale-title screenshot is evidence of the defect, not a successful final screen.

## Restored-workspace final regression

`npm run verify:cloud -- <private-restored-journey.json> openclaw` passed both installed SDK journeys, with confirmed cleanup for both Sessions. Each covered input upload, idempotent submission, SSE disconnect/replay, two-turn native continuation, environment verification, actual remote MCP use, and artifact verification. Private matrix: `.local/evidence/cloud-159902a1-60b9-4509-96ac-0b0146c62dc2/matrix.json`.

The Python execution exposed an observer-path defect in the pinned OpenClaw image: its CLI respawns into `dist`, so searching only `entryDirectory/dist` misses the event bus. After correcting both lookup paths and preserving the preload across the respawn, the TypeScript execution persisted real read/exec/write and remote-tool start/result events. Its first remote-tool call failed, the Agent corrected the call and succeeded; failed events are retained. A separately installed Python SDK also read and asserted the real start/end events (`python-observability.json`). The earlier Python execution is not claimed to have emitted native activity before this fix.

The final clean distribution is `.local/releases/beta-delivery`. Production-only dependencies installed successfully; the restored database started under that distribution and the actual browser displayed both completed turns and retained results. Intermediate development distributions are not release artifacts.

Final cleanup: the isolated port-8897 service and its temporary ingress were stopped; the original port-8787 service returned HTTP 200. Its temporary ingress was explicitly stopped with HTTP 200 after cloud work, leaving automatic SDK-triggered preparation available. The final bundle has no installed tsx, TypeScript or Vitest dependencies. No commits or publishing were performed.
