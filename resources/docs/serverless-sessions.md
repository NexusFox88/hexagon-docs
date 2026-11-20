# Serverless Sessions

A Session is the durable conversation and workspace identity. Send the next message through `submit` in either SDK; no separate resume call is required. The worker serializes wake, Runtime recovery and the new invocation. `close` is terminal and deletes cloud resources. Pause is only allowed between Runs; a Run awaiting tool authorization or approval is still active.

## Provider strategies

| Provider | Strategy | State preservation |
| --- | --- | --- |
| E2B | Native pause/connect | Memory and filesystem |
| Freestyle | Native VM pause/start | Memory and filesystem |
| Instabox | Native suspend/resume operations | Memory and filesystem |
| Fly Machines | Suspend/start with cold-boot fallback | Filesystem authoritative; memory may survive |
| Vercel | Persistent Sandbox stop/resume | Filesystem, Runtime restarted |
| Upstash | Persistent Box pause/resume | Filesystem, Runtime restarted |
| Boat | Snapshot-enabled stop/resume | Filesystem, Runtime restarted |
| Agent37 | Instance stop/start | Managed workspace/cache in persistent home; `/tmp` clears |
| Modal | Native filesystem snapshot, terminate, recreate | Filesystem; Session stable, resource ID changes |
| Blaxel | Native automatic standby | Provider-managed memory; API cannot confirm active vs standby |
| Sprites | Native automatic warm/cold standby | Persistent managed workspace; Runtime recovered on next task |

Daytona is excluded. This is an implementation strategy table, **not a claim that every provider/Harness/protocol combination has passed live tests**. Real results are recorded separately in `testing/evidence`.

## Boundaries

- `resources.idle_timeout_seconds` defaults to 60 and has a minimum of 15. The current control plane polls eligibility every five seconds. Native automatic standby timing remains provider-controlled.
- Provider-managed standby may occur before Hexagon’s idle timer. Each new, not-yet-invoked task prepares the Runtime with the same workspace; persisted active invocations are never restarted by this path.
- Runtime/Harness/conversation files and the managed working directory persist across a planned idle transition. Temporary files elsewhere, open network connections and arbitrary process memory are not portable guarantees.
- Provider credentials remain in the control plane. Scoped invocation grants are issued for the next Run; original model/tool keys are not added to snapshots.
- Resume does not repeat an uncertain cloud create or an external tool action. Ambiguous snapshot/restore operations remain observable for reconciliation.
- A sleeping Session may still incur provider storage charges. Provider retention, account limits and billing constraints continue to apply. Boat trial accounts require a bounded TTL, which is refreshed on resume.
- Existing Session definitions retain their pinned capabilities. New capabilities apply to newly created Sessions; existing workspaces are not silently reconfigured.

## Real acceptance

With the local control plane running, ready provider connections and MiniMax-M3 endpoints for both Messages and Chat Completions:

```sh
npm run verify:serverless -- modal
```

This creates real billable resources. TypeScript uses Messages; Python uses Chat Completions. Each SDK independently creates a Session, submits two turns, polls, observes idle sleep, auto-wakes through submit, checks native tool output for the retained file and the previous conversation passphrase, then closes. Resource IDs are saved with restrictive permissions under `.local/serverless-acceptance` for cleanup/reconciliation. The script never calls explicit resume, and it never labels provider-managed idle as confirmed compute suspension.

To exercise provider standby before the control-plane idle deadline, use `npm run verify:serverless -- sprites --before-idle-deadline`. This uses a 180-second idle setting and sends the next task after 60 seconds while the Session is still open. It does not infer a provider billing state from that wait.

## Harness-specific recovery coverage

Provider lifecycle capability is separate from executable Harness compatibility. Codex/Hermes/OpenClaw and OCI OpenCode currently require a connector with `oci_image` (Modal or Fly Machines). Built-in OpenCode can run on all eleven providers. Never infer a Harness recovery pass from Pi evidence or from a successful single-turn invocation. The per-SDK status ledger is [the Harness serverless matrix](../testing/evidence/2026-11-19-harness-serverless-matrix.json); [acceptance notes](../testing/evidence/2026-11-19-harness-serverless-ui.md) record failed attempts and checks.
