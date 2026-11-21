A browser has eight progress events on screen. Its connection drops. Four more events arrive at the backend while the tab is disconnected.

What should happen when the tab comes back?

In the small example below, the same timeline grows from eight rows to twelve. There is no second task submission. The connection indicator changes, but the displayed Run state stays where it was until the client queries that Run again.

That is the behavior to get right before involving a model. You can reproduce it with Node.js, a browser, and three source files. There is no package install, model key, or cloud account involved.

## Run the example

Clone the documentation repository, then start the standalone server. Use Node.js 24, the version used for this check.

```sh
git clone https://github.com/NexusFox88/hexagon-docs.git
cd hexagon-docs
node resources/examples/documentation/event-delivery-server.mjs
```

Open the loopback URL printed by the command. It uses an available port, so copy the address from your terminal rather than assuming port 3000.

The server produces twelve synthetic events, one every two seconds. The browser connects over actual Server-Sent Events. The source is deliberately small: [server](https://github.com/NexusFox88/hexagon-docs/blob/main/resources/examples/documentation/event-delivery-server.mjs), [viewer](https://github.com/NexusFox88/hexagon-docs/blob/main/resources/examples/documentation/event-delivery-viewer.html), and [delivery helper](https://github.com/NexusFox88/hexagon-docs/blob/main/resources/examples/documentation/event-delivery.mjs).

Click **Disconnect** before all twelve rows have arrived. Wait a few seconds, then click **Connect**. Missing rows should appear without duplicating the earlier ones. Click **Query Run** to refresh the displayed execution state. Reload the page and the timeline rebuilds from the beginning.

In the browser check for this article, disconnecting left eight rows and a displayed state of `running`. Reconnecting produced twelve distinct event IDs. Querying the Run then changed its displayed state to `completed`. The Run ID stayed `synthetic-delivery-run` throughout.

This exercises browser delivery against a synthetic source. It does not run an agent, authenticate a user, or prove cloud recovery. Stop the server with Ctrl-C.

## The backend cursor is not the browser cursor

A backend can save event 9, advance its ingestion cursor, and crash before sending event 9 to the browser. Resuming the browser from that backend cursor would skip an event the user never received.

Keep two positions: the last event committed to your application's storage, and the last event applied by this viewer. Reconnect the viewer from its own position and read from the stored timeline. A second tab has its own position even if both tabs share one backend collector.

The example's `forwardStoredEvents` helper uses one ordered read loop for both history and later events. An empty read waits and tries again. It does not switch from a history query to an unrelated live subscription, where an event could fall into the gap between the two.

The adapter still matters. In a real application, `readAfter` must return committed rows for the authorized Run, in numeric event-ID order, strictly after the supplied cursor. The demo reconstructs synthetic history in memory; it is not that production adapter.

## Keep event IDs out of JavaScript Numbers

The first example ID is `9007199254740993`, beyond JavaScript's safe-integer range. Converting it to a Number loses precision. Use strings for storage and JSON, and `BigInt` for comparisons:

```js
const isLater = BigInt(event.id) > BigInt(savedCursor);
```

Do not sort the strings alphabetically or require adjacent IDs to differ by one. The documented Hexagon event sequence can have gaps. Deduplicate with the Run ID and event ID together.

The viewer uses an in-memory map. A transient disconnect can retain that map and its cursor. A page reload loses both, so this example starts at `0`. Persisting only the cursor would tell a fresh, empty timeline to skip its own history.

## Check the failure cases without paying for model calls

The accompanying checks deliberately drop a delivery, replay it, send a duplicate, and introduce another committed event after an empty read:

```sh
node resources/examples/documentation/check-event-delivery.mjs
python3 -B resources/examples/documentation/event-checkpoint.py
```

The Node check covers the delivery helper. The Python example separately checks SQLite persistence across restart, replay, and transaction rollback. Both passed for this article. Neither is a cloud or model test.

Before using this pattern in your application, add viewer authorization, durable storage, backpressure, and bounded reconnect behavior. Render event content as text. Keep the connection indicator separate from execution state, and query the original Run for the final result. The [streaming guide](https://docs.hexagon.autos/en/build/stream-events) describes those integration boundaries; the [recovery guide](./recover-agent-stream-disconnects.md) covers lost submissions and uncertain external writes, which need different handling.

If you try this in an existing product, [leave the part that did not fit](https://github.com/NexusFox88/Hexagon/issues/1): your backend stack, what the user was doing when the connection dropped, or the command that failed. A small reproduction is more useful than a feature wish list. Hexagon is still a developer preview, and these are the integration details worth finding early.
