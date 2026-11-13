# ADR-0451 - Rooms for Business: customer requests per zone with staff approval

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/11 Not started.
- **Independent verification:** 0/11 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; branch `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 for pilots (a venue can run without requests; requests are a reason to choose SelectaDJ). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0416 (Rooms), ADR-0422 (guest nickname and Room state), ADR-0431 (moderated requests), ADR-0435 (guest privacy), ADR-0443 (zone sessions), ADR-0444 (opening hours), ADR-0450 (content controls); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/rooms/` (lifecycle, limits, guessing, planning, ordering, views, api_guest, api_host, display); `web/src/guest/`, `web/src/display/`, `web/src/rooms/RoomPanel.tsx`, `web/src/rooms/qr.ts`; new `src/selecta/business/rooms.py`, `web/src/business/requests/`.
- **Proposal chapter:** [docs/saas/19b-business-experience.md](../saas/19b-business-experience.md#19b2-rooms-for-business).

## Context and evidence boundary

ADR-0416 built Rooms for a Premium host at a party: one room at a time, a 12-hour limit, a code the host can rotate, guests who request songs from their phones and a planner that fits them in. A venue is different in four ways that change the design:

1. The QR code is printed on table cards and posters, so it must stay the same for months.
2. Guests all share the venue's Wi-Fi, so many of them arrive from one public IP address.
3. The people approving requests are staff on shift, not the person who owns the account, and they may not be watching.
4. What may play is governed by the venue's content rules (ADR-0450), not only the host's taste.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

### One standing room per zone

- Each zone with requests turned on has one **standing room**. It does not expire after 12 hours; it is open while the zone is open (ADR-0444) and in "closed" state otherwise. ADR-0416's party rooms are unchanged for personal accounts.
- Its join link and QR code are stable: `/r/{code}` with the same 8-character code alphabet and hashing as ADR-0416. A manager can make a new code (for example after abuse); the manager view warns that printed cards will stop working and offers the print sheet again.
- A **print sheet** generates table cards and a poster per zone as a PDF in the browser, with the venue's name, logo and the zone name, from the existing QR encoder (`web/src/rooms/qr.ts`).
- Optional **on-screen code** mode for venues with remote abuse: the zone display (big screen) shows a code that changes every 15 minutes, and requests need that current code. Printed cards then only show what is playing.

### Who approves

- Request modes per zone and daypart: `Staff approve each` (default), `Auto-accept`, `Off` (watch only). A daypart can turn requests off (for example quiet brunch).
- Staff approve or pass on the staff quick-control view (ADR-0453) or any manager view for that venue. Each approval is attributed to the person or the shared device (ADR-0452).
- A request nobody approves within 20 minutes (venue-tunable 5 to 60) expires; the guest sees "Not this time". It never sits forever.
- If no staff device for the venue has been seen for 10 minutes while the zone is in `Staff approve each`, the guest page says "Requests are paused for now" instead of accepting requests that will only expire.

### Content rules and the planner

- Guest search shows only songs that ADR-0450's engine allows in that zone at that time: title, artist and length, as in ADR-0416. A blocked or explicit-filtered song simply is not there; the page never says why.
- The request planner re-checks the rules when the request is placed and when its slot comes up. A request whose song is refused by then is withdrawn with "That one doesn't fit the music here right now".
- A request must also fit the daypart's brand rules (BPM and energy range); the planner may use bridges, which must themselves be allowed songs.
- Round-robin across guests, votes and the per-zone render cap follow ADR-0416. Renders run in the organisation's interactive lane at Business weight during opening hours (ADR-0448).

### Request limits

| Limit | Default | Manager can set |
|---|---|---|
| Pending per guest | 1 | 1 to 3 |
| Per guest per hour | 3 | 1 to 6 |
| Song cooldown after it plays | 60 min | 30 to 240 min |
| Pending in the zone | 20 | 5 to 50 |
| Accepted per zone per hour | 12 | 1 to 30 |
| Guests in the zone at once | 300 | plan maximum |

### Venue Wi-Fi and shared addresses

- The kiosk player's public address is recorded as a **venue network** for that venue (ADR-0445 heartbeat). Joins and writes from a venue network use per-guest and per-zone limits, with per-IP limits scaled for a crowd (500 joins in 10 minutes) instead of ADR-0416's 10 joins a minute.
- Code-guessing lockouts (ADR-0416, `rooms/guessing.py`) never lock out a venue network as a whole; they lock the guest token and raise a manager notice instead.
- Addresses are only ever stored as keyed hashes, as today.

### Venue-branded guest page

- The guest page shows the venue's name, logo, zone name and a short welcome line the manager writes (plain text, 140 characters).
- The venue may pick an accent colour. It is used only on the header band and the primary button, and only when it passes 4.5:1 contrast in both themes; otherwise the page uses the standard tokens and the manager is told why.
- Guests never see staff names, the organisation's other venues, billing, licence or device state. Request states are ADR-0416's honest states plus "Requests open at 17:00" (closed) and "Requests are paused for now".
- A small "Powered by SelectaDJ" line sits in the footer.

### Abuse handling

- Staff and managers can remove or ban a guest (for the day or 7 days) and pause requests for a zone with one tap; pausing is not destructive and is undone with one tap.
- **Flood switch**: if a zone receives more than 3 times its hourly accepted limit in 10 minutes, it switches to `Staff approve each` by itself and tells staff.
- No free text from guests anywhere (ADR-0416 and the Online Safety Act position): nicknames are generated, requests are catalogue picks.
- Guest data: guest id, hashed address, nickname and requests, deleted 30 days after the guest's last activity in that room.

### Feature flags

`business.rooms` (standing zone rooms and the staff queue), `business.rooms.branding` (logo, colour, welcome line), `business.rooms.print` (print sheet) and `business.rooms.screen_code` (rotating on-screen code), in the business flag area (ADR-0441).

## User outcome and acceptance contract

A guest scans a table card, sees what is playing in that room and asks for a song that suits the venue. Staff approve it with one tap between serving drinks. Nothing that breaks the venue's rules can be requested, nobody can flood the queue, and the printed cards keep working for months.

## Edge cases

- Guest scans the terrace card while sitting in the bar: requests go to the terrace (the card names the zone; the page shows the zone name large).
- Card scanned after closing: "Requests open at 17:00" with what played last hidden (no data shown outside hours).
- Venue stays open late (ADR-0444): the room stays open until the new close.
- Zone paused by staff: guests see "The music's paused" (ADR-0416 copy), requests wait.
- Zone silent because the kiosk is offline: guests see "The music's paused"; never "offline" or device words.
- Payment grace or licence expiry: no change for guests until playback stops at a closing time; then the room shows closed hours like any other closed day.
- Plan downgrade removes a zone: its room closes at that zone's next close; cards then show "Requests aren't available here".
- 40 guests request the same song: one request with 40 votes (ADR-0416).
- A guest requests a song that is in the venue library but refused only in this daypart: it is not in search; if it was pending from an earlier daypart, it is withdrawn with the honest message.
- Two staff approve the same request at once: one approval wins, the other sees "Already approved by Bar tablet".
- Manager rotates the code during service: guests already in keep their room (room id unchanged); new scans of old cards get "This code has changed. Ask staff for the new one".
- Venue on CGNAT where the kiosk's address is shared with other customers: venue network relaxation applies only to that venue's rooms.

## Rejected alternatives

- Location checks (GPS or Wi-Fi fingerprinting) to prove a guest is in the venue: invasive, unreliable indoors, and needless with staff approval and on-screen codes.
- Free-text song suggestions: Online Safety Act exposure and moderation load.
- Showing guests why a song was refused: it reveals content rules and invites argument.

## Implementation checklist - 0/11 Implemented; 0/11 independently Verified

1. **BZ-0451-01 - Standing zone rooms.** **Acceptance:** One standing room per zone with requests on; open and closed follow opening hours and stay-open-late; no 12-hour expiry; personal party rooms unchanged. **Required verification:** Integration tests over a simulated week including an overnight close and a DST night. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0451-02 - Stable codes, rotation and print sheet.** **Acceptance:** Codes stay the same until a manager rotates them; rotation warns about printed cards; the print sheet makes table cards and a poster per zone whose QR decodes to the right link. **Required verification:** Unit tests (QR decoded with jsqr); Playwright for rotate and print. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0451-03 - Rotating on-screen code.** **Acceptance:** In on-screen mode the zone display shows a code that changes every 15 minutes; requests need the current code; printed cards become view only. **Required verification:** Integration tests with a frozen clock. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0451-04 - Staff approval queue.** **Acceptance:** Approve and pass from the staff and manager views, attributed to the person or shared device; 20-minute expiry; "Requests are paused for now" when no staff device was seen for 10 minutes; double approval resolves to one. **Required verification:** Integration tests; Playwright on the staff view. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0451-05 - Content rules in search and planning.** **Acceptance:** Guest search shows only songs ADR-0450 allows for that zone and time; requests are re-checked when placed and when their slot comes up; bridges are allowed songs; refused requests are withdrawn with the honest message. **Required verification:** Integration tests with blocked, explicit and out-of-range songs planted. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0451-06 - Request limits.** **Acceptance:** The table's defaults hold and are tunable only within the stated ranges; per-daypart request modes work. **Required verification:** API tests at each bound. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0451-07 - Venue network limits.** **Acceptance:** The kiosk's public address is recorded as the venue network; 500 guests joining from it in 10 minutes succeed; code-guessing never locks out the venue network, only the token. **Required verification:** Load test against the cloud test server; abuse tests. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0451-08 - Venue-branded guest page.** **Acceptance:** Name, logo, zone, welcome line and an accent colour used only when it passes 4.5:1 in both themes; the guest bundle stays under ADR-0416's 100 KB; no staff names, billing, licence or device words in any guest payload. **Required verification:** Bundle-size test; contrast unit test; a payload test scanning guest responses for forbidden fields; Playwright at 320 px in both themes. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0451-09 - Abuse handling.** **Acceptance:** Remove, ban (day or 7 days), pause and resume requests; the flood switch moves a zone to staff approval and tells staff; guest data is deleted 30 days after last activity. **Required verification:** Integration tests; purge test with a frozen clock. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0451-10 - Flags.** **Acceptance:** `business.rooms`, `.branding`, `.print` and `.screen_code` are registered with `docs/flags.md` regenerated; with each off its controls vanish and pages reflow; with `business.rooms` off, cards show "Requests aren't available here". **Required verification:** `tests/test_flags.py`; flag sweep. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0451-11 - Legal view for venue requests.** **Acceptance:** A lawyer reviews the business guest notice, the Online Safety Act position for a standing public room and the venue's responsibility for requested songs, and the owner records that view. **Required verification:** Needs a person: legal review. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
