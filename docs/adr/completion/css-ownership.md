# CSS ownership, collisions and breakpoints

Guarded by `web/src/styles/mp-css-register.test.ts` (ADR-278): every stylesheet, every repeated
selector and every width or height breakpoint below must match the source, so a new file, a new
overlap or a new breakpoint fails the test until it is given an owner here.

## Files and owners

| File | Owns | Loaded by |
|---|---|---|
| `styles/tokens.css` | palette, meanings, type, space, motion, layers, shell geometry, density, theme switching | `main.tsx` |
| `styles/boot.css` | runtime and sign-in messages before an app frame exists, the brand mark badge | `main.tsx` |
| `style.css` | legacy global sheet: base controls, Listen strip/lyrics/handoff, timeline rows, Library rows, Links cards, Workspace metrics | `main.tsx` |
| `styles/shell.css` | rail/bottom bar, context bar, mini-player, toasts, overlays, menus, tooltips, skeletons, inspector resize | `main.tsx` |
| `styles/polish.css` | interaction feedback, card disclosure, skeleton reveal, reduced-motion overrides | `main.tsx` |
| `styles/foundation.css` | base element meanings: primary fill, popovers, word highlight; the shared primitives Meter, ConfirmDialog, Truncate and DataTable (moved here from admin.css and business/console.css) | `main.tsx` |
| `styles/cloud-ui.css` | the Cloud look for shared primitives, scoped to `:root[data-cloud='on']`: buttons, fields, page headers, cards, card grids, empty states and the page arriving | `main.tsx` |
| `styles/cloud-shell.css` | the Cloud shell, scoped to `.shell[data-mode='cloud']`: the rail and its account foot, the top bar and its room pill, the phone tab bar and mini player | `main.tsx` |
| `styles/listening.css` | Listen layout, Stage, seek ghost, energy arc inputs, forced-colour fallbacks for music graphics | `main.tsx` |
| `styles/creation.css` | editor scope bar, inspector, Studio, Story view, energy overview and thumb | `main.tsx` |
| `styles/operations.css` | Library columns, Workspace panels, export jobs | `main.tsx` |
| `styles/music-objects.css` | motifs, seam/route diagrams, energy horizon, Library selection and cards | `main.tsx` |
| `styles/glossary.css` | glossary dialog and term hints | `main.tsx` |
| `styles/palette.css` | command palette song results | `main.tsx` |
| `styles/icons.css` | icon size slots, icon-to-label gaps, badge baselines (ADR-277) | `main.tsx` |
| `styles/depth.css` | surface depth, separators and forced-colour state edges (ADR-276) | `main.tsx` |
| `styles/feel.css` | the feel system (ADR-0477), scoped to `<html data-feel>`: press and release, hover lift and light, moving skins for cards and rows, pointer light, sliding indicators, arrivals | `main.tsx` |
| `styles/feel-scene.css` | the feel system (ADR-0477): page and shared-element transitions, the frame that stays while a page moves | `main.tsx` |
| `styles/feel-music.css` | the feel system (ADR-0477): the beat ring, live bars, the playing row and the ambient layer the beat bus acts on | `main.tsx` |
| `styles/feel-parts.css` | the feel system (ADR-0477): the sliding indicator, number roll, the tick on a finished Action, the celebration and the first-paint splash | `main.tsx` |
| `styles/feel-components.css` | the feel system applied to the shared components: fields, checks, switches, menus, tooltips, tabs, dialogs, sheets, toasts, skeletons, meters, lists and empty states (ADR-0477) | `main.tsx` |
| `styles/feel-shell.css` | the feel system applied to the Shell: rail, phone tab bar, context bar, mini player, command palette, banners (ADR-0477) | `main.tsx` |
| `styles/feel-entry.css` | the feel system applied to boot, Welcome, the sign-in screens and onboarding (ADR-0477) | `main.tsx` |
| `styles/feel-listen.css` | the feel system applied to Make a Mix and Listen: build moment, hero, transport, strip, live blend, queue, Stage (ADR-0477) | `main.tsx` |
| `styles/feel-library.css` | the feel system applied to My Mixes, Library, import, song details, the editor and Studio (ADR-0477) | `main.tsx` |
| `styles/feel-rooms.css` | the feel system applied to hosting a room, requests, the devices list and the remote (ADR-0477) | `main.tsx` |
| `styles/feel-account.css` | the feel system applied to Workspace, Account, Plan and billing, Discover and the hosted pages (ADR-0477) | `main.tsx` |
| `styles/feel-local.css` | the feel system applied to the local app only: first scan, export, Workspace jobs, errors and the not-found page (ADR-0477) | `main.tsx` |
| `styles/typography.css` | type roles applied where an earlier rule left a gap, wrapping, tabular numbers (ADR-275) | `main.tsx`, last |
| `styles/lucy.css` | Lucy conversation, proposals, approval and history | `views/Lucy.tsx` (loaded with the Lucy page) |

Feature-local sheets live beside the one component that imports them and style nothing else:

| File | Owns | Loaded by |
|---|---|---|
| `admin/admin.css` | the admin area | `admin/AdminArea.tsx` |
| `cloud/cloud.css` | the cloud app | `cloud/CloudApp.tsx` |
| `business/business.css` | business console shared surfaces, notices, statuses and controls | `cloud/CloudApp.tsx` |
| `devices/devices.css` | device list, playing bar and the remote on Listen | `devices/DevicesPanel.tsx`, `devices/PlayingBar.tsx`, `devices/RemoteListen.tsx` |
| `display/display.css` | the display page | `display/main.ts` |
| `kiosk/kiosk.css` | Dedicated kiosk screens and staff panel, shared tokens, fitted room-scale type | `kiosk/main.ts` |
| `guest/guest.css` | the guest request page | `guest/main.ts` |
| `rooms/rooms.css` | the rooms panel | `rooms/RoomPanel.tsx` |
| `autopilot/autopilot.css` | venue setup instructions and autopilot guide controls | `autopilot/VenueSetup.tsx` |
| `business/console/console.css` | headquarters venue management, status grids and dashboards | `business/console/HqConsole.tsx` |
| `business/forms/forms.css` | labelled business onboarding and management form controls | `business/forms/LicenceAttestationForm.tsx` |
| `business/shell/shell.css` | business shell navigation, page layouts and headers | `business/shell/BusinessShell.tsx` |
| `business/staff/staff.css` | venue staff playback controls and zone selection | `business/staff/StaffControlDeck.tsx` |
| `business/switcher/switcher.css` | workspace switcher menu and context display band | `business/switcher/WorkspaceSwitcher.tsx` |
| `cloud/account.css` | the settings area: the section list, titled cards, plan and usage rows | `cloud/AccountLayout.tsx` |
| `cloud/cloudMusic.css` | the Cloud shell's music pages: Make a Mix, Listen, My Mixes and their guided empty pages | `cloud/LocalFirstEmpty.tsx`, `cloud/QuickMix.tsx`, `cloud/SavedBrowserMixes.tsx`, `cloud/SoundCheck.tsx` |
| `cloud/libraryWorkspace.css` | the Cloud Library and Workspace: connect music, import progress, the song list toolbar and the storage card | `cloud/CloudLibrary.tsx`, `cloud/CloudWorkspace.tsx`, `cloud/ConnectMusic.tsx`, `cloud/ImportChip.tsx`, `cloud/StorageCard.tsx` |
| `cloud/makeCloudMix.css` | Cloud mix creation interface layout and controls | `cloud/MakeCloudMix.tsx` |
| `cloud/hosted/hostedMix.css` | The server-rendered hosted mix card on Make a Mix (cloud.hosted_render) | `cloud/hosted/HostedMix.tsx` |
| `cloud/connection.css` | the connection banner and the buttons that wait for the server while offline | `cloud/ConnectionBanner.tsx`, `rooms/RoomPanel.tsx` |
| `venueops/staffDashboard.css` | unattended playback dashboard and staff controls | `venueops/StaffDashboard.tsx` |
| `views/mixIntent.css` | mix intent and setting-scope explanatory surfaces | `views/MixIntent.tsx` |
| `views/phoneEditor.css` | the editor for every screen: its header, the mix strip, the list of songs and transitions, the side pane and its sheets | `views/PhoneEditor.tsx` |

Load order (`web/src/main.tsx`): tokens, boot, style.css, shell, polish, foundation, cloud-ui, cloud-shell, listening, creation,
operations, music-objects, glossary, palette, icons, depth, feel, feel-scene, feel-music, feel-parts, feel-components, feel-shell, feel-entry, feel-listen, feel-library, feel-rooms, feel-account, feel-local, typography. Later files refine earlier
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
| `.row` | `style.css` | `styles/feel-local.css`, `styles/listening.css`, `styles/lucy.css`, `styles/operations.css`, `styles/polish.css` | intentional: `.row` is the layout helper; every refinement is scoped under its feature's container (`.hero .row`, `.lucy-approve .row`, `.link-card > .row`, `.start .row`); feel-local only positions a row that holds a local moment, behind `data-feel` |
| `.display` | `style.css` | `styles/cloud-ui.css`, `styles/listening.css`, `styles/lucy.css`, `styles/music-objects.css`, `styles/operations.css`, `styles/polish.css`, `styles/shell.css` | intentional: `style.css` owns the metrics (MP-0275-02); the others place it within a feature, shell sets its text direction, and cloud-ui only clears its margin inside a Cloud page header |
| `.count` | `style.css` (`.song .count`) | `styles/cloud-shell.css`, `styles/icons.css`, `styles/polish.css`, `styles/shell.css` | was accidental (the badge inherited `grid-area: count`); now the grid rule is `.song .count`, badges are `.nav .count`, `.mini .count`, `.context-bar .count`, polish only makes every count tabular, and cloud-shell restyles the same badges inside the Cloud shell only |
| `.song` | `style.css` | `styles/creation.css`, `styles/depth.css`, `styles/feel-library.css`, `styles/polish.css`, `styles/shell.css` | intentional: timeline rows (creation scopes to `.timeline .song`); depth adds forced-colour state edges; Requests draws ghost rows that look like timeline rows on purpose; feel-library lifts a timeline row being dragged, behind `data-feel` |
| `.seam` | `style.css` | `styles/creation.css`, `styles/feel-library.css`, `styles/shell.css` | intentional: the seam between two timeline rows, its timeline refinements (creation), its phone indent (shell) and the seam diagram growing in on hover or focus (feel-library, behind `data-feel`) |

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
| `min-width: 641px` | `styles/listening.css` | render queue names and move buttons use consistent columns once the list has room: above the canonical 640 phone width (moved from a stray 768 in the BF overhaul; the grid already fitted the narrower 768px-with-rail column, so the 641 to 767 band gains it rather than an upright tablet losing it) |
| `min-width: 761px` | `styles/listening.css` | Stage visualizer and lyrics fit shorter desktop windows without hiding controls |
| `min-width: 761px` | `styles/shell.css` | the side rail |
| `min-width: 761px` | `styles/cloud-shell.css` | the Cloud rail: its account foot, the collapse toggle and the collapsed rail (same number as `styles/shell.css`, scoped to `.shell[data-mode='cloud']`) |
| `min-width: 761px` | `styles/cloud-ui.css` | Cloud card grids go to two columns |
| `min-width: 761px` | `styles/feel-shell.css` | the feel system's rail: the sliding indicator carries the rail's marker, and the rail's width springs on collapse and expand (same number as `styles/shell.css`) |
| `min-width: 1101px` | `styles/cloud-ui.css` | Cloud card grids asked for three columns get them |
| `max-width: 1100px` | `styles/cloud-shell.css` | between the rail breakpoint and here the top bar's search button gives up its minimum width |
| `min-width: 769px` | `styles/boot.css` | the welcome page: benefits and steps sit three across |
| `min-width: 769px` | `styles/feel-entry.css` | the welcome steps' connecting line draws across instead of down once they sit three across (same number as `styles/boot.css`) |
| `max-width: 768px` | `styles/feel-entry.css` | the welcome page's docked Start bar appears on a phone or upright tablet once the hero's buttons scroll away |
| `max-width: 900px` | `styles/feel-entry.css` | the Cloud onboarding spine becomes short bars whose fill springs across as each step is reached |
| `max-width: 900px` | `styles/feel-account.css` | the account section list becomes a row of pills, which keeps its own pill for the current section instead of the sliding block |
| `min-width: 901px` | `styles/boot.css` | the welcome page: the words and the blend drawing sit side by side |
| `max-width: 760px` | `styles/tokens.css` | shell geometry: no rail offset, bottom bar and smaller header |
| `max-width: 760px` | `styles/cloud-shell.css` | the Cloud top bar, tab bar and mini player on a phone (same number as `styles/shell.css`; scoped to the Cloud shell, so it wins there by specificity) |
| `max-width: 760px` | `styles/cloud-ui.css` | Cloud page headers stack and their actions take the full width |
| `max-width: 760px` | `styles/shell.css` | bottom bar, More drawer, context actions, overlays become sheets, keyboard yield |
| `max-width: 760px` | `styles/creation.css` | editor actions grid, scope status |
| `max-width: 760px` | `styles/listening.css` | Listen stacks transport before display options |
| `max-width: 760px` | `styles/lucy.css` | Lucy messages full width |
| `max-width: 760px` | `styles/polish.css` | page top, card and panel padding on phones |
| `max-width: 760px` | `styles/feel-shell.css` | the phone's Cloud tab bar marks the current tab with a short line along its top (same number as `styles/shell.css`) |
| `max-width: 620px` | `style.css` | timeline rows and the legacy `.song-row` stack (Library's own rule in operations.css wins) |
| `max-width: 620px` | `styles/creation.css` | timeline grip column, Story rows |
| `max-width: 620px` | `styles/listening.css` | vibe cards one column |
| `max-width: 620px` | `styles/operations.css` | Library rows stack actions under readiness |
| `max-width: 620px` | `styles/polish.css` | vibe skeleton one column |
| `min-width: 621px` | `styles/polish.css` | vibe skeleton in the two-column band (621 to 1040px) stands as tall as the real cards, whose words wrap more there (P0032); pairs with the 620px rule above |
| `max-width: 560px` | `style.css` | Listen handoff countdown stacks |
| `max-width: 560px` | `styles/polish.css` | skeleton rows stack their name and details at phone widths |
| `max-width: 560px` | `styles/shell.css` | job list one column, phone seam indent |
| `max-width: 560px` | `styles/feel-local.css` | a Workspace job's meter moves under the job with the one-column job list (same number as `styles/shell.css`) |
| `max-width: 560px` | `styles/feel-listen.css` | Cloud Make a Mix quick steps: the connecting line follows the stacked step on a phone |
| `max-width: 480px` | `styles/boot.css` | runtime, welcome and onboarding actions stack full width on a phone |
| `max-width: 480px` | `styles/lucy.css` | a compact Lucy song list puts the actions under the title on a small phone |
| `max-width: 520px` | `style.css` | steering, destination and energy-arc stops one column; request rows |
| `max-width: 520px` | `styles/foundation.css` | setup steps: a finished step shows only its tick, so the steps take one line (MP-0282-07) |
| `max-width: 520px` | `styles/listening.css` | energy-arc stop labels |
| `max-width: 520px` | `styles/shell.css` | page tabs stay on one row that scrolls sideways on a phone |
| `max-width: 420px` | `styles/listening.css` | Listen view inner padding |
| `max-width: 420px` | `styles/lucy.css` | Lucy song actions wrap |
| `max-width: 420px` | `styles/polish.css` | Make a Mix path padding |
| `max-width: 420px` | `styles/shell.css` | mini-player Request button tightens |
| `max-width: 360px` | `styles/shell.css` | context-bar breadcrumb text shrinks at 320px so single-word page names remain intact (SF-0207-05) |
| `max-height: 760px` | `styles/listening.css` | short Stage windows: visualiser and countdown give up height so the current lyric stays above the fold (MP-0285-01) |
| `max-height: 450px` | `styles/cloud-shell.css` | very short windows: the Cloud rail's list fades above its account foot |
| `max-height: 450px` | `styles/shell.css` | very short windows: context bar enters normal flow and phone navigation stops covering content |
| `max-height: 520px` | `styles/shell.css` | short landscape: dialogs scroll inside, title and actions stay |
| `max-height: 500px` | `styles/lucy.css` | a phone on its side: Lucy's heading gives its room to the conversation |
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
