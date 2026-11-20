# Hexagon development

Read docs/architecture.md and testing/acceptance.md before changing product behavior.
The acceptance source is the user-supplied journey; do not shrink it to existing code.
Local and hosted refer to the control plane. Real acceptance uses cloud sandboxes.

## Boundaries
- Control plane owns Session/Run and cloud resource operations. Sandbox Runtime owns harness processes.
- Provider credentials stay in the control plane. Never log or commit secret values.
- Every resource lookup and cross-resource binding must validate tenant ownership.
- Persist events before streaming them. Client disconnect does not cancel a Run.
- Unknown remote operation outcomes require reconciliation, not blind retry.
- Both Python and TypeScript SDKs must pass the full journey.
- Do not make git commits or publish anything for this task.

## Verification
Use package.json scripts as they become implemented. Record real command results in testing/evidence; do not label planned tests as passed. Real provider and model tests are separate from deterministic simulations. Preserve resource IDs in local private evidence so failed cleanup can be retried.

## Product UI
- Follow `docs/console-design.md`: Vercel Dashboard / Geist visual and interaction conventions.
- Keep platform Sandbox configuration separate from Agent Tools, protected APIs and model endpoints.
- No browser-native product UI: native alerts/confirms/prompts, selects/dialogs, validation bubbles, date/color pickers or number spinners. Reuse accessible application-owned components; preserve keyboard operation and focus management.
- Console localization is mandatory: all product copy belongs in complete `en` / `zh-CN` catalogs, including errors, accessible names and dynamic states. Use `i18n.js` / Intl; preserve user content and API identifiers. New UI must pass catalog checks and both-language browser review. See the strict localization contract in `docs/console-design.md`.

## Source language
- Keep non-documentation source, comments, configuration and example messages in English. Documentation and README files may be multilingual.
- Store localized Chinese strings and intentional Unicode regression fixtures as Unicode escapes; preserve runtime localization and Unicode coverage.
- Run `testing/source-language.test.ts` to enforce this boundary.

## Marketing website ownership
- The marketing website is maintained only in https://github.com/NexusFox88/Haxegon-Website. The original local checkout is `/Users/hexagon-maintainer/CodeProject/Haxegon-Website`; on other devices, clone that repository into any directory.
- The former `website/` directory has been removed from this product repository. Do not recreate it, copy website changes back here, or deploy this repository as the marketing website.
- For website work, switch to the standalone repository and follow its `AGENTS.md` and `DEPLOYMENT.md`. Its `main` pushes automatically deploy to Cloudflare; the product Console and shared brand masters remain in this repository.
