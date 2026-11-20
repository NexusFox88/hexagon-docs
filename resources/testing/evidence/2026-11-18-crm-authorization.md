# CRM authorization completion — 2026-11-18

## Implemented scope

| Connector | Authentication | Operations | Real CRM account acceptance |
| --- | --- | --- | --- |
| HubSpot | Private access token; OAuth authorization code | Existing 7 contact/deal operations | Unverified |
| Salesforce | Access token; OAuth authorization code with PKCE, pinned My Domain | 12 Contact/Account/Opportunity list/read/create/update operations | Unverified |
| Attio | Access token; OAuth authorization code | 4 list/read/create/update record operations across people/companies/deals | Unverified |

Catalog now contains 37 named applications. CRM has a separate bilingual category and icons. Attio icon is a locally authored monogram; Salesforce attribution is in the brands README.

## Shared behavior

- Local allowed operations, provider-reported scopes, and permission evidence are separate fields. Unknown scope is never synthesized from operation names.
- Token onboarding and OAuth callback share verification. Attio inactive tokens fail even when introspection returns HTTP 200. Salesforce object describe and HubSpot read probes never perform test writes. Permission evidence is not a guarantee of field-level/record-level access.
- Grants remain encrypted in the control plane. The existing Tool Broker resolves credentials outside the Sandbox; snapshots and SDK authorization metadata do not contain original secrets.
- OAuth refresh commits a durable attempt before remote exchange, avoids holding a DB transaction over HTTP, binds grants to client ID, and fences uncertain rotating refreshes rather than blindly replaying.
- Local disconnect cancels pending consent flows, disables/version-bumps the connection, deletes its stored encrypted credential copies, and detaches managed-secret references. Independently owned managed secrets are not deleted. Provider-side revocation is explicitly false; already-dispatched requests cannot be recalled.
- New Session snapshots pin verified account identity. A later account swap is rejected before tool dispatch. Legacy snapshots without identity and providers without stable identity cannot get this guarantee retroactively.
- Python and TypeScript expose authorization-status and disconnect methods. Console shows account/scope/evidence, partial verification, authorization state and local disconnect.

## Actual commands

Final command:
```sh
TEST_DATABASE_URL=postgres://hexagon@127.0.0.1:55432/hexagon npm run verify
```

Result: exit 0; TypeScript check passed; **93 files / 297 tests passed**, duration 35.24s. Private log: `.local/crm-verify-final.log`.

New coverage includes CRM request mapping/validation, fixed Salesforce destination, permission denial and unknown write permission, Attio inactive tokens, successful OAuth callback fixtures for all three CRMs, uncertain refresh fencing, OAuth client swap, tenant isolation, encrypted credential removal, pending-flow cancellation, and the Console permission-count regression.

`testing/crm-sdk-journey.test.ts` runs a real HTTP control plane/Postgres with Python SDK child process and TypeScript SDK: create/validate/bind Session, inspect initialization, invoke Tool Broker, redact secret values, reject account swap, disconnect, and pause subsequent calls for authorization. CRM responses are controlled fixtures and Sandbox/model definitions are simulated. **This is not real cloud Sandbox execution, provider consent, or live CRM acceptance.** Existing cloud compatibility evidence is separate and cannot establish CRM-account verification.

An earlier regression run found catalog counts still asserted 35 rather than 37; both SDK count assertions were updated. Browser review found permission counts targeting the new verification disclosure, producing 0/0; a dedicated selector and regression check fixed that.

## Actual browser review

Ego Browser TaskSpace 43 (closed after review), local service at port 8787:

- English Salesforce: catalog icon, required My Domain, token/OAuth switch by keyboard, preserved instance value, OAuth client fields, body scrolling and visible footer, Escape dismissal.
- Chinese Attio: account identity, provider scope and per-operation evidence; selected-operation count 2/4 remains independent of verification disclosure.
- Chinese disconnect: application-owned confirmation explains local-only effect; completion shows no credential and draft status. SDK status confirmed disconnected.
- Chinese HubSpot at 390 × 844 CSS pixels: token form, OAuth keyboard switch, readable labels, modal content and footer buttons visible.
- Final updated catalog reviewed in both languages: CRM 与客户 / CRM & customers.
- Reviewed screenshots: `.local/crm-salesforce-en.png`, `.local/crm-attio-zh.png`, `.local/crm-hubspot-narrow.png`.

The UI fixture was explicitly labeled not live, used a fake token, stayed disabled, was never sent to a provider, and was disconnected and deleted. Its private cleanup journal is `.local/crm-ui-fixture.json`. Existing user connections were not edited.

Service restart completed successfully with the final code. No commits or publishing.

## Remaining external acceptance and explicit limits

No live CRM credentials or provider consent were used. Real consent, refresh rotation, tenant-specific object/field permissions, quotas and live record operations remain unverified for all three connectors. GUI configuration is available; catalog evidence does not label them live.

Salesforce currently requires a validated HTTPS *.my.salesforce.com origin, uses REST v62.0, and list operations return recent items, not complete exports. Attio supports three standard objects, not arbitrary custom-object discovery. HubSpot private-token write permission is unknown when the provider does not expose a grant scope; verification does not write test records.

Old OAuth envelopes without client binding require reauthorization. Providers that do not report expiry are not assigned invented expiry. After authentication failure, the connection is invalidated for reauthorization/verification; unknown remote writes are not replayed. OAuth refresh with an uncertain result requires reauthorization.

No automatic provider-wide token revocation or external KMS product was added. Those are separate capabilities, not claims made by local disconnect.

## Sources used for request contracts

- Attio introspection: https://docs.attio.com/rest-api/endpoint-reference/meta/identify
- Attio OAuth: https://docs.attio.com/rest-api/tutorials/connect-an-app-through-oauth
- HubSpot current OAuth token: https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/create-oauth-token
- Salesforce REST authentication: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_authentication.htm

The sources inform mapping; passing controlled fixtures is not evidence of provider-account interoperability.
