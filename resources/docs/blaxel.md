# Blaxel connector

Blaxel uses per-connection REST credentials, with no process-global workspace or API-key state. Configure `workspace`, `image` (default `blaxel/base-image:latest`), `memory_mb` (at least 2048), and optional `region` in Console. Store the personal API key in the credential field. API, independent workers, and API acceptance journeys share `integrations/sandboxes/registry.ts`.

## Provider boundaries

- Create names are derived from the persisted operation UUID; uncertain creation is reconciled by that exact name, never by another create.
- Expiry uses an absolute provider timestamp. Compute deletion polls until 404 or the provider's terminal `TERMINATED` tombstone. Preview resources are explicitly listed, deleted and rechecked; terminated compute alone is not proof of endpoint cleanup. The lifecycle invokes associated-resource cleanup even after compute expiry. Transport/authentication failures do not mean absence.
- Data-plane URLs come from the provider's resource metadata, are restricted to HTTPS under `.bl.run`, and never follow redirects with account credentials.
- Binary reads explicitly request `application/octet-stream`; writes use multipart with private file permissions.
- Background processes set `keepAlive` with a bounded process timeout. Runtime pins its own port 8765, overriding base-image `PORT`, and supports IPv4/IPv6 listeners.
- For IPv4-only user applications, the connector starts a provider-managed IPv6-only listener on the same port and forwards to IPv4 loopback. Native IPv6 applications are left untouched; Runtime already listens on both families.
- Previews are private. Their access token stays in the control plane in `X-Blaxel-Preview-Token`, preserving Runtime's separate Authorization header. Public or unexpected preview URLs fail closed. Valid preview tokens are reused rather than minted on every proxied asset request.
- Outbound allowlists are not implemented or advertised. Requests requiring them are rejected before allocation.

## Host and image compatibility

On a host that needs an HTTP proxy, run Node 24 with `NODE_USE_ENV_PROXY=1` and keep localhost in `NO_PROXY`. This enables the existing host proxy; no model gateway is introduced. The local development service uses this setting.

The default Blaxel image is Alpine/musl. OpenCode 1.2.27's upstream postinstall chooses the generic Linux binary even on Alpine. Hexagon installs the fixed package with dependency lifecycle scripts disabled, explicitly selects the installed native package matching libc/architecture/AVX2 support, and verifies its version. Runtime still executes the native binary directly so signal termination is not masked by the JavaScript launcher.

## Verification

`NODE_USE_ENV_PROXY=1 npx tsx tooling/smoke-blaxel.ts` passed real creation, operation lookup, binary files, Python/Node execution, Runtime health, unauthenticated rejection, private HTTP preview and deletion confirmation on 2026-11-15. See `testing/evidence/2026-11-15-blaxel.md` for the full journey status.
