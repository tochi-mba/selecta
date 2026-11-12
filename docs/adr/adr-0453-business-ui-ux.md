# ADR-0453 - Business UI/UX: onboarding, HQ multi-venue console, venue manager and staff views

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/22 Not started.
- **Independent verification:** 0/22 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; branch `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P0 for pilots (staff view, kiosk screen, manager view, pilot states); P1 for sale (self-serve sign-up, full HQ console). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0416 (Rooms pages), ADR-0420 (Cloud route and account-state UX), ADR-0430 (one-glance staff dashboard), ADR-0439 (responsive inclusive UI), ADR-0442 to ADR-0449 (the business model, hours, kiosks, offline, billing, entitlements, licensing), ADR-0450 to ADR-0452; their statuses are unchanged.
- **Source touchpoints:** `web/src/styles/tokens.css`; `web/src/ui/` (`controls.tsx`, `primitives.tsx`, `formControls.tsx`, `DataTable.tsx`, `Skeleton.tsx`, `toasts.tsx`, `useReducedMotion.ts`, `useMediaQuery.ts`, `useVisiblePoll.ts`); `web/src/cloud/` (`CloudApp.tsx`, `Billing.tsx`, `Meters.tsx`, `OverQuota.tsx`, `events.ts`, `Uploads.tsx`); `web/src/rooms/` (`RoomPanel.tsx`, `qr.ts`); `web/src/devices/` (`PlayingBar.tsx`, `wakeLock.ts`, `deviceInfo.ts`); `web/src/guest/`, `web/src/display/`; new `web/src/business/`, new `web/kiosk.html` and `web/src/kiosk/`.
- **Proposal chapter:** [docs/saas/19b-business-experience.md](../saas/19b-business-experience.md#19b4-the-business-experience).

## Context and evidence boundary

SelectaDJ for Business adds people who have never used SelectaDJ before and who use it under pressure: an owner setting up on a Sunday night, a head office watching 40 venues, a manager fixing tomorrow's schedule, a bartender who needs the music calmer right now with wet hands, a kiosk nobody looks at, and customers scanning a table card. The existing app is music-first and built for one listener. Its tokens, primitives, honest status language (docs/saas/11-ui-ux.md section 11.4) and state matrix (section 11.5) carry over; the shapes of the screens do not.

Two rules from the owner shape everything:

1. **A silent venue is the worst failure**, so the business UI exists first to make silence impossible to miss for the people who can fix it.
2. **Never alarm customers.** Billing, licence, seat, pilot, device and error states are for managers. Screens customers can see (kiosk screen, guest page, zone display) show only calm, neutral music states.

The plan will be built fully but not sold yet: the owner scouts first with a few friendly pilot venues, created by REX Technologies staff (ADR-0452). Self-serve sign-up stays behind `business.signups`, off by default.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

### D1. Surfaces and who sees them

| Surface | Route | Audience | Customer can see it? |
|---|---|---|---|
| S1 Sign-up and onboarding | `/business/start`, then `/b/{org}/setup` | New owner | No |
| S2 HQ multi-venue console | `/b/{org}` | Owner, admin, viewer | No |
| S3 Venue manager view | `/b/{org}/v/{venue}` | Venue manager and above | No |
| S4 Staff quick-control view | `/b/{org}/v/{venue}/control` and shared tablets | Staff and above | Sometimes (a tablet on the bar) |
| S5 Kiosk player screen | `/kiosk` (own entry, `web/kiosk.html`) | Nobody manages it; customers may see it | Yes |
| S6 Customer Rooms page per zone, and zone display | `/r/{code}`, `/display` (existing entries) | Guests | Yes |
| S7 Workspace switcher | Account menu, every signed-in page | Anyone in an organisation | No |
| S8 Pilot administration | `/admin/business/pilots` (admin console) | REX Technologies staff | No |

S4 can sit on a bar where customers see it, so it is treated as **semi-public**: it shows music and request states, and only one quiet manager line (D4).

### D2. Information architecture of the business workspace

- The business workspace has its own navigation, using the existing shell (rail on desktop, tab bar on phones): **Overview** (HQ, S2), **Venues** (list, then S3), **Schedules**, **Library**, **Requests**, **People**, **Billing**, **Settings** (licences, content rules defaults, SSO, audit). Each item appears only when the person's role allows it (ADR-0452); a staff member's whole app is S4.
- A venue manager scoped to one venue lands directly on S3 for that venue; with several venues they land on Venues.
- Every page header carries the **WorkspaceBand** (D9), so nobody mistakes a business page for their personal library.

### D3. The state model (shared by every surface)

| State | Exact trigger | Source |
|---|---|---|
| Empty | The thing exists but has no content yet (no venues, no zones, no songs, no requests) | Data |
| Loading | First read not answered after 120 ms (`REVEAL_AFTER_MS`), with a skeleton shaped like the content | Client |
| Offline | This device has lost the network (browser offline event, or 3 failed reads in 30 s) | Client |
| Degraded | SelectaDJ is up but part of it is not: live updates paused (`events.ts` fallback), renders slower than target, a venue's health data older than 2 minutes, payments provider down | Server status and `/api/events` |
| Silent zone | A zone inside opening hours whose speaker has reported no audio for 60 s, or has no speaker online, and is not paused by staff | ADR-0445 health heartbeat |
| Over seats | More people hold seats than are included plus paid (after a venue is removed, for example) | ADR-0447, ADR-0452 |
| Licence expiring | A venue's attested music licence ends within 30 days | ADR-0449 |
| Licence expired | A venue's attested licence end date has passed | ADR-0449 |
| Payment grace | A payment failed; the 14-day grace is running; or it has ended and playback will stop at next close | ADR-0447, DESIGN section 6 |
| Plan locked | A feature the plan does not include (SSO below Enterprise, an extra zone not paid for, management after grace ends) | ADR-0448, existing teaser behaviour |
| Pilot | The organisation is a pilot: active, ending within 14 days, or ended | ADR-0452 |

Severity order for manager surfaces, highest first: silent zone, licence expired, payment grace in its last 72 hours, pilot ended, offline, licence expiring, payment grace, pilot ending, over seats, degraded, plan locked. Only the highest two show as banners; the rest collect in a **Needs attention** list on S2 and S3.

### D4. The customer-facing rule

- Customer-facing entries (S5 kiosk, S6 guest page and display) are separate bundles that **never import** manager components or read manager fields. Their server views (`/api/kiosk/view`, `/api/guest/...`, `/api/display/view`) are built from an allowlist of fields and never include billing, licence, seat, pilot, audit, staff names or error detail.
- Every manager-only notice uses one component, **ManagerNotice**. A build test fails if `ManagerNotice` or its copy keys appear in the kiosk, guest or display bundles; a payload test fails if a forbidden field appears in those views.
- On S4 (semi-public), manager states show only as one line at the foot of the screen in plain, unalarming words with no amounts ("Your manager has a note about this venue"), and only when the person signed in (or the PIN holder) is a manager. Shared tablets without a manager PIN never show it.

### D5. Layout sizes, themes and access (all surfaces)

- **Widths tested:** phone 320 and 375 px; tablet 768 portrait and 1024 landscape; desktop 1280 and 1440 px; big screen 1920 by 1080 viewed from 3 metres. Business pages use `--content-work` (1400 px) for S2 and `--content-browse` elsewhere.
- **Big screen** (S2 wall mode, S5, zone display): type steps up one token level (`--type-page` becomes the song title size), touch targets do not apply, contrast is checked at 7:1 for primary text, and nothing important sits within 5% of the edges (TV overscan).
- **Touch targets:** `--control-height` (44 px) everywhere; 64 px on S4 (new **BigAction**), with 12 px between neighbours so a wet thumb cannot hit two.
- **Themes:** both, through the existing tokens and `data-theme`. The kiosk screen and zone display default to dark (dim venues) and follow the venue's choice. Lime (`--accent`) is never text on cream, as `tokens.css` already rules. A venue accent colour (ADR-0451) is used only where it passes 4.5:1 in the theme in use.
- **Status is never colour alone:** every state uses `Status` (mark plus words). A silent zone uses the `blocked` mark and the words "Silent", never just a red dot.
- **Keyboard:** every action is reachable by keyboard in a logical order; grids use `moveInGrid` (arrow keys, Home, End); dialogs trap and return focus (`focusReturn.ts`); no keyboard traps on S5.
- **Screen readers:** one `h1` per page; landmarks (`banner`, `navigation`, `main`, `complementary` for Needs attention); now-playing changes are announced politely and at most once every 30 seconds per zone through `announce()`; a new silent-zone alert is the only assertive announcement, and only on S2 and S3; the health grid is a real grid with row and column headers; status words are in the accessible name.
- **Reduced motion and Still:** `prefers-reduced-motion` and `data-motion='still'` stop every pulse, slide and visualizer; alerts never flash or pulse in any mode (a static mark and words); S5's visualizer becomes a still motif.
- **400% zoom and reflow:** at 1280 px and 400% (320 CSS px) everything reflows to one column without horizontal scrolling except the schedule board, which scrolls in its own region with sticky venue names. `DataTable` gains a stacked mode (each row becomes a card with labelled values) used below 600 px.
- **Forced colours** (Windows high contrast): marks, borders and focus rings stay visible (ADR-0439).
- **Long names:** venue, zone, song and artist names wrap to two lines and then truncate with the full text in the accessible name and a tooltip; tested with `SELECTA_E2E_STRESS=1` names.

### D6. S1 - Sign-up and onboarding

**Entry.** With `business.signups` on: the marketing site's "Start a 14-day trial" goes to `/business/start`, then AuthKit sign-up (or sign-in for an existing SelectaDJ user), then business details. With it off (the default): `/business/start` shows "SelectaDJ for Business is in private pilot. Tell us about your venue" with a contact form for REX Technologies, and pilot owners arrive by invitation link straight at step 2.

**Steps** (a **SetupChecklist** on the left on desktop, a progress line "Step 3 of 8" on phones; every step saves as you go and can be left and resumed; skipped steps stay on the checklist):

| Step | Content | Gate |
|---|---|---|
| 1. Business details | Organisation name, country, billing email, VAT number (validated, optional), PO number (optional), card through Stripe Checkout for the trial | Skipped for pilots ("Pilot: free until 12 January") |
| 2. Add a venue | **VenueForm**: name, address with lookup, time zone filled from the address and editable, phone (optional) | Required |
| 3. Opening hours | **OpeningHoursEditor**: a week grid with copy-to-days, overnight hours ("Fri 18:00 to 02:00 next day"), holiday closures, a preview line in plain words ("Open 7 days, 66 hours a week") | Required before auto-start |
| 4. Zones | **ZoneListEditor**: name each zone (Bar, Terrace); first zone included, extra zones show their price (or pilot allowance) before adding | One zone required |
| 5. Music licence | **LicenceAttestationForm** (ADR-0449): licence type (TheMusicLicence or other), number, expiry, a tick box in plain words that the venue holds the rights to play its music in public | Required before any zone plays music in the venue |
| 6. Your music | Upload (existing `Uploads.tsx` tray, destination shown as the organisation) or **Copy from my personal library** (choose crates or songs; copies, never moves; a plain note that personal downloads are often licensed for personal use only) | At least the planner's minimum ready songs before the first service |
| 7. Pair a kiosk player | **PairingCodeEntry**: "On the player, open selecta.app/kiosk and type the code it shows", a picture of each device type, links to the kiosk setup guide (autoplay flags, wake lock, auto-start), live confirmation "Bar player paired and ready" | Required before auto-start |
| 8. First scheduled service | **DaypartBar** with three starter templates (Cafe day, Bar evening, Restaurant), then a summary: "Bar starts by itself on Saturday at 10:00 with Brunch calm" and a "Play a test now" button | Done |

After step 8 the owner lands on S3 for that venue with the checklist collapsed to a chip ("Setup done") and an optional short tour.

**S1 state matrix**

| State | What shows |
|---|---|
| Empty | Each step starts with one sentence on why it matters and one primary action; no empty tables |
| Loading | Step skeleton; the checklist stays usable |
| Offline | Inputs stay editable; "You're offline. We'll save this when you're back" under the step; Continue waits and then saves |
| Degraded | Payments provider down at step 1: "Card payments are unavailable right now. You can carry on and add the card later" (trial does not start playing in venue until added); address lookup down: manual address fields |
| Silent zone | Not shown during setup (no service yet); after "Play a test now" fails: "The Bar player isn't playing yet. Check it's switched on and the code was right" |
| Over seats | Not possible during setup |
| Licence expiring | Expiry within 30 days entered at step 5: "This licence ends on 3 December. We'll remind you 30, 14 and 3 days before" |
| Licence expired | Expiry in the past: the step refuses to save: "This date has passed. Enter your current licence" |
| Payment grace | Not possible during setup |
| Plan locked | Adding a second venue on the trial: "The trial covers one venue. Add more when you subscribe"; a zone past a pilot's allowance: "Your pilot covers 3 zones. Ask REX Technologies for more" |
| Pilot | Pilot badge in the checklist header with the end date; step 1 replaced as above |

### D7. S2 - HQ multi-venue console

**Layout.** Desktop: a **Needs attention** column (complementary landmark) beside the **VenueHealthGrid**. Tablet: Needs attention collapses to a chip with a count above the grid. Phone: a list of **VenueHealthCard**s sorted by severity. Big screen (**wall mode**, a toggle that hides navigation and enlarges type): the grid only, for an operations room.

**Venue health grid.** One row per venue, one cell per zone, each cell a **ZoneStatus**: `Playing` (song and artist, **NowPlayingTile**), `Paused by staff` (with minutes), `Closed` (next opening time in the venue's time zone), `Quiet hours`, `Playing from saved music` (offline but playing, ADR-0446), `Silent` (blocked mark), `Not paired`. Columns sort by severity, name and region; filters for region, status and venue tags; search by venue name. Times show in the venue's local time with the zone abbreviation when it differs from the viewer's.

**Silent-zone alerts.** A **SilentZoneAlert** at the top of S2 and S3 lists each silent zone with how long, the last thing the speaker reported, and two actions: "Open venue" and "Call venue" (tel link if a phone is set). The same alert goes by email and, if enabled, push notification to that venue's managers, then to admins after 5 minutes (ADR-0445 decides the delivery channels). Alerts clear themselves when audio returns and leave an entry in the venue's activity log.

**Schedules across venues.** A **ScheduleBoard**: venues as rows, the day (in each venue's own time) as columns, dayparts as blocks. Select many venues, apply a template or edit a block, see a **ScheduleDiffPreview** ("Changes 200 venues. 14 are open now; their change starts at the next block, not mid-song"), then apply. Conflicts with another editor show "Changed by Sam 2 minutes ago" with both versions (ADR-0444 version check).

**Play-log export.** **PlayLogExport**: choose venues (or all), date range in venue time, format (CSV with licensing-return columns from ADR-0449), then an export job with honest progress ("Preparing 3 of 12 venues") and a download link valid for 24 hours; recent exports listed.

**Billing.** Reuses `Billing.tsx` and `Meters.tsx` patterns: current plan, venues, zones and seats as line items with quantities and prices, storage meter (pooled), invoices with PO numbers, payment method, consolidated or per-venue invoicing. Pilots see "Pilot: free until 12 January" and "Talk to REX Technologies about subscribing".

**S2 state matrix**

| State | What shows |
|---|---|
| Empty | No venues: "Add your first venue" (or for pilots "Your pilot covers 1 venue. Add it"); viewer with no venues: "You don't have access to any venues yet. Ask your admin" |
| Loading | Grid skeleton with the right number of rows if known; Needs attention reads "Checking venues" |
| Offline | Grid frozen with "Last updated 14:32. You're offline" above it; every cell keeps its last state with an "as of" time; no alert is cleared while offline |
| Degraded | Live updates paused: "Live updates are paused on this network. Refreshing every 10 seconds" (existing copy); a venue whose health is older than 2 minutes shows `Not reporting` for its cells instead of a stale `Playing` |
| Silent zone | SilentZoneAlert at top; the cell shows `Silent` with minutes; the row moves to the top of a severity sort; an assertive announcement once per new silent zone |
| Over seats | Needs attention: "6 people hold seats but 3 are included. Remove someone or add seats" with both actions (owner and admin only) |
| Licence expiring | Needs attention, per venue: "Camden's music licence ends on 3 December" with "Update licence" |
| Licence expired | Banner on S2 for that venue: "Camden's music licence date has passed. Update it by 17 December or Camden's music won't start at its next opening after that". Expiry never stops music mid-service; after ADR-0449's 14-day licence grace the zones do not start at the next opening, and the banner then says "Camden's music is off until the licence is updated". The venue row gets a `Needs you` mark |
| Payment grace | Banner: "Your last payment didn't go through. Update your card by 26 November to keep everything running". Last 72 hours: "Music in all venues stops at closing time on 26 November unless payment is updated". After grace: management read-only with "Update payment to make changes" on every disabled control |
| Plan locked | Locked items appear as teasers naming the plan (existing behaviour), for example SSO under Settings: "Single sign-on is part of Enterprise" |
| Pilot | A **PilotBadge** beside the organisation name with the end date; 14 days before the end: Needs attention "Your pilot ends on 12 January. Talk to REX Technologies to keep going"; after the end: read-only with the same stop-at-close warnings as grace |

### D8. S3 - Venue manager view

**Layout.** Tabs (`Tabs`): **Now** (zones with now playing, next, volume and cap, requests waiting, stay-open-late), **Today** (a DaypartBar per zone with the current position marked), **Schedule**, **Music rules** (ADR-0450: **ContentRulesEditor**, **ExplicitBulkEditor**, **BlocklistEditor**), **Requests** (ADR-0451: modes, limits, **GuestBrandingEditor**, print sheet), **Devices** (kiosks and tablets: health, cache hours ahead, last seen, pair, unpair with the ask-first dialog), **People** (if allowed), **Licence** (**LicenceCard**), **Play log**. Phone: the tabs become a list of sections; Now is first.

**S3 state matrix**

| State | What shows |
|---|---|
| Empty | No zones: "Add a zone to start"; no songs in a zone's pool: "Nothing can play in Terrace with these rules. Change the rules or add songs" (ADR-0450 refusal); no requests: "No requests yet. Print table cards" |
| Loading | Per-tab skeletons; Now loads first |
| Offline | Controls that change things are disabled with "You're offline"; the last known state stays with its time |
| Degraded | As S2; plus "Changes may take longer to reach the players" when command delivery is slow |
| Silent zone | SilentZoneAlert at the top with steps: "1. Check the Bar player is on. 2. Check its internet. 3. Try Play here on this device" (Play here from ADR-0443 as an emergency speaker) |
| Over seats | People tab only; managers see "No free seats. Ask an owner or admin to add one" on the invite form |
| Licence expiring | LicenceCard shows the date with `warning` status and "Update licence" |
| Licence expired | Banner as S2, scoped to this venue |
| Payment grace | ManagerNotice with the same copy as S2; venue managers without billing rights see "There's a payment problem. Your owner has been told" |
| Plan locked | Extra zone beyond the paid count: "Terrace is paused because your plan covers 1 zone. Its music stops at closing time" (owner sees "Add a zone"); after grace, editing is read-only |
| Pilot | PilotBadge in the header; the same pilot messages as S2, scoped to this venue |

### D9. S7 - Switching between personal and business workspaces

- The account menu lists **Personal** and each organisation, with the role in that organisation ("The Crown Group, manager"). The **WorkspaceSwitcher** is also in the command palette ("Switch to The Crown Group").
- The **WorkspaceBand** is a thin header band with the workspace name and a building mark for business, using `--surface-control` and the existing type tokens. It is always visible; colour is never the only signal.
- Switching changes everything (library, Lucy, devices, player). If this device is playing personal music, switching asks "Your music is playing here. Keep it playing while you switch?" (keep or stop); a device that is a business speaker cannot switch to personal while it holds a zone lease (it says why).
- Uploads always name their destination ("Uploading 12 songs to The Crown Group"); a drag and drop onto the personal library while the band says business is impossible because each workspace has its own pages.
- Deep links include the workspace (`/b/{org}/...`); opening one from another workspace switches with a toast "Switched to The Crown Group".
- Each browser tab keeps its own workspace; two tabs may be in different workspaces, each with its own band.

**S7 state matrix**

| State | What shows |
|---|---|
| Empty | A person in no organisation sees no switcher |
| Loading | The menu lists workspaces from the account read; an organisation still loading shows a skeleton row |
| Offline | Switching waits: "You're offline. Switch when you're back" |
| Degraded | Switching works; live updates note as elsewhere |
| Silent zone | A count beside the organisation in the menu ("1 silent zone") for managers and above |
| Over seats, licence, payment grace | A `Needs you` mark beside the organisation for owners and admins; no detail in the menu |
| Plan locked | An organisation in read-only after grace says "Read only" beside its name |
| Pilot | "Pilot" beside the organisation name |

### D10. S4 - Staff quick-control view

**Content** (ADR-0430's one-glance view, sized for a bar): zone name with a **ZoneSwitcher** (segmented control when 2 to 4 zones, a menu above that), **Now** (song, artist, a progress line), **Next**, then a **StaffControlDeck** of BigActions: **Bigger**, **Calmer**, **Something else** (the existing steering words), **Skip**, **Pause** / **Resume**, a **VolumeLimitSlider** (the existing `Slider` with the cap drawn as a mark and the words "Up to 70 here"), **Requests** with a count, and **Stay open late** when the allowance is above zero ("Keep the music on until 01:00").

**Nothing destructive.** No delete, unpair, rule, schedule, people or billing controls exist on this view, and the API refuses them for staff anyway (ADR-0452). Skip and steering are undoable for 10 seconds by toast ("Skipped. Undo").

**Pause.** Pause is allowed (announcements, a fire alarm), shows "Paused by Bar tablet" everywhere managers look, and after 15 minutes asks the person to resume or keep paused. Managers are alerted after 30 minutes paused during opening hours.

**Request approval.** A **RequestApprovalQueue**: each request shows song, artist and how long it has waited, with Approve and Pass as BigActions; the guest's nickname is shown (never anything else). Votes show as a count.

**Layout.** Phone: one column, Now on top, deck below, requests as a sheet (`Sheet`). Tablet landscape (the expected shared device): Now and the deck on the left, requests on the right. Big screen is not a target for S4. Both themes; dark by default on shared tablets.

**Shared tablets and PINs.** With staff PINs on, the first action after 2 minutes idle asks for a PIN with a large keypad; with PINs off, actions go straight through and are attributed to the tablet.

**S4 state matrix**

| State | What shows |
|---|---|
| Empty | No zones assigned: "This tablet isn't set up for a zone yet. Ask your manager"; no requests: "No requests right now" |
| Loading | Now and the deck as skeletons; the deck never shows enabled buttons before the state is known |
| Offline | Buttons stay pressable; commands queue with "Will send when back online" and a count; the music itself keeps playing on the kiosk (ADR-0446); queued commands older than 2 minutes are dropped with "That skip was too late, so we didn't send it" |
| Degraded | "Changes may take a few seconds" when command round trips exceed 2 s |
| Silent zone | A plain card: "Terrace is silent. Check the player is on" with "Play here instead" if this tablet can be a speaker (ADR-0443) |
| Over seats | Not shown |
| Licence expiring or expired | Not shown, except the single ManagerNotice line for managers (D4) |
| Payment grace | Not shown, except the ManagerNotice line for managers; on the last day: managers only, "The music will stop at closing time tonight. Your owner knows why" |
| Plan locked | A paused extra zone shows "Terrace isn't playing today" for staff, with no plan words |
| Pilot | Not shown to staff |

### D11. S5 - Kiosk player screen

**Purpose.** The kiosk is a speaker, not a control. Its screen is calm: the venue and zone name small at the top, the current song and artist large, the next song small, and an optional slow motif (Still under reduced motion). No buttons in normal use, no menus, no management.

**States of the device itself** (the only states S5 has, plus D3 mapped below):

| Kiosk state | Screen |
|---|---|
| Unpaired | **KioskPairing**: a six-character code in very large type, "Pair this player at selecta.app/pair", the device name, and a QR for the manager's phone; the code renews every 10 minutes |
| Paired, needs a tap | **KioskTapToStart**: one full-screen button "Tap to start the music" (browsers block sound until a person taps once), with the kiosk-flags guide link for managers |
| Closed | "Closed. Music starts at 10:00" (venue time), dimmed, screen allowed to sleep if the venue chose that |
| Starting | "Starting the music" with a quiet progress line while the first songs download |
| Playing | The calm now-playing view |
| Playing from saved music | The same view; a tiny cloud-off mark in a corner, no words (staff know it from the guide; customers do not notice) |
| Paused by staff | "Music paused" |
| Problem | "The music will be back shortly" and a small diagnostic code (for example `K-204`) for staff calls; never an error dump |
| Updating | "Updating, back in a moment" for at most 60 seconds, only during closed hours unless urgent |
| Unpaired by a manager | Back to Unpaired |

**Hidden staff panel.** A three-second press on the top-left corner, then the venue's staff PIN (if PINs are on), opens a read-only panel: device name, zone, network, hours of music saved ahead, last sync, app version, "Reload player" and "Show pairing code". Nothing else.

**S5 state matrix**

| State | What shows |
|---|---|
| Empty | Paired zone with no playable songs: "Closed. Music starts soon" (neutral); the manager gets the real reason on S3 |
| Loading | Starting state |
| Offline | Playing from saved music (silent mark); when saved music runs out: "The music will be back shortly" |
| Degraded | No change |
| Silent zone | The kiosk is the speaker, so it shows its own Problem state; never the word "silent" |
| Over seats | No change |
| Licence expiring or expired | No change |
| Payment grace | No change during grace; when playback stops at close after grace or a pilot end, it shows Closed like any other night |
| Plan locked | A paused extra zone shows Closed |
| Pilot | No change, never a pilot badge |

**Layout.** Designed for 1920 by 1080 and 1280 by 800 landscape; works at 768 portrait for tablets used as kiosks; at phone size it still shows the same view. Dark by default. Screen wake lock while playing (`wakeLock.ts`); burn-in avoidance by shifting the text block a few pixels every 10 minutes (off under reduced motion, replaced by a slow fade between songs).

### D12. S6 - Customer-facing Rooms page per zone and zone display

The guest page (ADR-0416, extended by ADR-0451) per zone shows the **BrandedGuestHeader** (venue name, logo, zone name, welcome line), now playing, next up, search, My requests, and the footer line. The zone display shows the QR, "Scan to request a song", now playing and upcoming requests.

**S6 state matrix (guest page)**

| State | What shows |
|---|---|
| Empty | No requests yet: "Be the first to request a song"; no requestable songs: "Requests aren't available right now" |
| Loading | Text-only skeleton, under the 100 KB bundle limit |
| Offline | "You're offline. Your requests are safe" and retry |
| Degraded | Slower updates, no message unless a request takes 10 s ("Still sending...") |
| Silent zone | "The music's paused" (ADR-0416 copy) |
| Over seats | No change |
| Licence expiring or expired | No change |
| Payment grace | No change; after a stop at close, closed hours as normal |
| Plan locked | Zone without Rooms: "Requests aren't available here" |
| Pilot | No change |
| Closed hours | "Requests open at 17:00" |
| Requests paused | "Requests are paused for now" |

The zone display follows the same rules: in any problem state it shows the QR and "Scan to request a song" with now playing hidden, never a problem message.

### D13. S8 - Pilot administration (REX Technologies staff only)

- A page in the admin console (`web/src/admin/`, `DataTable`) lists pilots with organisation, owner email, venues and zones used of allowance, start and end dates, status (`Active`, `Ending soon`, `Ended`, `Converted`) and last activity.
- **Create pilot** (`business.pilots.create`): organisation name, owner email, allowance, end date (default 60 days), note; sends the owner an invitation to set up (S1 from step 2).
- Row actions: extend, change allowance, convert to paid (sends the owner a subscribe link), end now (asks first, with the stop-at-close rule explained). Each action asks for a reason and is audited (ADR-0401, ADR-0452).
- States: empty ("No pilots yet. Create one"), loading, offline, degraded as the admin console already handles them; plan locked does not apply.

### D14. New components

All are built from existing tokens and primitives (`Action`, `Status`, `Problem`, `Dialog`, `Drawer`, `Sheet`, `Menu`, `Tabs`, `LinkTabs`, `Field`, `TextField`, `Select`, `Combobox`, `SearchField`, `Slider`, `DataTable`, `Skeleton`, `Toaster`, `announce`, `LiveRegion`, `Icon`, `PlayingBar`, `Meters`, `qr.ts`, `useReducedMotion`, `useMediaQuery`, `useVisiblePoll`, `events.ts`). No new colours; new tokens only for the big-target size (`--control-height-big: 64px`) and the big-screen type step.

| Component | Built from | Used on |
|---|---|---|
| WorkspaceSwitcher, WorkspaceBand | `Menu`, command palette, tokens | All |
| SetupChecklist | `Status`, `LinkTabs` | S1 |
| VenueForm, OpeningHoursEditor, ZoneListEditor | `Field`, `TextField`, `Select`, `moveInGrid` | S1, S3 |
| LicenceAttestationForm, LicenceCard | `Field`, `Status` | S1, S3 |
| PairingCodeEntry | `TextField`, `Action` | S1, S3 |
| DaypartBar, ScheduleBoard, ScheduleDiffPreview | `EnergyHorizon` ideas, `DataTable`, `Dialog` | S1, S2, S3 |
| VenueHealthGrid, VenueHealthCard, ZoneStatus, NowPlayingTile | `Status`, `moveInGrid`, `SongMotif` | S2, S3 |
| SilentZoneAlert, NeedsAttentionList, ManagerNotice | `Problem`, `Status` | S2, S3, S4 (one line) |
| PlayLogExport | `Field`, `Action`, export job status | S2, S3 |
| PilotBadge | `Status` | S1, S2, S3, S7, S8 |
| StaffControlDeck, BigAction, ZoneSwitcher | `Action`, `Tabs` | S4 |
| VolumeLimitSlider | `Slider` | S3, S4 |
| RequestApprovalQueue | `RoomPanel` inbox parts | S3, S4 |
| ContentRulesEditor, ExplicitBulkEditor, BlocklistEditor | `DataTable` with selection, `Combobox` | S3 |
| GuestBrandingEditor, BrandedGuestHeader | `Field`, contrast check | S3, S6 |
| KioskScreen, KioskPairing, KioskTapToStart, KioskStaffPanel | Plain DOM in the kiosk entry, tokens | S5 |
| DataTable stacked mode | `DataTable` | S2, S3, S8 |

### D15. Copy rules

- Plain words, no blame, no exclamation marks, no jargon ("player", not "device principal"; "saved music", not "cache").
- Say what happens, when, and what to do: "Music in all venues stops at closing time on 26 November unless payment is updated".
- Amounts and dates in the reader's terms: prices in the organisation's currency, times in the venue's time zone.
- Customer-facing copy is limited to the music states in D11 and D12 and never names a cause.
- Everything says SelectaDJ; the company is REX Technologies.

### D16. Feature flags

`business.signups` (default off; S1 public entry), `business.console` (S2), `business.venue_view` (S3), `business.staff_controls` (S4), `business.kiosk` (S5), `business.workspaces` (S7), `business.pilots` (S8), plus the flags in ADR-0450 to ADR-0452. Every surface reflows when its flag is off; with `business.workspaces` off, nobody sees the switcher and business pages are unreachable.

## User outcome and acceptance contract

An owner (or a pilot venue) sets up a venue in one sitting and sees the first service scheduled. Head office sees every venue's music at a glance and knows within a minute when one goes silent. A manager fixes tomorrow from their phone. A bartender makes the music calmer with one wet thumb and cannot break anything. Customers only ever see music, never a problem.

## Edge cases

- A venue in another time zone from HQ: every time shows venue time with its abbreviation; the ScheduleBoard aligns by venue time, not HQ time.
- DST night during service: the Today bar shows the repeated or missing hour; durations stay correct.
- 500 venues on S2: the grid virtualises rows; sorting and search stay under 100 ms; Needs attention groups by kind ("12 licences end this month").
- A zone that is closed and also has a kiosk offline: `Closed` wins on the grid; the device problem shows on S3 Devices only.
- A person who is staff at one venue and owner of another organisation: the switcher shows both with roles.
- Screen reader user on S2 with 30 zones changing songs: per-zone announcements are rate-limited, and a "Pause announcements" toggle exists.
- S4 on a tablet under 400% zoom (a staff member with low vision): the deck reflows to one column of BigActions, all reachable without horizontal scroll.
- Kiosk in a sunny window: the venue can choose the light theme for S5.
- Kiosk screen turned off by the venue: audio continues; the screen is not required.
- Pilot ends while a manager has S3 open: the page turns read-only live through the `entitlement.changed` event.
- Business sign-up flag turned off while someone is mid-onboarding: their organisation already exists, so they continue; new visitors see the pilot contact page.

## Rejected alternatives

- One generic dashboard for every role (staff need five big buttons, HQ needs a grid; one screen serves both badly).
- Showing problems on the kiosk screen so staff notice them (customers notice first; alerts go to managers' devices instead).
- A separate visual identity for Business (the warm SelectaDJ identity and tokens carry over; the workspace band marks the context).
- Pulsing or flashing silent-zone alerts (harmful under reduced motion and alarming on shared screens).

## Implementation checklist - 0/22 Implemented; 0/22 independently Verified

1. **BZ-0453-01 - Business shell and navigation.** **Acceptance:** The business workspace has the D2 navigation, items shown per role, staff land on S4 and single-venue managers on S3. **Required verification:** Vitest per role; Playwright navigation at 375 and 1280 px. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0453-02 - State model and severity.** **Acceptance:** A shared `businessState` module derives D3's eleven states from server data with exact triggers and the severity order; only the top two become banners and the rest go to Needs attention. **Required verification:** Unit tests for each trigger and the order. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0453-03 - Customer-facing separation.** **Acceptance:** Kiosk, guest and display bundles never include ManagerNotice or manager copy keys; their server views carry only allowlisted fields; S4 shows manager states only as the one D4 line and only to managers. **Required verification:** Build test scanning the three bundles; payload tests for the three views in every D3 state; Vitest for S4. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0453-04 - Sign-up behind `business.signups`.** **Acceptance:** With the flag off, `/business/start` shows the pilot contact page and no public route creates an organisation; with it on, the trial flow runs through AuthKit and Stripe Checkout. **Required verification:** Route tests both ways; Playwright both ways. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0453-05 - Onboarding steps 2 to 4.** **Acceptance:** VenueForm, OpeningHoursEditor (overnight, holidays, plain-words preview) and ZoneListEditor save as you go, resume after a refresh and show prices or pilot allowance before adding zones. **Required verification:** Vitest; Playwright including refresh mid-step. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0453-06 - Onboarding licence, music and pairing.** **Acceptance:** The licence step blocks any zone playing until attested and refuses past dates; music can be uploaded or copied (never moved) from personal crates with the personal-use note; pairing confirms live. **Required verification:** Integration test that an unattested venue cannot auto-start; Playwright for copy and pairing with a fake kiosk. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0453-07 - First scheduled service.** **Acceptance:** Three templates, a plain summary of the first auto-start, and "Play a test now" with the honest failure copy. **Required verification:** Playwright with the cloud test server. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0453-08 - HQ venue health grid.** **Acceptance:** VenueHealthGrid shows every ZoneStatus with venue-local times, sorts by severity, filters and searches, virtualises 500 venues with sort and search under 100 ms, and is a keyboard grid with headers. **Required verification:** Vitest; Playwright with 500 seeded venues; axe. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0453-09 - Silent-zone alerts.** **Acceptance:** A zone silent for 60 s in opening hours appears in SilentZoneAlert on S2 and S3 within 70 s, is announced assertively once, never pulses, clears when audio returns and logs to activity; staff pause is not silence until 30 minutes. **Required verification:** Integration test with a fake heartbeat clock; Playwright for the alert and its clearing. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0453-10 - Schedules across venues.** **Acceptance:** ScheduleBoard in venue time, multi-select apply with ScheduleDiffPreview naming open venues, next-block (never mid-song) application, and the conflict view. **Required verification:** Vitest; Playwright applying to 200 seeded venues. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0453-11 - Play-log export and billing pages.** **Acceptance:** PlayLogExport runs as a job with honest progress and a 24-hour link; business billing shows venues, zones and seats as quantities, pooled storage, invoices with PO numbers; pilots see the pilot panel instead. **Required verification:** Vitest; Playwright with Stripe test mode faked. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0453-12 - Venue manager view.** **Acceptance:** S3's tabs and sections, the silent-zone steps, the ask-first unpair dialog, and every row of the S3 state matrix. **Required verification:** Vitest per state; Playwright at 375, 768 and 1280 px. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0453-13 - Staff quick-control view.** **Acceptance:** 64 px BigActions with 12 px gaps; Bigger, Calmer, Something else, Skip with undo, Pause with the 15-minute prompt, VolumeLimitSlider at the cap, RequestApprovalQueue, Stay open late within the allowance; no destructive control rendered; offline queueing with the 2-minute drop. **Required verification:** Vitest; Playwright on an emulated tablet with touch; a test that no destructive control exists for staff. **Implementation:** Not started. **Independently Verified:** No.
14. **BZ-0453-14 - Shared tablet PIN flow.** **Acceptance:** With PINs on, the first action after 2 minutes idle asks for a PIN on a large keypad; actions are attributed. **Required verification:** Playwright. **Implementation:** Not started. **Independently Verified:** No.
15. **BZ-0453-15 - Kiosk player screen.** **Acceptance:** Every kiosk state in D11, the hidden staff panel, wake lock, burn-in shift (still under reduced motion), and the S5 state matrix with no manager state ever shown. **Required verification:** Playwright against the kiosk entry in each state at 1920 by 1080 and 768 portrait, both themes; payload test. **Implementation:** Not started. **Independently Verified:** No.
16. **BZ-0453-16 - Customer Rooms page and display states.** **Acceptance:** The S6 matrix holds for the guest page and display in every D3 state, with BrandedGuestHeader and the bundle under 100 KB. **Required verification:** Playwright at 320 px over a slow connection; bundle-size test. **Implementation:** Not started. **Independently Verified:** No.
17. **BZ-0453-17 - Workspace switcher.** **Acceptance:** WorkspaceSwitcher and WorkspaceBand on every page, the playing-music ask, a zone speaker cannot switch to personal, uploads name their destination, deep links switch with a toast, per-tab workspaces. **Required verification:** Vitest; Playwright with two tabs in different workspaces. **Implementation:** Not started. **Independently Verified:** No.
18. **BZ-0453-18 - Pilot states and admin page.** **Acceptance:** PilotBadge and pilot copy on S1, S2, S3 and S7 (never on S4 for staff, S5 or S6); the S8 admin page creates, extends, changes, converts and ends pilots with reasons and audit. **Required verification:** Vitest; Playwright in the admin console; payload test that pilot fields never reach customer views. **Implementation:** Not started. **Independently Verified:** No.
19. **BZ-0453-19 - Responsive layouts and big screen.** **Acceptance:** Every surface passes at 320, 375, 768, 1024, 1280, 1440 and 1920 px with no horizontal page scroll (except the schedule board's own region), DataTable stacked mode under 600 px, and big-screen type and overscan rules on S2 wall mode, S5 and the display. **Required verification:** Playwright screenshot sweep, looked at, in both themes. **Implementation:** Not started. **Independently Verified:** No.
20. **BZ-0453-20 - Keyboard, screen reader, motion, zoom and forced colours.** **Acceptance:** Keyboard-only journeys for S1 to S4, S7 and S8; landmarks and headings; rate-limited polite announcements and one assertive silent-zone alert; no motion under reduced motion or Still; 400% zoom reflow; forced-colours marks visible; zero serious axe findings. **Required verification:** Playwright keyboard and axe sweeps; NVDA session on S2, S4 and S6; Needs a person: VoiceOver on iPhone for S4 and S6. **Implementation:** Not started. **Independently Verified:** No.
21. **BZ-0453-21 - Copy deck review.** **Acceptance:** Every string in D6 to D13 is in a business copy module, says SelectaDJ, has no em dashes, and customer-facing strings never name a cause. **Required verification:** Unit test over the copy module (forbidden words list for customer keys); Needs a person: the owner reads the copy deck and approves it. **Implementation:** Not started. **Independently Verified:** No.
22. **BZ-0453-22 - Flags and reflow.** **Acceptance:** The D16 flags are registered with `docs/flags.md` regenerated, `business.signups` defaults off, and each surface closes up cleanly when its flag is off. **Required verification:** `tests/test_flags.py`; business flag sweep. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
