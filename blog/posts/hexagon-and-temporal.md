You have a coding agent that works. Now your product needs to know which task it belongs to, whether it finished, and what happened when the connection dropped.

Temporal comes up quickly in this conversation. It already handles durable execution, retries, and long waits. Why build an agent control plane?

**Temporal provides durable execution for workflows. Hexagon is an open-source control plane for agents running through your chosen harness, sandbox, and model connection.** Their responsibilities overlap, and a system can use both.

The useful comparison starts with the state you need to recover.

## One task, several kinds of state

Consider a product that fixes a bug, returns a patch, waits for a maintainer, and deploys the approved change.

There is business state: which request was approved, whether deployment started, and whether the user was notified. There is agent execution state: which Session owns the workspace, which Run is active, and which events and artifacts are available. There is also harness and infrastructure state: conversation context, running processes, files, and resources in a sandbox provider.

Persisting one of these does not automatically preserve the others.

| Responsibility | Temporal | Hexagon |
| --- | --- | --- |
| Main abstraction | Workflow execution and Activities | Sessions, Runs, and connected execution resources |
| Recovery mechanism | Workflow replay using recorded history | Persisted Run records, worker leases, event cursors, and resource reconciliation |
| Agent logic | Implement or integrate the agent through Temporal's execution model | Run a supported harness through a Runtime and adapter |
| Infrastructure integration | Application code and integrations define resource operations | Sandbox connectors expose supported lifecycle operations |
| Application integration | Invoke workflows and interact with their state | Submit, observe, continue, and cancel agent work through an API |

These are differences in what each project supplies. Temporal can underpin an agent platform; Hexagon's domain-specific objects could also be implemented on top of another orchestration engine.

## What Temporal makes durable

Temporal records workflow progress in an Event History. A worker can replay that history to reconstruct workflow state, using recorded Activity results instead of repeating completed work. Workflow code must obey Temporal's determinism requirements; external operations belong behind appropriate execution boundaries, commonly Activities. See [Temporal's durable execution explanation](https://docs.temporal.io/durable-execution).

In the bug-fix example, you could model patch generation, approval, deployment, and notification as workflow steps. If the workflow worker stops while awaiting approval, the workflow's recorded progress remains recoverable.

Temporal also explicitly supports agents, tool calling, human approval, and internal agent platforms. Its [Durable AI documentation](https://docs.temporal.io/ai) includes agent framework integrations and runnable examples. An agent loop can itself use Temporal; it does not have to sit outside the workflow.

The integration boundary matters. Wrapping an entire external agent process in one Activity does not automatically checkpoint every instruction inside that process. Finer recovery depends on how the agent, its operations, and its state are integrated.

## What Hexagon manages

Hexagon starts with the execution components you want to use. You select a supported sandbox connection, harness, and compatible model connection, then expose agent work through your application.

A **Session** retains the working context and execution configuration. A **Run** represents one submitted task within that Session. The control plane manages these records and cloud operations; the Sandbox Runtime supervises the harness process. The harness controls the agent loop and model interactions. See the [execution architecture](https://docs.hexagon.autos/en/concepts/execution-architecture).

That gives your backend a consistent place to ask: Which Run belongs to this request? What happened? Is a decision pending? Where are the results?

Several details are concrete in the [Run implementation](https://github.com/NexusFox88/Hexagon/blob/main/modules/execution/runs.ts):

- Repeating a submission with the same tenant, Session, key, and matching request returns the existing Run; conflicting input is rejected.
- Run creation and its queued event occur in the same database transaction.
- Worker lease checks include a generation, preventing stale workers from updating the Run through those paths.
- Runtime events are deduplicated during ingestion and can be read after a persisted sequence cursor.

These mechanisms support execution management and reconnecting clients. They do not turn an arbitrary harness into a replayable Temporal Workflow.

The distinction is visible in the [worker implementation](https://github.com/NexusFox88/Hexagon/blob/main/modules/execution/worker.ts): an interrupted runtime becomes a failed Run with `runtime_interrupted`. Persisted history explains what was observed; it does not promise instruction-level continuation of the interrupted process.

## Retries need an identity and a boundary

Suppose patch generation starts successfully, but your backend never receives the submission response.

With Hexagon, retain the Session, original request, and submission key, then repeat that same submission to recover its Run record. A new key can mean new work. Reconnecting to an existing Run's event stream is a separate operation, covered in the [recovery guide](https://docs.hexagon.autos/en/build/recovery).

Now suppose the agent creates a pull request, but the external service's response is lost. Deduplicating Run submission does not deduplicate that external write.

Temporal has the same external-effect boundary: an Activity may perform an action and fail to report completion, allowing a retry to repeat the action. Its [Activity documentation](https://docs.temporal.io/activity-definition#idempotency) recommends idempotent implementations for this reason.

The application or integration needs a stable operation identity, downstream idempotency support, or a way to reconcile what happened. A retry policy alone cannot supply that evidence.

## Where they can work together

For the bug-fix product, one possible design is:

```text
Your application
  |
  v
Temporal Workflow
  |-- request an agent patch ----------+
  |                                   |
  |                              Hexagon API
  |                              Session / Run
  |                                   |
  |                              Cloud sandbox
  |                              Runtime -> Harness -> Model
  |                                   |
  |<------- result and artifact IDs --+
  |-- wait for maintainer approval
  |-- deploy the approved change
  +-- notify the user
```

Temporal would coordinate the business process. Hexagon would manage the agent execution behind the patch-generation step. Your application would retain the mapping between the workflow, Session, Run, and business user.

This is a proposed composition, not a shipped Temporal integration. A real implementation must preserve submission identity across Activity retries, observe the existing Run, and explicitly map cancellation and failure states. Creating a fresh Session or submission key on every retry would defeat that design.

## Recovery does not mean universal undo

A restored workspace cannot unsend an email or reverse a deployment in another system. Those operations need explicit compensating actions, if reversal is possible at all.

Hexagon's [checkpoint implementation](https://github.com/NexusFox88/Hexagon/blob/main/modules/sandboxes/checkpoints.ts) uses provider capabilities for filesystem snapshot and restore. Unconfirmed operations can remain unknown and require reconciliation. This is a specific resource lifecycle mechanism, with a narrower scope than rolling back everything an agent did.

## Choose the work you want to own

Choose Temporal when you need durable coordination for application workflows or an agent loop integrated with its execution model. You can build the surrounding agent platform yourself or use its available integrations.

Evaluate Hexagon when you want a common API and operating surface for agent Sessions, Runs, sandboxes, events, and results. Hexagon is a developer preview. Check the [verified execution combinations](https://docs.hexagon.autos/en/integrations/verified-combinations); a connector catalog does not establish universal compatibility.

Use both when your product needs durable business orchestration around agent execution that Hexagon manages. Keep their recovery boundaries explicit, especially where a retry can create an external effect.

For Hexagon, the product question is concrete: **how much execution plumbing must your team build before your chosen agent can become a feature in your application?** The [source](https://github.com/NexusFox88/Hexagon) and [first Session guide](https://docs.hexagon.autos/en/start/first-session) are the places to evaluate that today.
