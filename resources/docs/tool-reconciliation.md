# Resolving an uncertain external Tool result

A remote service can apply a write and then lose the response. Hexagon records the call as `unknown`, emits `tool.outcome_unknown`, and leaves the Run waiting. This is not a new approval request: inspect Tool calls to distinguish an uncertain outcome from an ordinary pending approval. An unsafe write is never automatically repeated.

`GET /v1/runs/{run}/tool-calls` lists the authenticated tenant's calls, arguments, request hash, state, approval id, recorded execution policy and any previous resolution. The execution policy records the actual dispatched endpoint/path, connection id/version, method and replay policy. Later edits to a connection cannot retroactively make an unsafe call replayable. Even an otherwise replayable call requires manual reconciliation if its connection version changed. Older uncertain calls without a recorded execution policy are treated conservatively.

After checking the remote service's actual records, submit:

```
POST /v1/runs/{run}/tool-calls/{call}/resolve
```

```json
{
  "request_hash": "<hash returned by the call query>",
  "outcome": "completed",
  "text": "Verified report saved with remote id report-123.",
  "evidence": "Looked up report-123 in the isolated report service and matched the original request."
}
```

`outcome` is `completed` or `failed`. The text becomes the tool result received by the original Harness; `failed` also sets `isError:true`. The evidence is an audit explanation, not an automatic provider verification. Only report conclusions actually established externally. If the outcome remains unknown, leave the call waiting or cancel the Run; do not fabricate success. This operation never sends another remote request, including when recording failure.

TypeScript uses `client.toolCalls(run)` and `client.resolveToolCall(run, call, resolution)`. Python uses `client.tool_calls(run)` and `client.resolve_tool_call(run, call, **resolution)`.

The request hash must match. An executing call cannot be resolved while its broker lock is held; terminal or cancelling Runs reject new resolutions. Repeating the identical resolution is idempotent, while conflicting resolutions fail. The database atomically stores the result and resolution, resumes the Run, and appends `tool.outcome_resolved` and `tool.completed`. The event source is `caller_verified`, so an operator conclusion is distinguishable from a direct service response. The normal worker then delivers the stored result to the original mailbox call without reissuing the tool request.

Resolution currently uses API/SDK. Console displays the generic waiting state and persisted events; a dedicated reconciliation GUI is not included in this change.
