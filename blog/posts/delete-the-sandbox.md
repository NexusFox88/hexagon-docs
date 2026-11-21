Your agent finishes a task. The sandbox is recycled.

The next morning, the user returns. They want the patch, the test result, and an answer to a simple question: did the external action actually happen?

Can your application answer without the original machine?

Disclosure: we build [Hexagon](https://github.com/NexusFox88/Hexagon), an open-source agent control plane. This question shapes our implementation. It is also a useful test of our limitations.

## The sandbox competition is moving upstairs

A sandbox comparison can start with startup time, isolation, price, regions, and available resources. Those differences matter. But the products are also expanding beyond the machine.

E2B describes its move toward an agent cloud in [“Sandboxes are dead”](https://e2b.dev/resources/sandboxes-are-dead). Cloudflare [attaches sandboxes to agents](https://developers.cloudflare.com/agents/tools/sandbox/). Vercel provides [snapshots](https://vercel.com/docs/sandbox/concepts/snapshots) for preserving sandbox filesystem state.

These vendors understand that agents need more than a place to run a command.

As these stacks expand, choosing an execution environment also means choosing lifecycle behavior, persistence boundaries, and recovery mechanisms. A familiar-looking `create`, `exec`, or `stop` API does not make those contracts interchangeable.

Here is the question I would add to every evaluation:

**If this sandbox disappears, which answers disappear with it?**

## Four things people call “state”

Imagine an agent fixing a bug, running tests, and opening a pull request. The application displays “working,” then eventually “done.” Under that simple UI are several independent records.

| State | What it tells you | What preserving it does not establish |
| --- | --- | --- |
| Process and memory | What is currently executing | What will remain after termination |
| Workspace files | What is on disk now | Which files were delivered or which tests ran |
| Execution records | What was requested, observed, and approved | Whether an unconfirmed external write succeeded |
| External results | What changed in another system | Whether your application received the acknowledgment |

A filesystem snapshot can be valuable without capturing a running process. A saved transcript can explain the conversation without containing the final patch. An approval record can show permission without proving the approved operation completed.

Each has a different recovery source:

```text
Application request
        |
        v
Execution records
Run IDs / events / exported results
        |
        v
Sandbox
Processes / working files
        |
        v
External services
Writes with separate acknowledgments
```

Deleting the sandbox removes one part of that picture. Whether the other parts remain useful depends on what you recorded before deletion.

## One real check: close the workspace, download the work

We have a narrow, useful result from Hexagon's November 20 project tutorial verification.

Two independent journeys used the Python and TypeScript SDKs with Vercel Sandbox, Pi 1.5.2, and a configured Messages endpoint serving DeepSeek-V4-Flash. Each journey completed two Runs in one Session, exported six files per Run, and then closed the Session.

The [recorded evidence](https://github.com/NexusFox88/hexagon-docs/blob/main/resources/testing/evidence/2026-11-20-project-docs-cloud.json) shows:

- Both Sessions reached `closed`, with completed resource-deletion records.
- All exported files remained downloadable with the same bytes after closure.
- The old application preview returned `preview_unauthorized` after closure.

The downloadable work survived. Access to the live preview ended. Those are two deliberate, separately observable outcomes.

This was a normal close after successful work on one execution combination. It does not establish recovery from a mid-task crash, preservation of unsaved files, or restoration of process memory.

That scope matters. “The files survived” is a useful result only when you can say which files, under which transition, and how you checked.

The [project tutorial](https://docs.hexagon.autos/en/start/project-task) provides the runnable journey. Its close step downloads the exported artifacts again and compares their hashes with the earlier downloads.

## Make the deletion test harder, one boundary at a time

Normal closure is the first check. Use a disposable test project to examine the following boundaries separately. These are evaluation procedures, not additional cloud-test results claimed here.

**Lose the submission response.** Let the server accept a task, then prevent the client from receiving its Run ID. Can the application recover the original task using a saved request identity? Record the accepted Run IDs and actual work before deciding whether a retry was harmless.

**Interrupt execution.** Remove the execution environment while the task is active. Does the application distinguish confirmed interruption from temporary unreachability? An unavailable machine should not silently become a new task, and a retained database row should not imply the old process resumed.

**Lose an external acknowledgment.** Have a controlled test service perform a write and then drop its response. Check whether the application keeps the operation unresolved until it can inspect the external result. An automatic retry can create a second write even when task submission itself is deduplicated.

**Remove the retained compute.** After collecting the intended outputs, close the workspace and verify cleanup. Use the original identifiers to retrieve execution records and deliverables. Check what the user can still see, and what the UI correctly says is unavailable.

A useful result sheet has four columns: the transition you caused, the evidence you retained, the answer your application gave, and anything still unknown.

The objective is to make your product's answers defensible. Sometimes the accurate answer is “we have not confirmed whether that write happened.”

## A durable record needs durable storage

Keeping records outside the sandbox creates another system to operate. Its database, artifact storage, encryption material, access controls, and retention policy now matter.

A transcript copied to a database on the same disposable machine has not crossed the deletion boundary. A signed download URL is only useful while the object and authorization behind it remain valid. An event log can only describe the events actually captured.

This is also where ownership becomes practical. Who can inspect these records? Can you export them? What must your application rebuild if you change providers?

Self-hosting and open source give you ways to inspect and operate that layer. They do not make state formats compatible or remove migration work.

## Where Hexagon puts the boundary

Hexagon separates Session and Run records from the cloud resource executing the work. The control plane manages those identities, events, exported artifacts, and resource operations. Runtime inside the sandbox supervises the harness process; the harness drives the agent loop.

The [Run implementation](https://github.com/NexusFox88/Hexagon/blob/main/modules/execution/runs.ts) makes matching submissions recover the original Run, persists state changes with events, and serves events after a sequence cursor. These mechanisms let a client recover its view of accepted work.

They have limits. Submission idempotency is scoped to a tenant and Session. Exported artifacts cover selected deliverables. An interrupted runtime can become a failed Run. Arbitrary live migration and universal rollback are not promises we make. The [recovery guide](https://docs.hexagon.autos/en/build/recovery) separates these cases.

Hexagon is a developer preview. Its value should be judged against those observable behaviors, including the cases that still require investigation.

## Add this to your next evaluation

Keep comparing sandbox performance, isolation, price, and lifecycle capabilities. Then give each candidate the same task and ask what your application can report after the execution environment is gone.

An integrated platform may supply the records you need. A separate control plane may fit your ownership and integration requirements. Either way, inspect the boundaries with your own workload.

If you want to start with ours, run the [project tutorial](https://docs.hexagon.autos/en/start/project-task), inspect its [recorded verification](https://docs.hexagon.autos/en/integrations/verified-combinations), and compare the result with your application.

**Which part of your agent's history exists only because its current machine is still alive?**
