# Connection lifecycle through Console with a real E2B resource

Command: `npx tsx tooling/console-connection-lifecycle.ts`. Exit 0; state verified; provider cleanup confirmed. Private journal `.local/evidence/connection-ui-5b2566df-af84-440a-88c3-e72b4fb78b88.json`. `npm run check` passed for the new repeatable acceptance driver. No product changes were needed.

Scope: actual Console, authenticated public API, PostgreSQL and E2B account validation/provisioning/deletion. A fixture model and Harness definition permit a lifecycle-only Session; no model invocation or new full task journey is claimed. The real cloud task plus API lifecycle branch has separate evidence in `2026-11-15-connection-lifecycle.md`.

Session `74f8cee0-bd48-4c61-87f4-f41bb162ad08`; E2B Sandbox `isbzxhdacbdtmpfpkcbei`. Setup creates a dedicated connection and a separate sibling connection with the same authorized provider credential. Browser TaskSpace 14 performs all target connection changes and Session close; no browser API shortcuts are used. Credentials are decrypted from a scoped checkpoint in memory, not printed.

Observed GUI sequence:

1. Delete while the Session is open: Console displays `该连接仍被 Session 使用。请先关闭相关 Session，再删除连接。`
2. Edit name to `Updated lifecycle sandbox` and template to `nonexistent-lifecycle-template`, save: version 3, draft/disabled, masked stored credential and disabled Enable button. This deliberately invalid configuration is never used to create a resource.
3. Restore template `base`, replace only this connection's credential with a deliberate invalid fixture value, save and validate: version 4, invalid/disabled and actionable validation-failure message.
4. Enter the authorized provider credential through the password field, save and validate: version 5, ready but still disabled. Enable explicitly: ready/enabled.
5. Disable: Console states that existing resources remain cleanable. Driver calls actual SDK createSession and submit; both reject `connection_not_ready`.
6. Delete again while disabled and dependent: same dependency error.
7. Open Fleet, select the actual Session, close and confirm: Console displays Session closed, Sandbox destroyed and Runtime stopped.
8. Return to connections and delete: success notice and target row absent.

The driver observes persisted revisions/states throughout, verifies the original pinned Session definition did not change, independently confirms provider resource absence, validates the sibling connection successfully after target deletion, and removes its remaining fixture connections. No provider credential/account is revoked. No new template is created. Fallback inspection confirms cleanup even after successful product cleanup. The local isolated evidence schema is retained for diagnostics; the live API is stopped and browser space closed.

Together with the existing real-task/API lifecycle evidence, this completes configuration/credential/revalidation, disabled scheduling with existing-resource cleanup, and dependency-aware deletion/shared-account preservation acceptance rows.
