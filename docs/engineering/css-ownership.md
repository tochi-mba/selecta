# CSS ownership and cascade order

Who owns which rules in the app's own stylesheets, the order they load in, and the few places where a rule wins by force. Owner: ADR-0368 (UF-0368-01, -02, -07). The selector-level register (repeated shared class names, breakpoints and the PR review rules) is ADR-0278's `docs/adr/completion/css-ownership.md`, checked by `web/src/styles/css-ownership.test.ts`; this page adds the load-order owners, token ownership and the `!important` exceptions. `web/src/styles/uf-cascade.test.ts` fails when `web/src/main.tsx` loads a sheet in a different order from the table below, when a stylesheet exists that this page does not list, when a `!important` appears that is not in the exceptions table (or one listed here has gone), when a raw colour appears outside `tokens.css`, or when a sheet other than `tokens.css` defines a semantic token. The Cloud, Rooms and Devices sheets come under `tokens.css` and the cascade checks (ADR-0462, BF-0462-07) and are listed under [Feature sheets under the tokens](#feature-sheets-under-the-tokens). Every other sheet in `web/src` is listed under [Other sheets](#other-sheets), with what checks it today. The design system's entry page is [design-system.md](design-system.md).

## Load order

Later sheets win ties of equal specificity. A sheet only refines what an earlier sheet set; it never redefines a token.

| Order | Sheet | Owns |
| --- | --- | --- |
| 1 | `styles/tokens.css` | Every value: palette, semantic roles (text, surface, focus, selection, status, border, edge), spacing, type, motion, density and theme overrides. The only place a raw colour may appear. |
| 2 | `styles/boot.css` | What shows before an app has a frame: the runtime and sign-in messages (`.cloud-runtime-message`, `.cloud-welcome`, `.cloud-onboarding`, drawn by `RuntimeApp.tsx`, `CloudRoot`, `CloudApp` and `CloudStates`) and the brand mark (`.brand-mark-badge` from `ui/BrandMark.tsx`, and `.cloud-mark` on the older screens). Loaded right after the tokens, so these screens are styled in local mode and in the Cloud before any page sheet arrives (moved out of `cloud.css` in `1d41a445`). |
| 3 | `style.css` | Element defaults and the legacy page layouts that came before the split sheets. |
| 4 | `styles/shell.css` | The frame around every page: rail, phone tab bar, context bar, mini-player, overlays, notifications, skeletons. |
| 5 | `styles/polish.css` | Shared finish over legacy layouts: hit targets, focus that never moves, reveal and pop-in motion, the exit protocol's `[data-closing]` animations and their reduced-motion fade, reduced-motion overrides. |
| 6 | `styles/foundation.css` | Small building blocks every page uses: primary action, Activity, command palette parts. |
| 7 | `styles/cloud-ui.css` | The Cloud look for the shared primitives, scoped to `:root[data-cloud='on']` so local mode is untouched: buttons, fields, page headers, cards, card grids, badges, empty states and the page arriving. |
| 8 | `styles/cloud-shell.css` | The Cloud shell, scoped to `.shell[data-mode='cloud']`: the rail and its account foot, the top bar and room pill, the phone tab bar and the mini player. It refines `styles/shell.css` and never restates one of its Cloud-scoped rules. |
| 9 | `styles/listening.css` | Onboarding, Explore (Make a Mix), Listen, My Mixes and Requests. |
| 10 | `styles/creation.css` | The editor, the transition inspector and the Studio. |
| 11 | `styles/operations.css` | Discovery, Library, Workspace, export and listening studies. |
| 12 | `styles/music-objects.css` | Cross-scene musical objects: motifs, verified transition, energy and request path. |
| 13 | `styles/glossary.css` | The glossary dialog and inline term hints. |
| 14 | `styles/palette.css` | Search and command palette result groups. |
| 15 | `styles/icons.css` | Icon slots, badge baselines and icon-only control geometry (ADR-0277). |
| 16 | `styles/depth.css` | Surface depth, borders, shadows and accent hierarchy beyond a token (ADR-0276). |
| 17 | `styles/typography.css` | Type roles applied where an earlier rule left a gap; loaded last so it owns type (ADR-0275). |

`styles/lucy.css` is not loaded by `main.tsx`: `views/Lucy.tsx` and `views/LucyCloudSettings.tsx` import it, so it only exists once Lucy is on screen. It owns the Lucy page and uses only meanings from `tokens.css`.

## Feature sheets under the tokens

These sheets load with their own components rather than from `main.tsx`, so they are outside the load order above, but every colour and role in them comes from `tokens.css`. `uf-cascade.test.ts` checks them for raw colours, role definitions and `!important`; `spacing-tokens.test.ts` and `motion-tokens.test.ts` check their spacing and durations (ADR-0462, BF-0462-07).

| Sheet | Loaded by | Owns |
| --- | --- | --- |
| `cloud/cloud.css` | `cloud/CloudApp.tsx` | The legacy Cloud rail (`.cloud-shell`, kept for `cloud.hosted_shell` off), the words and actions every Cloud page shares (in either shell), the home hero and cards, account, billing, plan cards and meters, uploads, the hosted library, the local-first onboarding spine, the cutover notice and the reconciliation report. Re-expanded onto meaning, type and radius roles in `99d7acc8`. |
| `cloud/libraryWorkspace.css` | `cloud/CloudLibrary.tsx`, `cloud/ConnectMusic.tsx`, `cloud/ImportChip.tsx`, `cloud/CloudWorkspace.tsx`, `cloud/StorageCard.tsx` | Browser-first Cloud's Library (toolbar, rows, selection bar, the banner for a browser without the music, the import card) and Workspace (tiles, attention list, sources, storage, grouped diagnostics). |
| `rooms/rooms.css` | `rooms/RoomPanel.tsx` | Rooms hosting: the room panel, its share code and QR, settings, guests and presence (radius, surface and type roles since `0f8c0ba7`). |
| `devices/devices.css` | `devices/DevicesPanel.tsx`, `devices/PlayingBar.tsx`, `devices/RemoteListen.tsx` | The devices list, the "playing on" bar (radius, surface and line roles since `cdefdf1d`) and the remote on Listen (`.remote-*`, its own block at the end of the sheet). |

The QR code's white quiet zone is the one colour these sheets needed that had no meaning yet; it is `--surface-scan` (palette `--scan-white`), white in both themes on purpose.

The type, radius, surface and icon guards (`typography.test.ts`, `surface-depth.test.ts`, `optical-alignment.test.ts`, `icon-geometry.test.ts`) still scan only `style.css` and `styles/*.css`; widening them to these sheets is ADR-0468 BF-0468-08.

## Other sheets

Every remaining sheet loads with its own component or entry. All of them take their values from `tokens.css` except the two bundle-budget pages, which keep a copied token block. Raw colours in all of them are checked by `web/src/styles/s4-colour-consumers.test.ts`; none of them is yet in the `uf-cascade`, `spacing-tokens` or `motion-tokens` scopes (ADR-0468 BF-0468-08).

| Sheet | Loaded by | Owns |
| --- | --- | --- |
| `cloud/makeCloudMix.css` | `cloud/MakeCloudMix.tsx` | Make a Mix in the hosted Cloud (type steps and edge roles since `58eb3de6`). |
| `cloud/hosted/hostedMix.css` | `cloud/hosted/HostedMix.tsx` | The server-rendered hosted mix card on Make a Mix (cloud.hosted_render). |
| `views/mixIntent.css` | `views/MixIntent.tsx` | The two mix intents, setting scopes and what plays next on Make a Mix (surface, edge and type roles since `33e85a48`). |
| `admin/admin.css` | `admin/AdminArea.tsx` | The staff console's layout and tables, on token meanings only (`3c9cfa00`). One `!important`: `.admin-check` keeps its flex row against the generic label rule. |
| `business/business.css` | `business/BusinessApp.tsx`, `cloud/CloudApp.tsx`, the business harness | SelectaDJ for Business shared pieces; its reduced-motion and Still resets use `!important` (meaning roles since `9872fbb7`). |
| `business/console/console.css` | `business/console/HqConsole.tsx` and the venue cards | The HQ console and venue health. |
| `business/forms/forms.css` | the business form components | Venue, opening hours, dayparts, zones and pairing forms. |
| `business/shell/shell.css` | `business/shell/BusinessShell.tsx` | The business shell. |
| `business/staff/staff.css` | the staff components | The staff control deck, PIN keypad and approvals; reduced-motion and Still resets use `!important`. |
| `business/switcher/switcher.css` | `business/switcher/WorkspaceSwitcher.tsx`, `WorkspaceBand.tsx` | The workspace switcher and band. |
| `venueops/staffDashboard.css` | `venueops/StaffDashboard.tsx` | The ADR-0430 staff dashboard. |
| `autopilot/autopilot.css` | `autopilot/VenueSetup.tsx` | Venue setup. |
| `guest/guest.css` | `guest/main.ts` (its own entry) | The Rooms guest page. Loads without `tokens.css` for its bundle budget, so it keeps a token block whose every value is copied from the `tokens.css` token of the same name (`22f6881a`); its reduced-motion reset uses `!important`. |
| `display/display.css` | `display/main.ts` (its own entry) | The big-screen Room display, with the same copied token block; sizes are em of a body size fitted to the screen, as the Stage's are; its reduced-motion reset uses `!important`. |
| `kiosk/kiosk.css` | Dedicated kiosk screens and staff panel, shared tokens, fitted room-scale type | `kiosk/main.ts` |

A drift guard that compares the guest and display blocks with `tokens.css` is ADR-0468 BF-0468-02.

## Rules for a new rule

- **Values come from tokens.** A colour, space, radius, shadow, duration or font size is a `var(--...)` from `tokens.css`. A new meaning gets a new token there first (spacing roles: `spacing-token-map.md`).
- **Shared selectors live in the sheet that owns the part.** A rule for a part every page uses goes in `shell.css` or `foundation.css`; a page-local rule goes in that page's sheet above and is scoped by the page class (`.page.library`, `.now`, `.page.mix`).
- **No new specificity fights.** Win by order or by a scoped class, not by `#id` or `!important`.
- **Exceptions are listed.** A `!important` is allowed only where the cascade cannot express the intent (a user or OS preference that must beat every component, or the HTML `hidden` attribute). Each one is in the table below with its reason; the test fails on any that is not.

## `!important` exceptions

| Sheet | Count | Why |
| --- | --- | --- |
| `styles/tokens.css` | 6 | Still motion and OS reduced motion stop every animation, transition and smooth scroll, whatever a component asked for. |
| `styles/polish.css` | 5 | Reduced motion: smooth scrolling and any remaining animation or transition are cut to nothing, except leaving, which is swapped for a short fade that must outrank those resets. |
| `styles/creation.css` | 2 | Inspector scope and state lines keep their 4px top margin against the generic heading-to-content rhythm. |
| `styles/shell.css` | 1 | The desktop More menu is removed on phones, where the tab bar has its own. |
| `styles/music-objects.css` | 1 | Forced colours: motifs use the system text colour so they stay visible. |
| `styles/lucy.css` | 1 | The `hidden` attribute always hides, even on a Lucy element that sets its own `display`. |

## Scope collisions

Audit for Selecta 2.0 T0023 and T0026, re-run 2026-11-11. `web/src/styles/scope-collisions.test.ts` keeps it true:

- **`.handoff`.** The Listen hand-off card (`.handoff`, `.handoff-next`, `.handoff-progress`, `.handoff-pair`, `.handoff-phrase` and friends) is rendered only by `views/Now.tsx`. Its rules live in `style.css` (base card), `styles/listening.css` (Listen and stage placement, all scoped by `.now` or `.stage`) and `styles/music-objects.css` (the shared pair and phrase text). Discovery's `.link-handoff` is a different class, and Export's "handoff" is only words in a sentence.
- **Page sheets.** No bare class is styled by two of `listening.css`, `creation.css`, `operations.css` and `lucy.css`, apart from two shared on purpose: `.page`, always compounded with the page's own class (`.page.mix`, `.page.lucy`), and `.draft-list`, My Mixes' list, where `creation.css` adds only the `.long` modifier for long lists.
- **Elements.** No page sheet restyles a bare element (`button`, `input`, `p`, `section` and so on) for the whole app; element defaults belong to `style.css`.
- **What remains global on purpose.** `style.css` still holds element defaults and legacy layouts, and the shared parts in `shell.css` and `foundation.css` are global by design. The app keeps plain stylesheets scoped by page class rather than CSS modules.

## Consolidation plan (SF-0236-04)

Measured 2026-11-11 on `feat/finish-checklists`. A selector written the same way in more than one sheet
is a place where one sheet overrides another by load order. Some are layers by design (`depth.css` and
`typography.css` own their role across every page, and `tokens.css` owns motion). The rest are the
brittle part: a later sheet patching an earlier rule instead of the rule being right where it lives.
`web/src/styles/sfCascadeRatchet.test.ts` recounts them from the real sheets and fails if the total
rises above the ceiling below, so consolidation can only move one way. Lower the ceiling when a step lands.

| Measure | Baseline 2026-11-11 | Ceiling |
| --- | --- | --- |
| Selectors styled in more than one sheet | 170 | 180 |
| `!important` declarations outside motion, `hidden` and forced colours | 3 | 3 |

Sheets taking part in those overlaps at the baseline: `style.css` 95, `polish.css` 85, `shell.css` 68,
`listening.css` 30, `creation.css` 23, `typography.css` 14, `depth.css` 12, `operations.css` 11, the rest under 7.

Steps, each small enough to land on its own with the visual and cascade tests green:

1. **`polish.css` over `style.css`.** Where `polish.css` restates an element default or a legacy layout
   rule (`button`, `input`, `.hint`, `.panel`, `.card`, `.studio-cell` and the rest), fold the finished value
   into the owning rule and delete the patch. Biggest single source of overlap.
2. **Legacy page layouts out of `style.css`.** When a page is next touched, move its rules (`.timeline`,
   `.song`, `.seam`, `.studio`, `.lyrics`, `.request-*`, `.discovery`) into that page's sheet, scoped by the
   page class, and delete the `style.css` copy, so the page sheet stops overriding it.
3. **Shell parts in one place.** `.overlay-*`, `.toast*`, `.tabs`, `.mini-song` and `.nav a` are restated
   in `polish.css`; their final values move into `shell.css`.
4. **Brittle `!important`.** The two inspector margins in `creation.css` go once the heading rhythm rule
   they beat is scoped away from the inspector; `.nav-more-desktop` goes once the phone tab bar owns the
   More entry through its own selector. Motion, `hidden` and forced-colour exceptions stay (listed above).
5. **Values through tokens.** Any value a step moves keeps using `tokens.css` (`spacing-token-map.md`),
   and no step changes how a page looks: `web/e2e/paired-theme.e2e.ts` and `web/e2e/visual.e2e.ts`
   candidates are compared before and after.
