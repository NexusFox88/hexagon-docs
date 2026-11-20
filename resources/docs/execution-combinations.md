# Selecting an execution combination

Use `GET /v1/catalog`, TypeScript `catalog()` or Python `catalog()` to discover registered Harness versions and connection providers. Harness entries identify tool/conversation support and compatible model provider types. Sandbox entries identify files, commands, preview and optional network allowlisting. Tool entries identify credential registration and approval support. These are adapter declarations; the acceptance evidence records which combinations have actually run.

Register an Agent with its exact Harness id/version, required capabilities, tool names, resource timeout and network policy. Create a Session with that Agent and the selected Sandbox/model/Tool connection IDs. Session creation performs compatibility checks before any cloud resource operation.

| Rejection code | Meaning |
| --- | --- |
| `unsupported_harness` | The exact registered Harness id/version is unavailable. |
| `harness_tools_unsupported` | Tools were declared for a Harness without tool support. |
| `incompatible_model` | The model connection's provider type is unsupported by the Harness. |
| `missing_capability` | A required capability is absent from the selected combination. |
| `network_policy_unsupported` | The Sandbox provider cannot enforce the requested allowlist policy. |
| `missing_tool_binding` | A declared tool has no selected connection. |
| `undeclared_tool_binding` | A binding names a tool absent from the Agent definition. |
| `connection_not_ready` / `tool_not_ready` | A required connection has not been validated and enabled. |

The resolved capability set combines the selected Sandbox and Harness capabilities. `approval` is available when the Harness supports tools, at least one Tool is bound, and every selected Tool adapter supports approval. An HTTP JSON operation's `approval` setting still decides whether that individual call asks for approval; declaring the capability does not automatically turn every operation into an approved operation.

New Sessions return the selected policy under `definition`: exact Harness version, resource timeout, network policy, `capabilities`, `tool_bindings` (tool name to connection ID), and each connection's provider/version/configuration. Later connection edits do not rewrite this snapshot. Credentials remain encrypted references in the control plane and are never included in the Session response. Credential rotation and authorization readiness are live checks, distinct from the pinned configuration.

`commands` represents provider command execution, including its implemented background mode. Session continuation and previews have their own lifecycle: a completed Run does not itself close the Session or stop its background preview process. Neither capability implies permanent uptime beyond the configured provider timeout. Snapshot, pause, resume and desktop capabilities are not advertised by the current adapters.

See the [execution acceptance matrix](../testing/execution-matrix.md) for exact versions, tested model endpoints, both-client coverage and unverified provider combinations. Adapter registration alone is not acceptance evidence.

Daytona is a future candidate, excluded from the current catalog and compatibility matrix by user direction on 2026-11-16. New Daytona Connections and Sessions are unsupported; prototype code is retained to inspect and clean up historical resources.
