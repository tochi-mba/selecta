# CSS ownership and cascade order

Who owns which rules in the app's own stylesheets, the order they load in, and the few places where a rule wins by force. Owner: ADR-0368 (UF-0368-01, -02, -07). The selector-level register (repeated shared class names, breakpoints and the PR review rules) is ADR-0278's `docs/adr/completion/css-ownership.md`, checked by `web/src/styles/css-ownership.test.ts`; this page adds the load-order owners, token ownership and the `!important` exceptions. `web/src/styles/uf-cascade.test.ts` fails when `web/src/main.tsx` loads a sheet in a different order from the table below, when a stylesheet exists that this page does not list, when a `!important` appears that is not in the exceptions table (or one listed here has gone), when a raw colour appears outside `tokens.css`, or when a sheet other than `tokens.css` defines a semantic token. The separate surfaces (`web/src/cloud`, `guest`, `rooms`, `display`, `devices`, `admin`) keep their own stylesheets and are outside this page.

## Load order

Later sheets win ties of equal specificity. A sheet only refines what an earlier sheet set; it never redefines a token.

| Order | Sheet | Owns |
| --- | --- | --- |
| 1 | `styles/tokens.css` | Every value: palette, semantic roles (text, surface, focus, selection, status, border, edge), spacing, type, motion, density and theme overrides. The only place a raw colour may appear. |
| 2 | `style.css` | Element defaults and the legacy page layouts that came before the split sheets. |
| 3 | `styles/shell.css` | The frame around every page: rail, phone tab bar, context bar, mini-player, overlays, notifications, skeletons. |
| 4 | `styles/polish.css` | Shared finish over legacy layouts: hit targets, focus that never moves, reveal motion, reduced-motion overrides. |
| 5 | `styles/foundation.css` | Small building blocks every page uses: primary action, Activity, command palette parts. |
| 6 | `styles/listening.css` | Onboarding, Explore (Make a Mix), Listen, My Mixes and Requests. |
| 7 | `styles/creation.css` | The editor, the transition inspector and the Studio. |
| 8 | `styles/operations.css` | Discovery, Library, Workspace, export and listening studies. |
| 9 | `styles/music-objects.css` | Cross-scene musical objects: motifs, verified transition, energy and request path. |
| 10 | `styles/glossary.css` | The glossary dialog and inline term hints. |
| 11 | `styles/palette.css` | Search and command palette result groups. |
| 12 | `styles/icons.css` | Icon slots, badge baselines and icon-only control geometry (ADR-0277). |
| 13 | `styles/depth.css` | Surface depth, borders, shadows and accent hierarchy beyond a token (ADR-0276). |
| 14 | `styles/typography.css` | Type roles applied where an earlier rule left a gap; loaded last so it owns type (ADR-0275). |

`styles/lucy.css` is not loaded by `main.tsx`: `views/Lucy.tsx` and `views/LucyCloudSettings.tsx` import it, so it only exists once Lucy is on screen. It owns the Lucy page and uses only meanings from `tokens.css`.

## Rules for a new rule

- **Values come from tokens.** A colour, space, radius, shadow, duration or font size is a `var(--...)` from `tokens.css`. A new meaning gets a new token there first (spacing roles: `spacing-token-map.md`).
- **Shared selectors live in the sheet that owns the part.** A rule for a part every page uses goes in `shell.css` or `foundation.css`; a page-local rule goes in that page's sheet above and is scoped by the page class (`.page.library`, `.now`, `.page.mix`).
- **No new specificity fights.** Win by order or by a scoped class, not by `#id` or `!important`.
- **Exceptions are listed.** A `!important` is allowed only where the cascade cannot express the intent (a user or OS preference that must beat every component, or the HTML `hidden` attribute). Each one is in the table below with its reason; the test fails on any that is not.

## `!important` exceptions

| Sheet | Count | Why |
| --- | --- | --- |
| `styles/tokens.css` | 6 | Still motion and OS reduced motion stop every animation, transition and smooth scroll, whatever a component asked for. |
| `styles/polish.css` | 4 | Reduced motion: smooth scrolling and any remaining animation or transition are cut to nothing. |
| `styles/creation.css` | 2 | Inspector scope and state lines keep their 4px top margin against the generic heading-to-content rhythm. |
| `styles/shell.css` | 1 | The desktop More menu is removed on phones, where the tab bar has its own. |
| `styles/music-objects.css` | 1 | Forced colours: motifs use the system text colour so they stay visible. |
| `styles/lucy.css` | 1 | The `hidden` attribute always hides, even on a Lucy element that sets its own `display`. |
