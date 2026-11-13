# CSS ownership, collisions and breakpoints

Guarded by `web/src/styles/mp-css-register.test.ts` (ADR-278): every stylesheet, every repeated
selector and every width or height breakpoint below must match the source, so a new file, a new
overlap or a new breakpoint fails the test until it is given an owner here.

## Files and owners

| File | Owns | Loaded by |
|---|---|---|
| `styles/tokens.css` | palette, meanings, type, space, motion, layers, shell geometry, density, theme switching | `main.tsx` |
| `style.css` | legacy global sheet: base controls, Listen strip/lyrics/handoff, timeline rows, Library rows, Links cards, Workspace metrics | `main.tsx` |
| `styles/shell.css` | rail/bottom bar, context bar, mini-player, toasts, overlays, menus, tooltips, skeletons, inspector resize | `main.tsx` |
| `styles/polish.css` | interaction feedback, card disclosure, skeleton reveal, reduced-motion overrides | `main.tsx` |
| `styles/foundation.css` | base element meanings: primary fill, popovers, word highlight | `main.tsx` |
| `styles/listening.css` | Listen layout, Stage, seek ghost, energy arc inputs, forced-colour fallbacks for music graphics | `main.tsx` |
| `styles/creation.css` | editor scope bar, inspector, Studio, Story view, energy overview and thumb | `main.tsx` |
| `styles/operations.css` | Library columns, Workspace panels, export jobs | `main.tsx` |
| `styles/music-objects.css` | motifs, seam/route diagrams, energy horizon, Library selection and cards | `main.tsx` |
| `styles/glossary.css` | glossary dialog and term hints | `main.tsx` |
| `styles/palette.css` | command palette song results | `main.tsx` |
| `styles/icons.css` | icon size slots, icon-to-label gaps, badge baselines (ADR-277) | `main.tsx` |
| `styles/depth.css` | surface depth, separators and forced-colour state edges (ADR-276) | `main.tsx` |
| `styles/typography.css` | type roles applied where an earlier rule left a gap, wrapping, tabular numbers (ADR-275) | `main.tsx`, last |
| `styles/lucy.css` | Lucy conversation, proposals, approval and history | `views/Lucy.tsx` (loaded with the Lucy page) |

Feature-local sheets live beside the one component that imports them and style nothing else:

| File | Owns | Loaded by |
|---|---|---|
| `admin/admin.css` | the admin area | `admin/AdminArea.tsx` |
| `cloud/cloud.css` | the cloud app | `cloud/CloudApp.tsx` |
| `business/business.css` | business console shared surfaces, notices, statuses and controls | `cloud/CloudApp.tsx` |
| `devices/devices.css` | device list and playing bar | `devices/DevicesPanel.tsx`, `devices/PlayingBar.tsx` |
| `display/display.css` | the display page | `display/main.ts` |
| `guest/guest.css` | the guest request page | `guest/main.ts` |
| `rooms/rooms.css` | the rooms panel | `rooms/RoomPanel.tsx` |
| `autopilot/autopilot.css` | venue setup instructions and autopilot guide controls | `autopilot/VenueSetup.tsx` |
| `business/console/console.css` | headquarters venue management, status grids and dashboards | `business/console/HqConsole.tsx` |
| `business/forms/forms.css` | labelled business onboarding and management form controls | `business/forms/LicenceAttestationForm.tsx` |
| `business/shell/shell.css` | business shell navigation, page layouts and headers | `business/shell/BusinessShell.tsx` |
| `business/staff/staff.css` | venue staff playback controls and zone selection | `business/staff/StaffControlDeck.tsx` |
| `business/switcher/switcher.css` | workspace switcher menu and context display band | `business/switcher/WorkspaceSwitcher.tsx` |
| `cloud/makeCloudMix.css` | Cloud mix creation interface layout and controls | `cloud/MakeCloudMix.tsx` |
| `venueops/staffDashboard.css` | unattended playback dashboard and staff controls | `venueops/StaffDashboard.tsx` |
| `views/mixIntent.css` | mix intent and setting-scope explanatory surfaces | `views/MixIntent.tsx` |

Load order (`web/src/main.tsx`): tokens, style.css, shell, polish, foundation, listening, creation,
operations, music-objects, glossary, palette, icons, depth, typography. Later files refine earlier
ones; feature files come after the legacy sheet so they win at equal specificity. New work goes into
the file that owns the feature; `style.css` only shrinks.

## Repeated selectors (MP-0278-01)

The seven class names that more than one sheet styles. "Base rule" is the sheet with the bare rule;
the others refine it for one feature or one state. Counted from the selectors themselves (comments
and `@media` preludes ignored).

| Token | Base rule | Also refined in | Verdict |
|---|---|---|---|
| `.card` | `style.css` | `styles/depth.css`, `styles/polish.css` | intentional: `style.css` owns the card; polish adds name wrapping and the phone padding; depth drops the seam diagram's own fill inside a card |
| `.panel` | `style.css` | `styles/depth.css`, `styles/polish.css` | intentional: polish owns only the phone padding (24 to 16 px at 760 px), shared with `.card`; depth drops the seam diagram's own fill inside a panel |
| `.row` | `style.css` | `styles/listening.css`, `styles/lucy.css`, `styles/operations.css`, `styles/polish.css` | intentional: `.row` is the layout helper; every refinement is scoped under its feature's container (`.hero .row`, `.lucy-approve .row`, `.link-card > .row`, `.start .row`) |
| `.display` | `style.css` | `styles/listening.css`, `styles/lucy.css`, `styles/music-objects.css`, `styles/operations.css`, `styles/polish.css`, `styles/shell.css` | intentional: `style.css` owns the metrics (MP-0275-02); the others place it within a feature, and shell sets its text direction |
| `.count` | `style.css` (`.song .count`) | `styles/icons.css`, `styles/polish.css`, `styles/shell.css` | was accidental (the badge inherited `grid-area: count`); now the grid rule is `.song .count`, badges are `.nav .count`, `.mini .count`, `.context-bar .count`, and polish only makes every count tabular |
| `.song` | `style.css` | `styles/creation.css`, `styles/depth.css`, `styles/polish.css`, `styles/shell.css` | intentional: timeline rows (creation scopes to `.timeline .song`); depth adds forced-colour state edges; Requests draws ghost rows that look like timeline rows on purpose |
| `.seam` | `style.css` | `styles/creation.css`, `styles/shell.css` | intentional: the seam between two timeline rows, its timeline refinements (creation) and its phone indent (shell) |

Other tokens used by more than one feature (`className` strings parsed across `web/src`):

| Token | Users | Verdict |
|---|---|---|
| `.facts` in Library | Library rows define a `facts` grid area | intentional |
| `.pair` | Good/Bad pairs in Edit and the rating group in Discovery | intentional, same meaning |
| `.thumbs`, `.next-up` | Listen and inspector/Discovery | intentional, same meaning |
| `.handoff` | Listen countdown only (Links uses `link-handoff`) | no collision |
| `var(--bg, #111)` literal | `.chord-strip span.now` | removed |

Library and Requests classes that appear in no other view are proved not to match anything on other
pages by `web/e2e/mp-0278-css-ownership.e2e.ts` (MP-0278-05).

## Breakpoints (MP-0278-06)

One shell breakpoint (760 px, with 761 px for the rail above it) owned by `tokens.css` and
`shell.css`. Page-local breakpoints belong to the sheet of the feature that changes shape. A sheet
uses only the widths in this table; a new width needs a row and a reason. When two sheets answer the
same width for the same element, the later sheet (load order above) or the more specific selector
wins, and the row says which.

| Query | File | Owns |
|---|---|---|
| `max-width: 1040px` | `styles/listening.css` | vibe cards go to two columns; Listen side column stops sticking |
| `max-width: 1040px` | `styles/polish.css` | vibe skeleton follows the two-column vibe cards |
| `max-width: 1024px` | `styles/operations.css` | Library columns fold into name/facts/readiness with actions beside; column head hidden (wins over `style.css` `.song-row` by specificity) |
| `max-width: 1024px` | `styles/polish.css` | Library row skeleton folds with the loaded rows (P0033): facts drop under the name, actions stay beside; must stay the same number as `styles/operations.css` |
| `max-width: 1024px` | `style.css` | timeline rows put their actions on a line under the song, so the title keeps its width beside the rail (2026-11-12 tablet review) |
| `max-width: 1024px` | `styles/creation.css` | timeline grip column follows the stacked timeline row in `style.css` |
| `max-width: 850px` | `styles/polish.css` | Make a Mix paths stack |
| `min-width: 768px` | `styles/listening.css` | render queue names and move buttons use consistent columns once the list has room |
| `min-width: 761px` | `styles/listening.css` | Stage visualizer and lyrics fit shorter desktop windows without hiding controls |
| `min-width: 761px` | `styles/shell.css` | the side rail |
| `max-width: 760px` | `styles/tokens.css` | shell geometry: no rail offset, bottom bar and smaller header |
| `max-width: 760px` | `styles/shell.css` | bottom bar, More drawer, context actions, overlays become sheets, keyboard yield |
| `max-width: 760px` | `styles/creation.css` | editor actions grid, scope status |
| `max-width: 760px` | `styles/listening.css` | Listen stacks transport before display options |
| `max-width: 760px` | `styles/lucy.css` | Lucy messages full width |
| `max-width: 760px` | `styles/polish.css` | page top, card and panel padding on phones |
| `max-width: 620px` | `style.css` | timeline rows and the legacy `.song-row` stack (Library's own rule in operations.css wins) |
| `max-width: 620px` | `styles/creation.css` | timeline grip column, Story rows |
| `max-width: 620px` | `styles/listening.css` | vibe cards one column |
| `max-width: 620px` | `styles/operations.css` | Library rows stack actions under readiness |
| `max-width: 620px` | `styles/polish.css` | vibe skeleton one column |
| `min-width: 621px` | `styles/polish.css` | vibe skeleton in the two-column band (621 to 1040px) stands as tall as the real cards, whose words wrap more there (P0032); pairs with the 620px rule above |
| `max-width: 560px` | `style.css` | Listen handoff countdown stacks |
| `max-width: 560px` | `styles/polish.css` | skeleton rows stack their name and details at phone widths |
| `max-width: 560px` | `styles/shell.css` | job list one column, phone seam indent |
| `max-width: 520px` | `style.css` | steering, destination and energy-arc stops one column; request rows |
| `max-width: 520px` | `styles/foundation.css` | setup steps: a finished step shows only its tick, so the steps take one line (MP-0282-07) |
| `max-width: 520px` | `styles/listening.css` | energy-arc stop labels |
| `max-width: 420px` | `styles/listening.css` | Listen view inner padding |
| `max-width: 420px` | `styles/lucy.css` | Lucy song actions wrap |
| `max-width: 420px` | `styles/polish.css` | Make a Mix path padding |
| `max-width: 420px` | `styles/shell.css` | mini-player Request button tightens |
| `max-width: 360px` | `styles/shell.css` | context-bar breadcrumb text shrinks at 320px so single-word page names remain intact (SF-0207-05) |
| `max-height: 760px` | `styles/listening.css` | short Stage windows: visualiser and countdown give up height so the current lyric stays above the fold (MP-0285-01) |
| `max-height: 450px` | `styles/shell.css` | very short windows: context bar enters normal flow and phone navigation stops covering content |
| `max-height: 520px` | `styles/shell.css` | short landscape: dialogs scroll inside, title and actions stay |
| `max-height: 420px` | `styles/typography.css` | 400% zoom: the editor scope bar stops sticking |

The Studio never changes structure by width; it scrolls with sticky lane labels, so Library rules
cannot affect it. `views/Mix.tsx` switches the inspector to a sheet with `matchMedia`. See
[route-state-register.md](route-state-register.md#breakpoints).

## Spacing exceptions

Values outside the `--space-*` scale that remain on purpose: 1-3 px hairline gaps in bar charts
(energy overview, seam bars), 6 px pills, and the 24 px add-gap targets in the timeline (WCAG 2.5.8
minimum, with spacing). Everything else uses tokens, enforced by `web/src/styles/spacing-tokens.test.ts`.

## Review rules for CSS changes (MP-0278-08)

Every pull request that changes a stylesheet fills in the "CSS changes" section of
`.github/pull_request_template.md`:

1. **Owning selector:** the file and selector that owns the rule, from the tables above. A rule that
   belongs to no listed owner adds a row here first.
2. **Numeric delta:** the measured before and after values (px, ratio or count), at the widths and
   themes that change.
3. **Visual evidence:** the geometry test, screenshot or measurement file that shows it, named by path.

A new breakpoint, a new stylesheet or a new overlap on one of the seven tokens above also updates this
file, which `mp-css-register.test.ts` enforces.
