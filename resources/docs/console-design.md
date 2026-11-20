# Console design contract

The product UI uses the approved non-color token system in `asset/design-tokens/console-non-color.tokens.json`: Funnel Display headings, Inter body, IBM Plex Mono technical content, square surfaces, fine borders and compact navigation. Preserve the existing Vercel-inspired grayscale and semantic palette, clearly scoped settings and primary actions. The global adoption section below supersedes historical Geist typography and rounded-surface defaults. Preserve Hexagon's product identity and terminology. Official references inspected on 2026-11-16: https://vercel.com/dashboard and https://vercel.com/geist/introduction. The Geist font is self-hosted with its SIL Open Font License in `apps/console/fonts`.

## Information architecture

- Sessions: default entry, API examples, conversation progress and results.
- Infrastructure: independent Sandbox, LLM and Harness pages for configuration and connectivity verification.
- API Playground: first-level developer entry for real API submissions and Python/TypeScript examples.
- Tool connections: optional application authorization and tool capabilities.
- Settings: secondary access to tokens, network, secret management, reusable Agents and resource reconciliation.

Each connection page lists only its own kind. Creation inherits the page's kind; there is no generic Sandbox/Tool kind picker. Existing API schemas, tenancy, encryption and dependency checks remain authoritative. Deep links use `#sandboxes`, `#fleet`, `#tools`, `#http`, `#models` `#secrets` and `#quickstart`.

## No browser-native product UI

Product-owned interactive surfaces must use our styled components. Do not use `alert`, `confirm`, `prompt`, native `<select>`, `<dialog>`, `<datalist>`, native validation bubbles, native date/time/color pickers, or number spinners. Use `components.js` for accessible custom selectors, dialogs and confirmations. Forms use `novalidate` and application-rendered errors. Semantic buttons and text inputs remain necessary accessibility primitives, with appearance and focus styling owned by the application. Browser chrome, OS permission prompts and user-installed browser extensions are outside the application surface.

Custom controls must preserve accessible names, roles, focus visibility, keyboard activation, arrow/Home/End selection, Escape dismissal, outside-click dismissal, modal focus trapping and focus restoration. A dropdown's Escape closes the dropdown before its parent modal. Modal background is inert. Form content scrolls independently of actions; dropdowns adapt to available space. Reduced motion is supported. Credentials clear on closing editors and are never reflected into the UI.

## Implementation

- `index.html`: semantic shell, scoped navigation, dialog structure.
- `style.css`: design tokens, layout, components and responsive rules.
- `components.js`: browser-independent UI interaction contracts.
- `icons.js`: shared small outline icons.
- `app.js`: API bindings, scoped lists, filtering and configuration workflows.

Use actual API data; never fill the console with fake operational status. Keep cloud acceptance history out of configuration copy. Verify UI changes through browser interactions, including draft CRUD, cancellation, keyboard operation, credential references, Fleet detail and narrow viewports. Do not create cloud resources just to verify presentation changes.

## Strict localization

The Console currently supports English (`en`) and Simplified Chinese (`zh-CN`). Every supported locale must have a complete catalog, including matching interpolation parameters. Missing messages are defects and throw rather than silently mixing languages. Adding a language requires a complete catalog, locale negotiation/selector registration and browser review; unimplemented locales are not advertised as supported.

- `locales/en.js` and `locales/zh-CN.js` own product copy. `i18n.js` owns locale negotiation, translation, reactive errors and Intl formatting. Do not hardcode UI copy in view code or markup.
- Saved explicit preference wins, then the first supported browser language, then English. Simplified Chinese variants are recognized; Traditional Chinese is not misrepresented as a supported translation. Storage failures leave the in-memory selector usable.
- The application-owned language selector is available before and after connection. Switching updates the document language/title, navigation, dialogs, forms, placeholders, accessible names, status labels, notifications and validation errors without reloading. Preserve authentication, filters, selected Session/Run and unsaved form values. Password drafts remain only in page memory.
- Dates/times use the selected language and the browser's time zone. Numbers, byte units and lists use `Intl`. API values and machine-readable formats remain invariant.
- Connection names, prompts, Agent output, raw logs, identifiers, provider names and technical codes remain original user/service data. Localize the surrounding labels and error guidance. Unknown service errors receive localized guidance with their technical code.
- Use translation parameters for complete sentences, not translated word concatenation. Render translation strings as text, never executable HTML. Recompute messages on locale changes instead of freezing translated strings at module initialization.
- `testing/console-i18n.test.ts` checks catalog/parameter parity, message references, preference resolution, formatting, reactive errors and literal UI copy in common render helpers. Browser acceptance must also cover both languages, keyboard selection, persistence, draft preservation, dynamic errors and narrow layouts. Static tests supplement browser review; they cannot prove every future UI path is translated.

## Session-led interaction (2026-11-17 revision)

The primary navigation has exactly three destinations: Sessions, Infrastructure, Tool connections. Sessions is the default home. Settings is secondary. No mandatory Agent registration or multi-step journey tabs appear in the primary flow.

A blank workspace points to one Sandbox and one model connection, each verified and enabled. These remain separate from optional Tool connections. Readiness is scoped control-plane verification; a real conversation verifies cloud guest connectivity. Default local credential access is prepared automatically on SDK calls. Console explains this without adding a network setup prerequisite; Settings retains operator diagnostics for actual deployment failures.

After configuring connections, the user opens Create a session via API. The generator selects harness, Sandbox, model and optional Tools, then produces Python or TypeScript programs with install and run instructions. Local mode connects automatically and generates local SDK discovery without application-token setup; hosted mode retains explicit application-token instructions. Creating a Session directly submits its execution definition. Browsing or downloading never creates cloud resources. env/variables are optional nonsecret Sandbox inputs. Each new-session example has a distinct journal; resume, new turn and close remain explicit operations.

Sessions show the latest task and execution state; their detail contains turns, input, output, tool activity, decisions and optional resource diagnostics. ReAct progress means observable execution events and tool calls, not private model reasoning. Credentials, API identifiers and user content retain their original values while all surrounding UI is localized.

Reusable versioned Agents, custom Harnesses, secret management, network settings and resource reconciliation remain secondary settings or diagnostic views. Legacy agent_id API calls and explicit saved-Agent deep links remain supported. They are never prerequisites for first use. Both language catalogs and actual browser journeys must be reviewed after navigation changes.

## Product completion surfaces

The Sessions home spans the basic user flow; infrastructure owns persistent network/ingress settings. Operations includes overview, separately paginated Sessions/Runs, resource reconciliation and pending approval/authorization records. Agents have versioned revisions and reusable connection bindings; Sessions retain their pinned revision. Harnesses show built-in/custom versions and support custom package registration. Access tokens are workspace settings, separate from provider Secrets. Application tokens cannot perform owner administration.

Saved-Agent examples share a private JSON journal between Python and TypeScript. They explicitly distinguish reconnect, new turn and cleanup. Source is collapsible and contains public IDs, not credentials. The HTTP variant exposes corresponding requests and explains response-loss recovery. First-trial programs retain their bounded cleanup behavior.

## Blank-workspace dogfood corrections

Configuration handoff must consider missing and incomplete prerequisites: saved-but-disabled connections lead to verification/enablement of that existing row, not a second connection form. Agent drafts survive visits to connection settings; a sole ready Sandbox/model is selected without re-entering credentials. The selected compatible engine remains visible and editable, with a plain-language explanation. Save checks execution preflight.

Token setup links carry only allowlisted Agent/Session context and return to the originating calling workflow. First-run installation/authentication commands are separated from resume/new-turn/close. Continuation commands must actually submit a new turn. The working directory must be stated. Generated clients reject a journal bound to a different Agent or explicit Session.

Tasks are identified first by task content and pinned Agent name, with technical IDs secondary. Tenant-scoped search supports content/name as well as IDs. Active execution views update progress without replacing focused edits or expanded diagnostic reading. Results distinguish the answer from the still-open cloud workspace and expose explicit continuation and cleanup; unknown cleanup remains pending. See `testing/evidence/2026-11-16-new-user-dogfood.md` for the real blank-workspace journey that motivated these changes.

## Local automatic access

The local Console automatically connects to its loopback control plane without displaying a Token entry prerequisite. Hosted and network-bound deployments retain explicit sign-in. Local SDK examples use Python Hexagon.local() / TypeScript await Hexagon.local(), pinned to the selected local workspace, and omit token creation links and HEXAGON_API_TOKEN commands. Refreshing the page and restarting the control plane must recover the local connection without user credential handling. Both languages must describe this behavior and preserve actual API identifier strings.

## Dense operational views

Infrastructure, Sessions and Tools use flat tables with bounded columns, secondary identifiers, and compact contextual actions. Long model names must not expand rows; task previews are limited to two lines. Session detail prioritizes task, observable execution/tool activity and answer; technical identifiers and raw events are collapsed. Add Tool opens a searchable application-owned catalog, selects one provider, then opens its credential editor. Catalog keyboard navigation and focus restoration must work in both languages. Console assets are published as a coherent startup snapshot; idle views detect a new release while active configuration drafts remain intact.

## Body surfaces and conversation stream (2026-11-18)

Keep the primary navigation stable. The content area has one title/action header and one working surface. Populated lists do not repeat introductory paragraphs, eyebrow labels or total/enabled/configuration summary cards. Context and next steps belong in empty states and editors. Tables use neutral separators, restrained state indicators and bounded metadata. Creation is a header action. Tokens, Harnesses, tasks and resource operations use rows; optional creation forms and operation details expand in place. Fleet detail replaces its list and exposes a return link.

The API example is a unified two-column workspace: execution configuration on the left, language tabs and executable commands on the right. It becomes a single column on narrow screens. Local authentication guidance is concise and must not reintroduce a Token prerequisite, including on the advanced Tokens page.

Session details are chronological conversations: user messages align right, Agent replies left, all returned turns are shown in order. Completed execution detail and raw events collapse under their respective reply; active progress remains discoverable. Display only observable events, not invented reasoning. Historical turns do not repeat workspace cleanup actions. Markdown uses Marked with a restricted renderer: raw HTML is escaped, links allow only HTTP(S), and remote images are not fetched. Formatting never changes stored output.

Editors prioritize required fields and credentials. Provider capability explanations and Tool operation permissions expand on demand. Reuse one modal structure, compact spacing, application-owned selectors, visible focus and fixed footer actions. Focus starts in the form, or on Cancel for confirmation; Escape dismisses without committing. Include disclosures in focus trapping. Review all registered provider/application form variants, not just the connection type used in the cloud test.

## Readability correction — 2026-11-18

Use Geist 14px body/labels/buttons, 13px secondary text, 12px tertiary metadata, and 16px conversation prose. Page headings are 24/32px. No global zoom or transform scaling. Content uses 32–40px gutters and a 1440–1600px maximum canvas; conversations use up to 1120px with readable prose, not a small island. Lists use 64px two-line rows and 14px text. Configuration controls are 36–38px tall. Dialogs use the same text scale. Self-host application identity artwork in every catalog choice; never load third-party tracking images at runtime. Harness belongs to Infrastructure. Playground is an explicit API debugging action, not an automatic cloud run on page entry.

## OCI Harness page and contextual toolbar

Harness registration uses an OCI address form in an application-owned modal. The registered table shows name/version, repository/short digest, Runtime protocol and distribution type; full references and SDK registration live in details. Template recipes are separate from published upstream images, with no fabricated cloud verification status. Legacy source/installers remain visibly labeled. API Playground filters OCI choices against the selected Sandbox provider's declared capability.

One contextual toolbar carries the page title and actual page actions. Do not repeat the workspace and environment in a separate full-width banner. Infrastructure context sits above its title; Session detail uses the Session name as the title. Language selection remains accessible both before connection and in detail views.

## Overflow and refresh contract

Tables own horizontal overflow inside labeled keyboard-focusable regions; they must not widen the document. Menus remain within the viewport and scroll independently when necessary. Modal headers and footer actions stay visible while the body scrolls. Tab closes transient menus before moving focus; replacement controls retain focus after form rerender. Mobile navigation closes on Escape and returns focus to its toggle. Conversation refresh must keep existing content visible until the complete replacement is ready; completed detail views do not poll unnecessarily.

Sandbox, model and Tool creation share the same searchable icon-card catalog and keyboard/modal contract. Sandbox chooses a provider; LLM chooses a wire protocol, not a vendor. Selecting a card opens the matching editor without requiring the user to repeat that choice. Model compatibility is filtered by the selected Harness's actual declared protocols.

## Shared resource and form constraints (2026-11-18 audit)

Text-input height selectors must exclude checkboxes/radios. Checkboxes use a fixed 16px square, an application-drawn check mark that works under the Console CSP, and visible keyboard focus. Permission sections have one visible title; an accessibility legend must not repeat it visually. Rows group the operation name and technical permission metadata beside the checkbox.

Connection lists show one actionable availability state: ready only when verified and enabled, disabled when verified but disabled, otherwise the verification state. Session execution and workspace lifecycle remain separate: execution in its own column, explicitly labeled Session lifecycle beside the Session identifier. Never present Session lifecycle as a Sandbox resource observation. A closed Session with no Run is not a completed Run. Status labels must remain complete; longer content identifiers may truncate only in navigation rows where their detail remains reachable.

Use resource-specific column widths rather than universal nth-column percentages. Default two-line resource rows target approximately 60–64 CSS px, with 14px primary text and 12–13px metadata. Do not obtain density by shrinking typography. Agent lists use the full content width until an editor is open. Task, token and resource lists group identity and metadata rather than spreading one record over multiple full-width blocks. Expandable creation forms must not repeat the disclosure title inside the form.

Browser review includes the real CSP, English and Chinese, narrow layouts, actual checkbox Space toggling, dialog scrolling, persistent footer actions, and Escape focus return. Passing catalog/type/unit checks is necessary but is not visual sign-off.

## Scroll ownership (mandatory)

The application shell is exactly one dynamic viewport high. The document must not scroll. Sidebar/navigation, page title, primary actions, filters and pagination remain visible while the user browses records. List pages give their remaining height to one labeled, keyboard-focusable data region; table headers stick inside that region. Never approximate the available height with a per-page pixel `max-height`, shrink type to fit records, or add another competing vertical scrollbar around the same list.

Session detail keeps identity and view tabs fixed; conversation or initialization content owns scrolling. Desktop Playground and Agent editors use independent bounded panes. On narrow screens those panes become a single content scroll region so every form field and generated example remains reachable. Navigation may scroll independently only when its own contents exceed the available height.

Dialogs keep their title, close button, catalog search/filter controls and submit/cancel actions outside the body scroll region. Only the body/list scrolls. Menus and selects must remain inside the visible viewport and their clipping ancestor. Escape, Tab, Home/End and PageUp/PageDown must work without moving the underlying page or losing focus. Data refresh preserves the current region position; explicit navigation to a selected conversation turn remains effective.

Before accepting a layout change, exercise a populated list with real wheel input, keyboard scrolling and refresh; inspect sticky headings and pagination; open long catalogs and forms at desktop, short-height and narrow widths; review both English and Chinese. `testing/browser/console-scroll.mjs` exports `verifyConsoleScroll(page)` for the managed ego-browser Page and asserts the populated Session list contract against the running local Console. This is a browser acceptance check, separate from deterministic unit tests; it requires existing Sessions and never creates cloud resources.

## Request transparency and surface hierarchy

Playground must expose its REST request sequence alongside SDK examples, deriving payloads from the same current form used by submission. Show method/path, headers, JSON bodies and copyable cURL, including local bootstrap headers and hosted-token placeholders. Environment values must not be reflected into request examples. Distinguish preview placeholders from responses and explain per-turn idempotency keys.

Use the Hexagon outline pulse for route loading, refresh and asynchronous action buttons; reduced-motion disables animation. Tables use quiet surfaces, alignment and hover/focus indication instead of boxed cells and heavy row rules. Preserve readable type and explicit column widths for timestamps. Tool Usage separates Agent defaults, all Session assignments and actual call history; history links lead to the matching Run within its Session.

Language selection is a global preference: place it with Settings at the bottom of the desktop rail and inside expanded mobile navigation, never among page-specific actions. The login screen hosts the same control above its content. Preserve the current route and visible focus when switching language; mobile navigation must remain open if the language control initiated the switch.

Sandbox onboarding connects a provider account, not a running machine. After catalog selection, show provider identity, credentials and required project/workspace fields first; prefill a readable connection name. Templates, resource defaults and capability notes belong in collapsed Advanced configuration. Saved credential selection is a secondary disclosure. DOM/Tab order must match visual order. The primary action saves, validates and enables; a saved identity must survive validation failure so retry updates the same connection. Ambiguous creation responses require checking the list, not blind resubmission.

## Session reading measure

Session detail uses a title and one navigation row. Back navigation, Conversation/Initialization and diagnostics must not become separate full-width header bands. The conversation is the scroll owner; individual turns share an 800px maximum reading width. Right-aligned user messages and left-aligned Agent responses stay within that measure, with 15–16px body copy. Single-turn sessions omit turn numbering. Keep global platform footer/status out of the transcript page; operational diagnostics remain directly accessible.

## Shared page composition and review gate

All Console routes use the same title/action band with 22px top and 16px bottom padding; no duplicate in-content page title or decorative platform footer. A parent breadcrumb is permitted for Infrastructure. Lists fill the available workspace; settings/forms use 720px and configuration/diagnostic details use a maximum 1040px. Conversation turns retain their separate 800px reading measure. Section spacing is 20px, property rows use 8px gaps and readable 14px text; avoid stacking headings, identity paragraphs and oversized cards for each property group.

List/table and detail content own scrolling, with stable header and footer actions where present. Double-column workspaces stack on narrow screens, using one content scroll region. Configuration snapshots use a label/content grid on desktop and stack their group label on mobile. Keep raw JSON and SDK creation examples available without imposing a second short vertical scroller inside the snapshot.

Changes to these shared rules require `testing/browser/console-layout.mjs` against all exported routes at desktop and 390px, visual inspection in both locales, and `testing/browser/console-scroll.mjs` for actual wheel/keyboard/refresh behavior. Geometry assertions supplement screenshots and a real user journey; they do not substitute for them. Record the evidence and distinguish existing configured connections from fresh account authorization.

Detail return navigation uses the shared `#page-back` title-row control, never a link in tabs or an extra content band. Parent destinations are explicit: Session→Sessions, Tool usage→Tools, resource detail→Fleet, task detail→Runs, and Session-seeded Playground→source Session. Lists hide the control. All labels are localized and keyboard activation must work.

Navigation parents are resolved centrally in `navigation.js`. Fleet selection and Agent editing must update the URL; changing only the rendered body creates a broken return action when the parent hash is unchanged. A Session snapshot reused in Playground returns to that Session's Initialization view. Saved-Agent Playground returns to its Agent detail. Settings subpages return to Settings. List filter state survives detail navigation, and stale Agent fetches cannot redraw a different route. Browser acceptance must exercise clicks, keyboard return and reload, not just direct-link screenshots.

## Session overview and serverless entry — 2026-11-19

API Playground is the first top-level navigation entry. Missing Sandbox, model, Harness or optional Tool configuration links open separate tabs, preserving the current draft. On return, refresh choices only when persisted configuration changed; ordinary focus must not rebuild unchanged form controls.

Sessions intentionally have a compact activity overview above their list: current active Sessions and a 24h/7d trend, with idle/sleeping counts and an explicit metric definition. The dashboard and pagination remain fixed; records alone scroll. Provider cells use self-hosted icons and brand display names. API identifiers remain unchanged. Execution success is green, execution/fetching blue, failure red, action-required/cancellation pending amber, and inactive/closed neutral. Harness is called Harness throughout selection and list headers.

Template cards prioritize icon/name/version, protocol summary and compact actions; full verification records remain in details. Hermes and OpenClaw must use their real identity artwork.

Sleeping is not closed. New requests automatically wake a sleeping Session. Only a connector with verified memory-preserving pause_resume may claim idle compute sleeps; otherwise explicitly describe retained compute. Do not make manual wake a prerequisite to message submission.

## List readability correction — 2026-11-19

Provider identity is a 16px contained brand image, 8px gap and single-line display name. Give identity/status/action columns explicit content budgets; do not compress them with percentage widths. A narrower window scrolls the table region horizontally without widening the document. Preserve 14px primary type and approximately 64px ordinary two-line rows.

Session lifecycle belongs beside the Session identifier with an explicit localized Session label, never beneath the Sandbox provider. Latest Run outcome remains in its own column. Provider identity is not an observation of live compute state. Harness name/version use separate bounded lines; complete initialization remains available in Session detail. Model identifiers may wrap, while authentication requirements and verification states must never be silently clipped. Registered Harness rows use concise evidence summaries; details retain exact verification scope.

### Appearance

The Console supports `system` (default), `light` and `dark` in the sidebar preferences, with the same application-owned keyboard-accessible control on the sign-in surface and mobile navigation. Persist only the appearance preference in local storage. Resolve it synchronously before styles load, follow system changes when selected, and tolerate unavailable storage. Every shared surface, form, menu, code panel and semantic state uses the palette in `theme.css`; do not add isolated hardcoded light backgrounds. Brand artwork retains its original colors on a small contrasting backing in dark mode. Both locales and both appearances are review requirements.

## Parallel request formats and brand appearance

API Playground presents SDK and REST API as sibling tabs over the same editable request. Python/TypeScript are nested choices inside SDK. Both the new-session and reuse-session paths use the shared output component. Arrow keys, Home/End, active-tab focus, and panel labels are required; switching representations never submits a request or discards form data.

Brand artwork must be checked in tables, template cards, catalogs and editor headers in both themes. Monochrome marks adapt to the active foreground; colored/raster marks retain their palette on a light backing. Apply the policy to the shared asset namespace, not a hand-picked set of page classes. Interface SVGs use currentColor. OS and explicit application appearance can differ.

## Historical non-color token pilot — 2026-11-19 (superseded by global adoption)

At the user's request, the Sandbox connections page (`#sandboxes`) and its application-owned dialogs trial `asset/design-tokens/console-non-color.tokens.json`. This is a scoped exception to the Geist/title geometry defaults: Funnel Display headings, Inter body, IBM Plex Mono identifiers, 28/36px page title, square controls, flat surfaces and token spacing. The three font families are self-hosted with licenses. Existing theme colors, shared sidebar, connection actions, localization, permissions and scroll ownership remain authoritative. Two-line connection rows retain their 64px readability budget instead of adopting the 44px single-line token. Other routes retain their existing appearance.

`node tooling/generate-console-pilot-tokens.mjs` regenerates the scoped CSS variables from the portable JSON. `sandbox-pilot.css` maps those values to existing components without changing rendering or API handlers. This pilot does not approve a Console-wide rollout.

## Global non-color token adoption — 2026-11-19

The user approved the Sandbox pilot and explicitly requested Console-wide adoption. `design-system.css` now maps `asset/design-tokens/console-non-color.tokens.json` to the shell, sign-in surface, all routes, lists, settings, catalogs, editors, dialogs, conversation surfaces and code. `npm run console:tokens` regenerates `design-tokens.css`; marketing-profile values remain excluded. `design-fonts.css` loads self-hosted Funnel Display, Inter and IBM Plex Mono with OFL licenses under `fonts/design-system`. These rules supersede the prior pilot scope and historical Geist/radius defaults.

Use 28/36px page titles, 20/28px section headings, 14/22px body text, 13/20px control labels, 12/18px metadata and 13/20px technical content. Sidebar width is 256px (Console adaptation for complete monospace navigation labels); page gutters are 32px desktop / 16px narrow. Controls and surfaces are square; menus and dialogs are flat with their existing border/surface colors. Provider artwork treatment remains intact; status marks and avatars must be square or character-based, never circular. Textual tab/selection indications, focus rings, and semantic colors must remain visible.

Preserve 64px two-line record budgets, 15–16px conversation prose, the 800px conversation reading measure, existing per-resource column budgets, pinned title/actions and independent content scrolling. Sandbox-specific column sizes must not be imposed on other resource lists. Desktop controls use a 36px minimum, mobile inputs/selectors/footer actions use 44px; controls may grow for localization. No new product copy, route, API call or behavioral change is required for token adoption. The existing light/dark theme remains the sole color authority.

### ASCII visual language and preserved identity — 2026-11-20

The user explicitly requires ASCII-oriented controls and non-circular statuses/avatars. Navigation labels, action labels, metadata and status markers use IBM Plex Mono while display headings and readable prose retain the approved hierarchy. Status indicators use bracketed glyphs alongside existing localized labels (`[+]`, `[!]`, `[>]`, `[?]`, `[-]`, `[ ]`); the connection indicator is a square. Avatars, plan markers, menus, cards and code surfaces have zero radius. Disclosure affordances use `[+]` / `[-]`; selectors use a character chevron. Glyphs must not replace accessible names or encode status without a text label.

The user explicitly rejected replacing the loading animation and left-side identity/icons. Preserve the original Hexagon logo files and Geist wordmark, original SVG navigation/interface icons, original loading artwork/animations and provider identity artwork. ASCII styling is not permission to replace these assets or their animation behavior.

### Sidebar label containment — 2026-11-20

Reserve enough width for both complete locale catalogs, including “Credentials & secrets”. Navigation rows use a minimum height and vertical padding, never a fixed height that lets wrapped text escape its active background. Keep workspace avatars at 26×26px without flex shrinking. The portable 224px sidebar token is a starting value; this Console uses 256px for its actual label and indentation budget. Preserve full labels and readable font sizes.

### Record typography — 2026-11-20

All table renderers and record cards share IBM Plex Mono: primary cell/name text 14/22px, headers/actions 13/20px, secondary metadata 12/18px. Name buttons and plain strong elements must agree; do not let semantic markup choose a different font or size. Record headings are not display headings. Conversation prose remains in the body family. Workspace identity uses 13/16px primary and 12/16px secondary text with no interline margin, aligned with a non-shrinking 32px square avatar.

### Long values and shared control audit — 2026-11-20

List data values use visual single-line ellipsis rather than forced wrapping or destructive substring shortening. `list-values.js` preserves original text and existing link/button actions; long plain labels open a full-value dialog by pointer or Enter/Space. Each long value has one standard outline copy icon; successful copy briefly shows a check. Do not use literal `[]` as a copy affordance or add a second ellipsis button beside truncated text. Copy the complete supplied value, including full resource IDs and image references/digests. An input preview remains the API-supplied preview, not an invented complete prompt. Clipboard failure opens a localized fallback with selectable text. Closing returns focus. No credential values are fetched for this UI.

Select triggers truncate within their available width; expanded options and action menus grow vertically to preserve complete labels. All forms use 14/22px input text, 13/20px labels/actions and 12/18px hints. Table action labels must remain complete. Catalogs, dialogs, selects and page variants must be exercised in both locales and at narrow/short viewports; preserve all original identity/loading assets and the existing palette.

Dropdown sizing must intersect ancestor and viewport bounds. Mobile preferences remain inside the viewport when expanded; the mobile brand row must never overlap scrolling navigation. Tables use `overflow-anchor: none` alongside explicit refresh-position restoration. Credential availability labels remain single-line and fully visible. See `testing/evidence/2026-11-20-console-surface-audit.md` for the surface review and browser regressions.
