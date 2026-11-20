## A disconnected stream does not establish task failure

When a browser or network connection disappears, first identify what was lost. In Hexagon, disconnecting a client does not cancel a Run. Reconnecting to observe the same Run is different from submitting a new one.

The [recovery guide](https://docs.hexagon.autos/en/build/recovery) separates observation loss, submission response loss, process interruption, and unknown external operation outcomes. Each needs a different recovery record.

## Classify the failure before retrying

| Symptom | Retain | Next step |
| --- | --- | --- |
| Event stream disconnected | Original Run ID and committed cursor | Reconnect to that Run and replay after the checkpoint. |
| Submission response lost | Session, exact input and origin, original key | Retry the identical submission to recover its original record. |
| Runtime unreachable | Original invocation and sandbox relationship | Inspect recovery state instead of independently restarting the harness. |
| External write timed out | Tool call identity and available evidence | Determine whether the side effect occurred before repeating it. |
| Cleanup response lost | Original resource identifiers | Reconcile those resources; do not assume they are gone. |

Do not generate a new submission key just because the original request timed out. That can turn an observation problem into duplicate work. Changing the request while reusing a key also conflicts with the intended idempotency contract.

## Checkpoint at the consumer boundary

Persisting events before streaming makes replay possible, but it does not prove that your UI displayed an event. Choose where an event counts as consumed. If a backend commits a cursor before forwarding an event to the browser, the browser may miss it after a disconnect unless your application also provides a delivery mechanism.

The documentation includes a [checkpoint example](https://github.com/NexusFox88/hexagon-docs/blob/main/resources/examples/documentation/event-checkpoint.py) and an [event streaming guide](https://docs.hexagon.autos/en/build/stream-events). Use the examples to inspect ordering and persistence, then adapt the acknowledgment boundary to your product. Replayed events should not create duplicate application effects.

## Retry scope matters

Retrying an identical Run submission does not make arbitrary tool calls idempotent. An external service can accept a write while its response is lost. Repeating that write may create another issue, message, or payment. Unknown outcomes require evidence and reconciliation, not a blanket retry loop.

Likewise, a stopped local control plane is not proof that cloud resources have terminated. Retain resource identities until cleanup is confirmed. Closing a Session concerns cloud lifecycle; exported artifacts and historical Run records have their own retention semantics.

## Make failure recovery part of your integration review

For one verified sandbox/harness/model path, test the normal task first. Then deliberately disconnect observation, restart the application consumer, and inspect what is replayed. Check response-loss handling with durable submission intent. Exercise authorization for resumed reads, and verify cleanup using the original resource references.

These are integration checks to perform, not new benchmark results claimed by this article. Start from the existing [backend integration](https://docs.hexagon.autos/en/build/backend-integration) and [verified combinations](https://docs.hexagon.autos/en/integrations/verified-combinations) documentation. Hexagon remains a developer preview; inspect the current implementation and limitations before relying on a specific recovery guarantee.
