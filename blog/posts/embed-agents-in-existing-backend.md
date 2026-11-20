## Keep the integration in your backend

To embed Hexagon in an existing application, keep the SDK and control-plane token on your server. Authenticate the user, check which business task they may access, persist the execution relationship, and expose your own authorized endpoints to the frontend. Your existing interface can show agent progress without receiving a control-plane administration credential.

The [backend integration guide](https://docs.hexagon.autos/en/build/backend-integration) provides Python and TypeScript examples. This article explains the records and decisions around those calls; it is not a substitute for your application authentication or transactions.

## Store intent before execution

A browser request can time out after your backend has submitted work. If you store only the returned Run ID, a lost response can leave you unable to distinguish an accepted request from an unsubmitted one.

Persist the business request, authorized Session, exact input and origin, and idempotency key before submission. After acceptance, retain the Run ID. Keep observation checkpoints separately: a cursor helps recover event delivery, while a submission key helps recover a lost submission response.

| Record | Why your application needs it |
| --- | --- |
| Business user or workspace to task mapping | Prevent one user from reading another user's work. |
| Task to Session mapping | Continue the intended workspace and authorize access. |
| Durable submission intent | Recover the original submission instead of creating duplicate work. |
| Run ID and state | Query the same execution after a backend restart. |
| Committed event cursor | Resume observation and deduplicate replayed events. |
| Cleanup intent and resource references | Investigate unconfirmed cleanup rather than forgetting resources. |

A valid Session identifier is not proof of business ownership. Hexagon's tenant checks complement your application's user-level checks; a shared backend token does not automatically encode your product's individual users.

## Render progress without coupling execution to the browser

Build the UI around persisted execution state and observations. If the browser disconnects, reconnect to the existing Run rather than submitting the task again. Decide whether your backend or frontend owns the delivery checkpoint and acknowledge events only after the intended consumer has handled them.

Use the [event streaming guide](https://docs.hexagon.autos/en/build/stream-events) and its examples to understand the delivery boundary. A terminal observation and an exported artifact are different facts: fetch the authorized artifact through the documented artifact flow instead of assuming every file in the sandbox is already downloadable.

## Begin with one verified journey

Start with one user, one Session, one Run, and one supported sandbox/harness/model combination. Complete the [first Session](https://docs.hexagon.autos/en/start/first-session), then the [project task](https://docs.hexagon.autos/en/start/project-task). Check the failure path as carefully as the successful result: response loss, event disconnect, unauthorized reads, and cleanup should all have an explicit application behavior.

Hexagon currently remains a self-managed developer preview. The code examples in its documentation illustrate real API shapes, but your authentication, persistence, deployment, and business authorization require integration work. [Inspect the project on GitHub](https://github.com/NexusFox88/Hexagon) and star it if you want to follow that work as it evolves.
