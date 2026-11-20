## Start with responsibilities

An agent product needs somewhere to run code, a loop that chooses the next action, and a way to manage work after the browser disconnects. These are different responsibilities. In Hexagon, a sandbox provides the execution environment, a harness runs the agent logic, and the control plane manages durable Sessions, Runs, events, credentials, and cloud operations. Your application remains responsible for its users and interface.

These terms are not standardized across every vendor. The definitions here describe [Hexagon's execution architecture](https://docs.hexagon.autos/en/concepts/execution-architecture); compare responsibilities when evaluating other systems, rather than assuming identical labels imply identical behavior.

## Follow a project task

Consider a user asking your application to change an uploaded project and return the modified files. Your backend first checks that the user owns the project. It associates that request with a Hexagon Session and submits a Run. The control plane persists execution records and coordinates a cloud sandbox. Runtime inside that sandbox supervises the harness. The harness interacts with the model and tools to perform the task.

The application renders observations and authorized results. Exported artifacts have a lifecycle distinct from the sandbox workspace: retaining an exported artifact does not mean every file in the workspace has been backed up.

| Layer | Question it answers | Integration consequence |
| --- | --- | --- |
| Application backend | Which business user may submit or read this work? | Persist ownership mappings and check them on reads as well as writes. |
| Control plane | Which Session and Run exist, and what happened? | Preserve identifiers and recover using durable records. |
| Sandbox connector | How do we allocate, inspect, and clean up cloud resources? | Evaluate provider-specific lifecycle behavior. |
| Runtime | Which harness process is executing in this sandbox? | Process supervision belongs with the execution environment. |
| Harness | What should the agent do next? | Model protocol and conversation behavior depend on the harness. |

## Local does not mean local execution

A local Hexagon control plane runs on your machine, but the documented real execution journey uses cloud sandboxes. A hosted control plane changes where management services run; it does not move harness execution into the API server. Cloud execution also needs the appropriate reachability for protected credential access.

## Choose by the problem you actually have

If your task is implementing agent reasoning, investigate harness behavior. If your task is isolated compute, evaluate sandbox capabilities. If you already have an application and need persistent execution management across these components, evaluate a control plane. You may need all three, but they are not interchangeable purchases or integrations.

Hexagon is an Apache-2.0, self-managed developer preview. Its integration catalog is not evidence that every provider, harness, and model combination has passed the same journey. Start with the [verified combinations](https://docs.hexagon.autos/en/integrations/verified-combinations), then follow the [first Session guide](https://docs.hexagon.autos/en/start/first-session). Review the [source repository](https://github.com/NexusFox88/Hexagon) to assess whether its current maturity fits your project.
