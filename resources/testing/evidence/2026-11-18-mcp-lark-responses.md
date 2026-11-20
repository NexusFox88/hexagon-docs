# Remote MCP, Feishu/Lark and OpenAI Responses

Date: 2026-11-18. The user requested complete GUI → credential → SDK → execution integration, then explicitly asked to implement generic connection patterns without waiting for real Feishu/Lark or Responses account credentials. Real-provider evidence and deterministic protocol evidence below are separate. No commits or publication were made.

## Delivered boundaries

- Official MCP client, Streamable HTTP and legacy SSE, public/Bearer/custom-header authentication, paginated tool discovery, selected schema snapshots, default per-call approval, tenant/version checks, and existing ToolBroker execution. No automatic OAuth client onboarding for arbitrary MCP servers is claimed.
- Feishu and Lark self-built app credentials, control-plane tenant-token acquisition, six operations per application, bounded pagination, permission verification, write approval and no replay of uncertain writes. No incoming chat bot/webhook or delegated user OAuth hosting is claimed.
- Native OpenAI Responses validation, exact `/v1/responses` credential policy, OpenCode and Pi protocol selection, updated new OCI compatibility metadata, GUI model protocol choice. Existing immutable OCI registrations are unchanged.
- Both SDKs expose discovery and connection lookup/list alongside existing CRUD and Session bindings. Secrets remain control-plane only; the guest uses the existing scoped mailbox/grant mechanisms.

## Deterministic command evidence

Private outputs: `.local/mcp-lark-responses/`.

| Command | Observed result |
|---|---|
| `TEST_DATABASE_URL=… npm run verify` | 79 files, 238 tests passed; TypeScript check passed (`verify-final.log`) |
| `TEST_DATABASE_URL=… npm run verify:packages` | npm tarball and Python wheel built, installed into isolated consumers; 4 API/SDK suites passed (`packages-final.log`) |
| `npx tsx tooling/smoke-harness-images.ts opencode responses` | Real OpenCode 1.2.27 OCI binary: stream, function call, mailbox result, same-session continuation; cleanup true |
| `npx tsx tooling/smoke-harness-images.ts pi responses` | Real Pi 1.5.2 OCI binary: stream, function call, mailbox result, same-session continuation; cleanup true |
| `npx vitest run testing/console-i18n.test.ts testing/console-journey.test.ts` | Final UI/catalog checks passed after the tool-display-name change |
| `npm run check` | Passed after final code integration |

Responses fixture logs and structured output are also retained under `.local/oci-harness/`. These are actual Harness binaries against a deterministic protocol server in local Docker, **not a live Responses model account and not cloud Sandbox acceptance**. The separate cloud journeys below exercise the actual cloud execution path using the existing real Chat Completions model.

The new tests cover official MCP initialization, authenticated pagination/invocation, legacy SSE header authentication, unsafe address/header rejection, cursor cycles, unsupported schemas, untrusted read-only annotations, tenant ownership and stale discovery responses. Lark tests cover automatic token exchange, official origins, invalid credentials, component/token redaction, and approval/durable unknown-outcome handling for both brands. Responses tests cover bounded validation, malformed protocol responses, native Harness selection, bearer injection and denying other protocol paths.

## Real GUI and cloud execution

In the actual Console, created **DeepWiki MCP** with `https://mcp.deepwiki.com/mcp`, public authentication. Discovery returned three actual tools. Selected only `read_wiki_structure`, explicitly disabled approval for that read tool, saved, verified and enabled. Both clients used this same GUI-configured connection with `tools: {wiki: connection_id}`.

| Client | Actual cloud combination | Outcome |
|---|---|---|
| TypeScript | Vercel Sandbox + Pi 1.5.2 + SiliconFlow international / DeepSeek-V4-Flash | One completed remote MCP invocation; final answer contained `MCP_TYPESCRIPT_OK` and actual documentation topics |
| Python | Vercel Sandbox + OpenCode 1.2.27 + same real model | One completed remote MCP invocation; final answer contained `MCP_PYTHON_OK` and actual documentation topics |

Both sessions are closed, both sandboxes report destroyed, and create/delete resource operations are confirmed completed. Private `typescript.json` and `python.json` preserve Session/Run/call IDs and provider resource IDs for reconciliation. Tool-call arguments identify the public repository `modelcontextprotocol/typescript-sdk`. Test resource disposal did not remove retained answers.

Both SDKs additionally created disposable MCP connections and called their public discovery methods against DeepWiki; both observed all three tools and deleted those temporary connections. The enabled GUI connection remains for the user. Real SSE discovery at DeepWiki's legacy `/sse` returned HTTP 410; no live SSE pass is claimed. The independent SSE fixture passed. Some public discovery attempts failed transiently before the final successful runs; only read-only discovery was retried, never a tool invocation with an unknown result.

The host uses a fake-IP DNS proxy (198.18/15). Direct MCP enforcement correctly rejected that address. Real tests used the platform's existing trusted outbound proxy with `mcp.deepwiki.com` explicitly added to `HEXAGON_ACCESS_EGRESS_HOSTS`; default public-address enforcement was retained. This is an operator-specific network condition, not a relaxation to allow arbitrary private endpoints. The current local process was started with that exact-host allowance; operators restarting with another environment must preserve their allowlist or use ordinary public DNS.

## Browser review and corrections

Used the existing Ego TaskSpace 35; reviewed MCP, Lark, Feishu and Responses configuration in English and Simplified Chinese, including catalog icons, operation labels, password semantics, dialog scroll/action placement, keyboard Tab/Escape, secret clearing on close, and normal/shorter viewport layouts. Screenshots are private `lark-zh.png`, `feishu-en.png`, `responses-en.png`, and `mcp-result.png`.

Corrections found during the actual journey:
- Tool catalog now waits for the application catalog instead of opening a partial list during initial load.
- Public MCP connections display “Public / no authentication”, not “credentials not configured”; the editor explains that no credentials are needed.
- Remote MCP uses its own configuration category rather than being mislabeled HTTP JSON.
- Session execution summaries resolve MCP's internal operation IDs to the pinned original tool name (`wiki.read_wiki_structure`). Confirmed in both languages with the actual completed Run.
- Discovery failures have localized guidance; changed schemas require rediscovery/review rather than silently accepting a wider grant.

Final UI shows the real MCP connection enabled. Local API and worker remain running; no active Runs. The temporary credential ingress was explicitly stopped through `/deployment/ingress/stop` after the cloud journeys. No live Feishu/Lark account or live Responses-capable endpoint was exercised; the user's generic-pattern instruction waived waiting for those accounts, not permission to mislabel protocol fixtures as real provider results.
