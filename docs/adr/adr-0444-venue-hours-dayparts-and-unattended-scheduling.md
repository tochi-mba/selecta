# ADR-0444 - Venue opening hours, dayparts and unattended scheduling

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/12 Not started.
- **Independent verification:** 0/12 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off), used by pilot venues in Phase B1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0394 and ADR-0395 (durable jobs, fair scheduling), ADR-0424 (Autopilot resident DJ), ADR-0425 (venue music identity and schedules) and ADR-0426 (rolling musical horizon) of the Autopilot programme; their statuses are unchanged. Sibling Business ADRs: ADR-0441 to ADR-0443, ADR-0445 to ADR-0454.
- **Source touchpoints:** `src/selecta/planner/arc.py` (`target_energy`, custom curves); `src/selecta/planner/vibes.py`; `src/selecta/planner/beam.py`; `src/selecta/session.py` (`Steering`, `steer`); `src/selecta/request_planner.py`; `src/selecta/work/maintenance.py`; new `src/selecta/business/hours.py`, `business/dayparts.py`, `business/zone_clock.py`; new `web/src/business/schedule/`.
- **Proposal chapter:** [docs/saas/19a-venue-operations.md](../saas/19a-venue-operations.md#19a3-hours-and-dayparts).

## Context and evidence boundary

Nobody presses Play in a venue at 10:00 on a Tuesday. Music has to start before the doors open, change character through the day without anyone touching it, and fade at close, in each venue's own time zone, through DST nights, bank holidays and the night the manager decides to stay open late.

The planner already has the parts a schedule needs. `planner/arc.py` turns progress through a set into a target energy (presets `slow_burn`, `steady`, `climb`, `wind_down`, `peak_time`, or a custom curve). `session.Steering` carries `energy` (-2 to 2), `energy_arc` (five points 0 to 100), `mix_language`, `stems`, `target` ("take me to" a song) and `length_mode`, changed one tap at a time by `session.steer`. Vibes (`planner/vibes.py`) build a mix around a mood with an energy shape. The request planner fits songs into the mix with bridges. What is missing is time: nothing knows what a venue's day looks like, and steering today is a person's tap, not a clock.

ADR-0425 (Autopilot) proposes venue profiles with daypart energy targets and closing behaviour, and ADR-0426 a rolling horizon with committed, prepared and speculative parts that replans only uncommitted audio. This ADR is the Business implementation of both for zones.

This ADR records a proposed decision. Nothing in it is implemented or measured yet.

## Decision

### Opening hours

- Each venue has a weekly pattern: for each weekday, zero or more **periods**, each an opening wall-clock time and a closing wall-clock time in the venue's IANA time zone (ADR-0442).
- **A period belongs to the day it opens.** Friday 18:00 to 02:00 is Friday's period, even though it ends on Saturday. A closing time at or before the opening time means "the next day". Saturday 01:30 is therefore inside Friday's period, and Saturday's own period starts later.
- A period may be marked **open 24 hours**: no auto-stop, no closing fade; the kiosk only follows dayparts.
- Overlapping periods on the same day are refused when saved ("Friday has two periods that overlap: 10:00 to 15:00 and 14:00 to 23:00").
- Each zone follows its venue's hours by default and may have its own narrower hours (the terrace opens at 12:00); a zone can never be open when its venue is closed, except through stay open late.

### Time arithmetic, DST and time zones

- Hours are stored as wall-clock times plus the zone name, never as UTC instants, and turned into instants with `zoneinfo` for a rolling window (the next 14 days), recomputed daily and whenever hours, exceptions or the time zone change.
- **Spring forward (a missing hour).** An opening or closing time that falls in the gap moves to the first valid instant after it (UK 01:30 becomes 02:00 BST). A period's length is whatever the wall clock says; a venue open 20:00 to 02:00 on that night is open five real hours.
- **Fall back (a repeated hour).** An opening time in the repeated hour uses its first occurrence. A closing time in the repeated hour uses its **first** occurrence by default (wall clock as staff read it, and as licence hours are written); a venue that wants the extra hour presses stay open late. The venue never closes twice: once the first occurrence passes, the period is over.
- **Two venues in different time zones** each compute their own instants; the HQ view shows each venue's local time beside its state ("Lisbon, 22:14, open until 02:00"), and schedule editors always edit in the venue's own time with the zone named.
- All server decisions use the database clock (`now()`), as the lease reaper does; kiosks use server time when online and the rules in ADR-0446 when offline.

### Exceptions: holidays, special hours, closures

- **Date exceptions** per venue (and optionally per zone): closed all day, or replacement periods for that date. An exception is keyed to the opening date, so "closed 25 December" removes the period that opens on the 25th, and a 24 December period running past midnight still ends at its own close.
- Exceptions can be added a year ahead, imported from a public holiday calendar for the venue's country as suggestions the manager accepts (never applied automatically), and repeat yearly if chosen.
- A venue-wide **pause** ("closed for refurbishment until 3 March") is an exception range.

### Stay open late and close early

- **Stay open late** extends tonight's current period by 30, 60 or 120 minutes, or to a chosen time, up to a venue allowance set by managers (default up to 3 hours past the scheduled close for managers, 1 hour for staff, ADR-0452). It applies only to tonight; it shows everywhere as "Open late until 01:00 (Sam)" and is audited.
- **Close now** fades out over 60 seconds and ends the period; music starts again at the next period. Undo within 5 minutes restarts the music with a fade-in.
- Both are server state on the venue (`venue_hour_overrides`), so a kiosk offline at the time gets them on reconnect, and an online kiosk gets them within a second through its zone stream.

### The zone day: closed, warming, opening, open, closing

| State | When | What happens |
|---|---|---|
| Closed | Outside every period | Kiosk shows Closed (ADR-0453 S5); no rendering except speculative; no alerts |
| Warming | From 45 minutes before opening (ADR-0448 renders at Business weight from 30 minutes before; the extra 15 minutes are standard lane) | The zone's horizon is planned and rendered (ADR-0446); the kiosk downloads it; no audio |
| Opening | At the opening instant | The kiosk starts the first song with a 10 second fade-in at the zone's opening volume |
| Open | Until the closing instant | Dayparts apply (below); requests open (ADR-0451); silent-zone alerts armed (ADR-0445) |
| Closing | From the closing instant | The current song plays to its natural end or at most 4 minutes, then a 20 second fade; a venue can choose "end at the closing time exactly" (fade over the last 20 seconds before it) for strict licence hours |
| Closed | After the fade | The kiosk releases the lease (`state = stopped`), uploads play logs, may apply updates (ADR-0445) |

- The server's **zone clock** (a maintenance task on the leader, idempotent and term-numbered like every maintenance task) computes the next state change per zone from the 14-day instants and writes it as a zone schedule event to the outbox; the kiosk acts on it. The kiosk also holds the same schedule (ADR-0446) so it acts on time without the server.
- If the kiosk starts late (power came back at 11:20), it starts the horizon at the point the schedule says should be playing now, not from the morning's first song.

### Dayparts

- Each zone has a **weekly programme** of blocks: a start time, a name ("Brunch calm"), allowed crates (ADR-0450, falling back to the zone default), an energy target (a level or a five-point arc in the existing `energy_arc` format, 0 to 100), an optional vibe (a `planner/vibes.py` key), a mix language (`balanced`, `seamless`, `punchy`, `wordplay`, `surprise`, as `session.steer` accepts), a stems frequency and the brand rules ADR-0450 owns (BPM and energy ranges, spacing). A block runs until the next block or the close.
- Date exceptions can replace a day's programme ("Christmas Eve": party blocks).
- A block maps onto the planner exactly as a person's steering does: its arc becomes the `custom` curve given to `planner/arc.target_energy` over the block's length; the vibe and crates select the pool; mix language and stems go where `Steering.mix_language` and `Steering.stems` go today. No second planner exists.
- **Staff steering inside a block** (Bigger, Calmer, Something else) shifts `Steering.energy` for that zone, as today's taps do, and decays back to the block's target over the next three songs unless pressed again. A new block resets it.

### Moving between blocks without a hard cut

- The planner treats the block boundary as an energy target, not a wall: it starts ramping from the old block's energy toward the new block's over a **lead-in** (default 2 songs or 10 minutes before the boundary, whichever is longer), using the existing energy steering.
- The first song of the new block is chosen from the new block's pool; the transition into it is an ordinary seam chosen by `planner/choose.py`, with the new block's mix language. The actual change happens at the transition nearest the boundary, at most 8 minutes early or late; it is never cut to the second.
- If the old and new pools share no reachable pair, the planner uses a bridge song allowed in both, as the request planner does; if none exists, it uses the always-available echo out (`planner/choose.py`), so the zone never goes silent.

### Schedule changes while playing

- Edits save as a new **schedule version**. The zone's horizon has a committed window (the playing song and the next two transitions, already rendered and possibly cached on the kiosk, ADR-0426) that is never replanned; everything after it is replanned from the end of the committed window with the new version.
- An edit to the **current** block (more energy now) starts a lead-in from the end of the committed window, as a block boundary would.
- An edit to hours that closes the zone sooner than the horizon reaches trims the horizon; one that opens earlier than now while closed starts the warming state at once.
- Content rule changes follow ADR-0450 ("Changing rules mid-service"): tightening applies before the next song even inside the committed window; loosening applies after it.

## Data model and code touchpoints

| Change | Where | Notes |
|---|---|---|
| New `venue_hours` (`id`, `workspace_id`, `venue_id`, `zone_id` nullable, `weekday`, `opens`, `closes`, `all_day`) | new `business/schema.py` | Wall-clock `HH:MM` strings; `zone_id` for narrower zone hours |
| New `venue_hour_exceptions` (`venue_id`, `zone_id` nullable, `date`, `closed`, `periods_json`, `repeat_yearly`, `note`) | same | Keyed to the opening date |
| New `venue_hour_overrides` (stay open late, close now; `created_by`, `created_at`, `ends_at`) | same | Audited (ADR-0452) |
| New `zone_programmes` and `zone_programme_versions` (immutable `blocks_json`, `created_by`) | same | A zone points at its current version |
| `business/hours.py` | new | Pure functions: `periods_between(venue, start, end)`, `state_at(zone, instant)`, DST rules; no database |
| `business/zone_clock.py` | new, run from `work/maintenance.py` | Next state change per zone; outbox `zone.schedule` events |
| `business/dayparts.py` | new | Block to planner inputs: crates, vibe, `target_energy(custom=...)`, mix language, stems, lead-in |
| Planner calls | `planner/arc.py`, `planner/beam.py`, `planner/vibes.py` | Unchanged signatures; `dayparts.py` supplies the custom curve and pool |
| Steering per zone | `session.py` | Today steering is one preference per library (`db.preference(conn, "steering")`); in the cloud it becomes a column on the zone session (ADR-0443) with decay toward the block |

## User outcome and acceptance contract

A manager sets the hours and the day's music once. Every day the music starts before the first customer, changes mood through the day without a jolt, follows holidays and late nights, and fades at close, in the venue's own time.

## Edge cases

- **Overnight hours.** Friday 18:00 to 02:00 belongs to Friday; Saturday 01:30 is inside it; Saturday's own 10:00 opening is unaffected.
- **Spring forward inside opening hours.** Close stays at the wall-clock close; the night is one real hour shorter.
- **Fall back with a close at 01:30.** Closes at the first 01:30; never closes twice; stay open late covers the extra hour.
- **Two venues in London and Lisbon.** Each opens at its own 10:00; the HQ shows both local times.
- **Closed on 25 December, open late on 24 December past midnight.** The 24th's period ends at its own close on the 25th; nothing opens on the 25th.
- **Stay open late pressed at 23:58 for a 00:00 close.** Applies; the closing fade is cancelled before it starts. Pressed during the closing fade: the fade reverses over 10 seconds and the music carries on.
- **Stay open late beyond the staff allowance.** Refused with the allowance named; managers may go further, up to their allowance.
- **Hours edited during service** (close moved from 23:00 to 22:00 at 21:30). Takes effect at the next boundary that is still in the future; the horizon is trimmed; nothing cuts.
- **A block whose crates are emptied by deletions or rules.** Falls back as ADR-0450 decides; the manager is told.
- **A block shorter than its lead-in** (a 10-minute "Happy birthday" block). The lead-in is shortened to fit; at least one song of the block plays.
- **Open 24 hours.** No closing, no warming; dayparts only.
- **The kiosk is offline at a block boundary or at opening and closing.** It follows its cached schedule and horizon (ADR-0446); the horizon was planned across the boundary before the drop.
- **The kiosk's clock is six hours wrong.** Server time wins online; offline rules are ADR-0446's.
- **Payment grace or a pilot ends** (ADR-0447, ADR-0452). Playback stops at the venue's next closing instant as computed here; stay open late pressed that night does not extend past the stop.
- **A venue changes its time zone.** Applied at the next close (ADR-0442); the 14-day window is recomputed.
- **The planner cannot reach the next block's energy in time** (pool too narrow). It gets as near as the pool allows and records the miss; ADR-0450's relaxation order applies.

## Rejected alternatives

- **Storing hours as UTC instants.** Wrong twice a year and wrong for every venue that is not in UTC.
- **Hard switch at the block time.** Exactly the jolt a DJ never makes.
- **A separate schedule planner.** The existing planner, arc and steering already produce the musical behaviour; a second one would drift from them.
- **Applying public holidays automatically.** Many venues open on holidays; suggestions only.

## Implementation checklist - 0/12 Implemented; 0/12 independently Verified

1. **BZ-0444-01 - Opening hours model.** **Acceptance:** Weekly periods per venue and narrower zone hours; overlaps refused; a period belongs to its opening day; open 24 hours supported. **Required verification:** Unit tests in `tests/test_business_hours.py`. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0444-02 - Time zones and DST.** **Acceptance:** `hours.periods_between` gives correct instants for overnight hours, spring forward (gap moves to the first valid instant), fall back (first occurrence, never closing twice) and venues in different zones, checked against `zoneinfo` for Europe/London, Europe/Lisbon, America/New_York and Australia/Sydney across their 2026 and 2027 transitions. **Required verification:** Unit tests including `test_spring_forward_inside_opening_hours_keeps_the_right_close` and `test_fall_back_repeated_hour_does_not_close_twice`. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0444-03 - Exceptions.** **Acceptance:** Closed days, replacement periods, yearly repeats and ranges; keyed to the opening date; holiday suggestions are never applied without acceptance. **Required verification:** Unit tests including `test_holiday_closure_overrides_the_weekly_hours`. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0444-04 - Stay open late and close now.** **Acceptance:** Extends only tonight within the role's allowance; pressed during the closing fade it reverses the fade; close now fades over 60 s and can be undone within 5 minutes; both audited. **Required verification:** Integration tests including `test_stay_open_late_extends_only_tonight` and `test_stay_open_late_beyond_the_staff_allowance_is_refused`. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0444-05 - Zone day states.** **Acceptance:** Closed, warming, opening, open and closing follow the table; a late start joins the horizon where the schedule says; the closing modes (natural end within 4 minutes, or exact) both work. **Required verification:** Unit tests with a fake clock; integration test of the kiosk commands. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0444-06 - Zone clock task.** **Acceptance:** The maintenance leader computes each zone's next state change, writes one outbox event per change, is idempotent across a leader change, and recomputes when hours, exceptions, overrides or the time zone change. **Required verification:** Integration tests with two leaders and a term change. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0444-07 - Daypart programmes.** **Acceptance:** Weekly blocks with crates, energy level or arc, vibe, mix language, stems and brand rules; immutable versions; date exceptions replace a day's programme. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0444-08 - Blocks drive the existing planner.** **Acceptance:** A block's arc reaches `planner/arc.target_energy` as its custom curve and its pool, vibe, mix language and stems reach the planner where steering does today; no second planner. **Required verification:** Unit tests asserting the planner inputs for a block. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0444-09 - Boundaries without hard cuts.** **Acceptance:** The lead-in ramps energy toward the next block; the change lands on the transition nearest the boundary within 8 minutes; a bridge or the echo out is used when pools do not connect; no planned transition is a cut. **Required verification:** Planner tests on a made-up library across a calm-to-energetic boundary, checking the energy curve and every chosen move. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0444-10 - Edits while playing.** **Acceptance:** Schedule and hours edits replan only after the committed window; edits to the current block start a lead-in; hour edits trim or start warming; tightened content rules follow ADR-0450. **Required verification:** Integration tests including `test_hours_edit_during_service_takes_effect_at_the_next_boundary`. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0444-11 - Staff steering decays to the block.** **Acceptance:** Bigger and Calmer shift the zone's energy and decay back over three songs; a new block resets it; steering is stored per zone session. **Required verification:** Unit tests. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0444-12 - Flag `business.schedules`.** **Acceptance:** Registered in `src/selecta/flags/cloud.json` (cloud mode, default off, requires `business.zones`); `docs/flags.md` regenerated; with it off zones play only when started by hand and the schedule pages are absent with layouts reflowing. **Required verification:** `tests/test_flags.py`; Playwright flag-off run. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12, awaiting the owner's decision. Older ADRs keep their statuses; this one only links to them.
