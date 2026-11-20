# Public API to cloud Sandbox network enforcement

Date: 2026-11-15. Status: passed. This is the dedicated network-policy branch using a deterministic registered Harness inside real E2B Sandboxes, not an additional model-driven task claim.

Command: `npx tsx tooling/smoke-network-api.ts` (exit 0). `npm run check` passed.
Private journal: `.local/evidence/network-api-bd80c335-3271-4631-ae96-9922387d5242.json`.

The TypeScript SDK used actual authenticated HTTP endpoints to create/validate/enable connections, register `custom.network-probe` version 1, register AgentDefinitions, create Sessions, submit Runs, poll results, download artifacts, close Sessions, and delete the unused Sandbox connection. A real user MiniMax connection was validated in the control plane; the probe Harness itself does not call a model or consume its credential.

The ordinary worker provisioned cloud resources from the Session-pinned policies, bootstrapped Runtime, installed the package through the ordinary custom Harness adapter, executed curl in the cloud workspace, and captured `network.json`. The test compared the final Run output against the downloaded artifact. It did not directly configure a separate Sandbox or issue probe commands via the connector.

| Policy | Session / Run | Cloud results |
| --- | --- | --- |
| unrestricted | `c1ed97a4-12ae-4991-8ce6-87b8a2746015` / `af4af7c1-920a-453d-baa1-4fa2b0bb7fcd` | example.com HTTP 200, exit 0; example.org HTTP 200, exit 0 |
| allowlist: example.com | `4e71d648-a9fd-442b-8ed9-91a10db03b3a` / `93c5e171-c44a-4157-9ddf-819b85413002` | example.com HTTP 200, exit 0; example.org HTTP 000, exit 35 |

Unrestricted baseline and restricted case used the same immutable package and probe destinations, differing only in the pinned network policy. Both Runs completed. Curl bypassed any proxy environment (`--noproxy '*'`) to measure direct Sandbox egress; no credential was sent to either public destination.

Cloud resources `imfhf89e7qiw1g2s5yrjj` and `id49u4hjt6d93bss31nf0` were closed through the product API and independently confirmed absent through provider inspection. Report bytes remained identical after Session close. Final reconciliation confirmed no test-owned resources remained. No template was created.

Unknown-state behavior is supported separately by the Runtime-loss and create/delete-response-loss journeys and the Fleet browser test. This test establishes the declared domain-allowlist path for these HTTPS destinations; it does not establish exhaustive bypass resistance across IPv6, DNS rebinding, wildcard rules or every protocol. Daytona still does not advertise this capability. No commits made.
