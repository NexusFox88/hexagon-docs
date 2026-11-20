Your product already has places where an agent could do useful work: reviewing a code change, researching a question, or investigating a support ticket across several systems.

The button is the easy part. Behind it, an agent needs a workspace, an execution loop, access to the right tools, and a way to return progress and results. Users may leave the page and come back. A task may need another turn. Your application needs to know which work belongs to whom.

**Hexagon is an open-source, self-hostable control plane for a headless agent fleet.** It gives your backend a consistent way to manage agent execution through Python, TypeScript, or REST, so you can embed agents directly into your own product.

Your interface. Your workflow. A fleet working behind it.

## Headless: your product is the interface

Headless means the execution capability is available through an API. Your application decides how people use it.

In a developer tool, the entry point might be “Review this change.” In a research workspace, it could be “Prepare a brief.” In an operations product, it might be “Investigate this incident.” Background jobs and server-side events can start work too.

None of these experiences needs to look the same. One might use chat; another might show a progress timeline, an artifact download, or an approval request inside an existing screen.

**You keep the interface, user relationships, and business logic. Hexagon handles the execution lifecycle behind them.** Its Console helps developers configure connections and inspect work. Your customers interact with your product.

## Fleet: many agents, one way to manage them

Running one agent is a starting point. A fleet emerges when you manage many independent working contexts, each with its own task, environment, and execution configuration.

Three objects make that concrete:

| Object | What it represents | How it fits your product |
| --- | --- | --- |
| Session | A persistent working context with a fixed Harness and connection configuration | A project, investigation, or conversation you can continue |
| Run | One task submitted within a Session | A button click, message, or background request |
| Agent template | A reusable, versioned execution configuration | A consistent starting point for multiple independent Sessions |

Continue an existing project by submitting another Run to its Session. Start a separate Session when work needs independent context. Templates are optional: you can choose an execution configuration directly for your first task.

Each Session retains its identity and execution history, with one active Run at a time. Your backend can divide parallel business work across separate Sessions and collect the results.

This is the fleet model: **many independent execution contexts, managed through a consistent API for starting, observing, continuing, and cleaning up work.**

## Many Sandboxes: choose where work happens

A Sandbox gives an agent a cloud workspace: project files, running processes, and the dependencies its task needs.

Hexagon connects to your Sandbox accounts through provider connectors, including E2B, Modal, Vercel Sandbox, and Fly Machines. Different environments offer different lifecycle and infrastructure capabilities. Your application continues to work with Sessions and Runs while you choose a suitable execution environment.

One workload may need quick initialization. Another may need a specific image or a longer working lifetime. Network policy, suspend and resume behavior, and resource cleanup all matter to that choice.

A Session selects its Sandbox connection when it is created. Many Sandboxes means managing work across different environments; it does not imply that a running task automatically migrates between clouds.

## Many Harnesses: choose how the agent works

The Sandbox is the workspace. The Harness is the agent execution loop running inside it.

A Harness determines how the agent organizes model calls, uses tools, handles conversation, and advances a task. Hexagon provides built-in Pi and OpenCode paths, alongside OCI adapters, build recipes, and custom Harness integration paths. The Sandbox Runtime supervises Harness processes; the control plane manages the execution lifecycle.

That separation lets you select a Harness for a particular workload and pin its version. Model endpoints are connected separately and must match the chosen Harness's protocol requirements.

Treat the Sandbox, Harness, and model as an execution combination to validate. An integration appearing in the catalog does not mean every possible combination has been tested.

## Many Tools: connect agents to real work

An agent becomes useful when it can reach the context and capabilities your product depends on.

A release review may need repository and issue data. Research may require search and a knowledge base. Operations work may need an internal API. Hexagon's integration paths include remote MCP, application connections, and protected HTTP APIs; availability depends on the Harness and connection configuration.

Access also needs boundaries. Permission to inspect a ticket should not silently become permission to modify every ticket. Tool connections, scopes, and authorization flows are part of execution management. When an operation needs a person to decide, your product can present the authorization or approval step.

Raw provider and upstream credentials stay in the control plane. Tasks receive restricted access for execution. Your backend remains responsible for deciding which business user can access each task and its results.

## Follow one request through the fleet

Imagine a release workspace. A user clicks “Check this release,” and your backend wants code, research, and operational checks to run independently.

Your application can arrange the workflow like this:

```text
                 YOUR PRODUCT
                      |
                 YOUR BACKEND
             fan-out / collect results
                      |
              HEXAGON CONTROL PLANE
             Session / Run / Events
                      |
        +-------------+-------------+
        |             |             |
    Session A     Session B     Session C
    Sandbox A     Sandbox B     Sandbox C
    Harness A     Harness B     Harness C
        |             |             |
    Code tools   Research tools  Internal API
        |             |             |
        +-------------+-------------+
                      |
              YOUR BACKEND -> YOUR UI
```

This is an application design example. Your backend splits the work, selects each Session's configuration, and collects authorized results. Hexagon manages execution for those Sessions and Runs. Each Harness runs in its own configured Sandbox and uses the connected model and tools.

Progress returns to the release page. Artifacts become download links. An operation awaiting approval becomes an action in the user's workflow. The customer experiences one coherent feature inside your product.

## Embed your first agent feature

Start with one useful action, such as “Review this project.” Choose and validate a Sandbox, Harness, and model connection, then let your backend create a Session and submit a Run.

Here is the core TypeScript interaction. The client is initialized on the server; connection IDs refer to configurations you have already validated and enabled. Your application saves the business request and idempotency key before submission.

```typescript
const session = await hexagon.createSession({
  harness: { id: 'pi', version: '1.5.2' },
  sandbox_connection_id: sandboxConnectionId,
  model_connection_id: modelConnectionId,
});

// Associate the Session with the authorized business task.
await saveTaskSession(taskId, session.id);

const run = await hexagon.submit(
  session.id,
  savedInput,
  savedIdempotencyKey,
  { request_id: savedBusinessRequestId },
);

// Keep the Run ID for progress and result retrieval.
await saveTaskRun(taskId, run.id);
```

`saveTaskSession` and `saveTaskRun` stand for your application's persistence logic. For client initialization, project upload, completion handling, and cleanup, follow the [backend integration guide](https://docs.hexagon.autos/en/build/backend-integration).

Submission gives you a trackable Run. Map its events to your own progress UI and present results and artifacts where users need them. A browser disconnect does not cancel the Run: your backend can resume observing the same task when the user returns.

If a Run submission response is lost, preserve the same Session, input, origin, and idempotency key when recovering the request. An unknown Session creation outcome needs investigation before another creation attempt. Explicitly close Sessions you no longer need and confirm resource cleanup.

**Embedding starts with the product you already have:** its pages, accounts, backend, and business actions. Add one agent-powered feature first, then expand into continued conversations, scoped tools, approvals, and richer result delivery.

## Build the experience. Bring the fleet.

Your product owns the experience. Sandboxes provide the workspaces. Harnesses advance the tasks. Tools connect agents to your business. Hexagon makes execution manageable across them.

That is a headless agent fleet: many independent execution units working behind the product you are building.

Hexagon is currently in Developer Preview. Review the [capabilities and verified combinations](https://docs.hexagon.autos/en/integrations/verified-combinations) for your workload; cloud resources and model calls use the accounts you connect.

Start with [your first Session](https://docs.hexagon.autos/en/start/first-session), or explore the source on [GitHub](https://github.com/NexusFox88/Hexagon). Pick a useful action in your product, and put an agent behind it.
