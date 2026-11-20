# Contributing to Hexagon

Project code is licensed under Apache-2.0; see LICENSE. The main repository is [NexusFox88/Hexagon](https://github.com/NexusFox88/Hexagon). Use the contribution options and policies shown there. This guide describes engineering requirements.

Read [architecture](docs/architecture.md), [acceptance](testing/acceptance.md) and [Console conventions](docs/console-design.md) first. The user's journey defines acceptance; do not reduce it to current implementation. Keep changes narrow and preserve failed evidence.

## Local checks

Use a dedicated PostgreSQL database and locked dependencies (`npm ci`). Run `TEST_DATABASE_URL=... npm run verify`, `npm run verify:packages`, and `npm run release:check`. Database tests create isolated schemas. Python Runtime checks need Python 3.10+. Tests do not need personal cloud keys; see `testing/` fixtures and connector unit tests. Real-cloud runners require explicit credentials and quota, and must preserve private resource IDs until cleanup is confirmed.

## Ownership and extensions

| Change | Implementation boundary | Contract / checks |
|---|---|---|
| Sandbox | `integrations/sandboxes`, `modules/sandboxes/connector.ts` | Implement declared capabilities only; lifecycle intent/receipt/reconciliation; connector and lifecycle tests |
| Harness | `integrations/harnesses`, Sandbox Runtime | [Harness contract](docs/harness-integration-contract.md), [OCI examples](examples/harnesses/oci), initialization/bridge/native recovery |
| Tool | `integrations/apps`, shared broker | [Application connectors](docs/application-connectors.md), schemas/auth/approval/uncertain writes; no credentials in guest |
| API / SDK | `apps/control-plane`, domain modules, `sdk/` | Python + TS parity, tenant isolation, idempotency, installed-package checks |
| Console | `apps/console` | Shared accessible components; complete en/zh-CN catalogs; actual browser review in both languages/themes |

Reuse an existing connector test and deterministic fake transport before adding provider calls. A fixture pass is not cloud acceptance. See [custom Python Harness](examples/harnesses/python-agent/main.py) and [source-package protocol](docs/custom-harnesses.md). Never execute untrusted Harness registration in the control plane.

Cross-resource references must validate tenant ownership. Persist events before streaming. A disconnect does not cancel execution. Unknown remote outcomes require reconciliation, never blind replay. Model identity text does not change account authorization. One Run per Session and immutable pinned definitions remain shared contracts.

## Review and evidence

Describe the concrete before/after behavior, affected contracts, commands actually run and remaining gaps. Do not include secrets, raw request bodies, `.local`, database backups or user prompts in public reports. Use fabricated fixtures. Link sanitized evidence separately from private cloud IDs. Changes to connectors/Harness versions invalidate matching claims until relevant journeys are rerun; do not rewrite historical evidence as if it tested new code.

No cloud or publishing workflow runs automatically for external contributions. Maintainers must review code before supplying any secrets; do not use pull_request_target to execute contributor code with credentials.
