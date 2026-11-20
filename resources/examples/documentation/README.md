# Product documentation examples

These programs accompany the [product documentation](../../docs/product/en/index.md). Run commands from the repository root. They use your local workspace's control-plane discovery; they are not a hosted endpoint configuration example. See [中文说明](README.zh-CN.md).

## Choose a program

| Program | Purpose | Remote effects | Local record |
| --- | --- | --- | --- |
| [first-session.py](first-session.py) / [first-session.ts](first-session.ts) | One task, artifact verification, closure and retained download | Creates Session/Run and cloud/model usage; closes on the successful path | `.local/docs-first-python/` or `.local/docs-first-typescript/` |
| [artifact-retention.py](artifact-retention.py) / [artifact-retention.ts](artifact-retention.ts) | Two exact files, hash/content checks and every artifact downloaded after close | Creates Session/Run and cloud/model usage; closes on success | `.local/docs-artifacts-python/` or `.local/docs-artifacts-typescript/` |
| [template-revisions.py](template-revisions.py) / [template-revisions.ts](template-revisions.ts) | A/B/C revision rollout, archival and historical snapshots | Creates one template, three cloud Sessions/Runs; closes on success | `.local/docs-revisions-python/` / `.local/docs-revisions-typescript/` |
| [project-task.py](project-task.py) / [project-task.ts](project-task.ts) | Upload project, two modifications, tests, preview, retained exports | Creates Session/Run/preview; cloud/model usage; explicit close stage | `.local/docs-project-python/` or `.local/docs-project-typescript/` |
| [inspect-run.py](inspect-run.py) / [inspect-run.ts](inspect-run.ts) | Bounded diagnostic reads for existing IDs | Reads existing records; does not mutate tasks or resources | JSON on stdout; no persistent event checkpoint |
| [backend-intents.py](backend-intents.py) | Persist business intents before Run submission; recover after response loss | Submit a Run on an existing Session or query its saved Run | Private SQLite database chosen with `--database` |
| [event-checkpoint.py](event-checkpoint.py) | Atomically save events and cursor; demonstrate restart and deduplication | None; direct execution uses synthetic events | Automatically removed temporary SQLite database |

The two languages create independent journeys when you run both. Their journals are deliberately separate. A Python pass cannot certify TypeScript. Cloud/example outcomes are not inferred from syntax or fake-client checks.

## Install the local SDK

Python requires 3.10 or newer. To keep the tutorial installation separate from other applications, use a dedicated virtual environment:

```sh
python3 -m venv .local/docs-example-venv
.local/docs-example-venv/bin/python -m pip install -e sdk/python
```

The package build requires setuptools ≥68; installation may obtain build requirements if they are not already available. The import is `hexagon`, while the distribution name is `hexagon-agent-sdk`. Use this venv's Python for the commands below. An isolated temporary venv installation, SDK import and both Python help commands passed in the [installation check](../../testing/evidence/2026-11-20-sdk-installation-docs.json). This verifies this machine and checkout, not a clean-machine control-plane deployment.

TypeScript examples use the repository SDK build and installed repository tooling:

```sh
npm --prefix sdk/typescript run build
```

The examples import `sdk/typescript/dist/index.js`, so rebuild after SDK changes. The SDK build and ESM import passed in that check. These are source-checkout examples, not proof of a published npm/PyPI release or an externally installed TypeScript package. Follow [installation](../../docs/product/en/start/install.md) to install repository dependencies and start the local control plane first.

## First Session

Verify and enable compatible Sandbox/model connections, then set their IDs (not their secret values):

```sh
export HEXAGON_EXAMPLE_SANDBOX_ID='YOUR_SANDBOX_CONNECTION_ID'
export HEXAGON_EXAMPLE_MODEL_ID='YOUR_MODEL_CONNECTION_ID'
```

Choose one language:

```sh
.local/docs-example-venv/bin/python examples/documentation/first-session.py
```

```sh
./node_modules/.bin/tsx examples/documentation/first-session.ts
```

Read [the complete tutorial](../../docs/product/en/start/first-session.md) before executing. The program saves a journal before creation and refuses to overwrite it. An error does not automatically close the Session: retain IDs, inspect the original task and confirm cleanup using the tutorial's recovery instructions. Do not remove the journal to bypass that protection.

## Project task

Use the same connection variables. The commands are stages, not a single batch to paste without reviewing outcomes:

| Stage | Python argument | TypeScript argument | Before continuing |
| --- | --- | --- | --- |
| Create/upload/submit | `project-task.py start` | `project-task.ts start` | Save returned Session/Run IDs |
| Observe/export | `project-task.py observe` | `project-task.ts observe` | Review actual test execution and exported code/report |
| Create preview | `project-task.py preview` | `project-task.ts preview` | Open private journal URL; verify filtering |
| Second modification | `project-task.py followup` | `project-task.ts followup` | Run observe again; inspect changed files and Reset interaction |
| Cleanup | `project-task.py close` | `project-task.ts close` | Verify resource cleanup, old preview denial and retained history |

Prefix Python arguments with `.local/docs-example-venv/bin/python examples/documentation/` and TypeScript arguments with `./node_modules/.bin/tsx examples/documentation/`. For example:

```sh
.local/docs-example-venv/bin/python examples/documentation/project-task.py start
.local/docs-example-venv/bin/python examples/documentation/project-task.py --help
```

The TypeScript project program currently accepts stages rather than a help flag; invoke it without a valid stage to see its allowed-stage error, without making an API call. Use the table for normal execution. The Python program provides argparse help.

The [project tutorial](../../docs/product/en/start/project-task.md) defines the complete sequence and recovery cases. `observe` checks required exports and fixed-test integrity, not whether model-produced claims are true. The unchanged [acceptance test](filter-app/acceptance.mjs) tests filtering logic, not the second-round Reset button. Browser checks are separate. The fixture deliberately fails before implementation and does not replace the original product authorization/approval fixture.

## Diagnose an existing task

No connection-ID environment variables are needed for the read-only inspector. It still needs the local SDK's workspace identity and an existing Session/Run pair:

```sh
.local/docs-example-venv/bin/python examples/documentation/inspect-run.py --session YOUR_SESSION_ID --run YOUR_RUN_ID --after 0 --max-pages 20
./node_modules/.bin/tsx examples/documentation/inspect-run.ts --session YOUR_SESSION_ID --run YOUR_RUN_ID --after 0 --max-pages 20
```

A report can contain sensitive resource IDs, so redirect it only into private storage. The report omits task/event/output text. A page bound prevents an unending diagnostic loop. An empty event page is a point-in-time observation, not proof of completion. Its cursor must not replace a durable application-consumer checkpoint.

## Persist backend requests

Follow [backend integration](../../docs/product/en/build/backend-integration.md) to bind an existing Session, prepare an intent, submit it and query the saved Run. Use an open Session and the SDK venv above. The database retains task inputs; keep it in a private directory. CLI user IDs demonstrate ownership checks and do not authenticate a user. This example does not create or close Sessions.

Offline checks require only Python’s standard library:

```sh
python3 -B examples/documentation/check-backend-intents.py
```

They use real temporary SQLite files and a fake SDK to exercise response loss, restart, exact resubmission, read-only status, ownership and conflicting input. They do not contact Hexagon or validate cloud execution.

## Recovery and verification scope

Use each journal from one process at a time. Project-stage commands hold process.lock; after an unclean exit, confirm the recorded process has stopped before removing only that lock. Lost creation/upload/preview outcomes require inspection; a lost Run submission uses the saved exact input and key. Local observation timeout does not cancel server execution. An expired preview needs the documented grant recovery workflow, not deletion of the entire journal.

Evidence is separated by scope: [project local checks](../../testing/evidence/2026-11-20-project-docs-local.json), [inspector fake-client checks](../../testing/evidence/2026-11-20-inspect-run-example.json), and the [product acceptance ledger](../../testing/acceptance.md). No fresh cloud/browser acceptance is established merely by the presence of these programs. Keep actual resource IDs in local private evidence until cleanup is confirmed.

The first-session programs have [fresh independent dual-SDK cloud evidence](../../testing/evidence/2026-11-20-first-session-docs-cloud.json) for the exact Vercel/Pi/Messages combination recorded there. That result does not validate the separate project-task or browser journey.

The separate project-task programs now also have [fresh dual-SDK cloud and browser evidence](../../testing/evidence/2026-11-20-project-docs-cloud.json): two turns each, fixed-test execution, filtering/Reset interaction and closure/retention. External Tool authorization and approval are outside this fixture.

## Offline event persistence and delivery

`python3 -B examples/documentation/event-checkpoint.py` checks the SQLite commit/cursor boundary. `node examples/documentation/check-event-delivery.mjs` checks application forwarding and viewer replay using the helpers in [event-delivery.mjs](event-delivery.mjs). These are offline examples, not an HTTP server or browser acceptance. The [event guide](../../docs/product/en/build/stream-events.md) explains database adapters, authentication, backpressure and reload requirements.

## Two-file retention exercise

Follow the [artifact guide](../../docs/product/en/build/artifacts.md) to run `artifact-retention.py` or `artifact-retention.ts` with the same connection variables and SDK setup. Each language has a separate private journal; do not rerun after an error without investigating the original IDs and cleanup. The exact two-file byte checks are stricter than the first Session tutorial.

See the [template guide](../../docs/product/en/build/agent-templates.md) before running the revision exercise; both languages use the same connection variables and SDK setup.

Run `node examples/documentation/event-delivery-server.mjs` for the loopback SSE server and browser viewer. Open its printed URL, disconnect/reconnect, and query the same synthetic Run. This reuses the delivery helpers and does not access Hexagon or prove cloud execution.
