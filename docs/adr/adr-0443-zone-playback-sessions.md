# ADR-0443 - Zone playback sessions: one speaker per zone, remotes across zones

> **Local-first architecture supersession (2026-11-13):** Future media ownership, plan/venue execution and UI contracts are governed by ADR-0466, ADR-0468 and [the LF parity matrix](selecta-local-first-overlap-and-parity.md). This older decision remains a historical record; past status and evidence are not erased. LF implementation is not started.

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/11 Not started.
- **Independent verification:** 0/11 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off), used by pilot venues in Phase B1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0415 (devices and one session per account), ADR-0395 (fair scheduling), ADR-0407 (real-time updates), ADR-0429 (six-hour venue audio continuity) and ADR-0433 (venue speakers, leases and zones) of the Autopilot programme; their statuses are unchanged. Sibling Business ADRs: ADR-0441, ADR-0442, ADR-0444 to ADR-0454.
- **Source touchpoints:** `src/selecta/playback/schema.py`, `model.py`, `session.py`, `store.py`, `commands.py`, `ports.py`, `api.py`; `src/selecta/scheduling/policy.py`; `src/selecta/work/enqueue.py`, `work/claims.py`, `work/heads.py`; `src/selecta/storage/eviction.py`; `web/src/devices/usePlaybackDevice.ts`, `PlayingBar.tsx`, `DevicesPanel.tsx`; new `web/src/business/zones/`.
- **Proposal chapter:** [docs/saas/19a-venue-operations.md](../saas/19a-venue-operations.md#19a2-zone-playback-sessions).

## Context and evidence boundary

ADR-0415 built one playback session per account. In code the session is a single row keyed by `workspace_id` (`playback_sessions` in `playback/schema.py`), every session function takes `(engine, workspace_id, device_id, ...)` and locks that row (`store.lock_session`), a heartbeat with no live lease takes over (`session.heartbeat`, outcome `TOOK_OVER`), `take_over` is Play here, `on_reconnect` answers `continue` or `stop_moved`, commands carry `based_on_seq` and an idempotency key unique per workspace, and events go out through `PlaybackEvents.publish(conn, workspace_id, kind, payload)`. The lease is 20 s, renewed every 5 s (`model.LEASE_SECONDS`, `HEARTBEAT_SECONDS`).

A venue with a bar and a terrace needs two sessions playing different music at the same time inside one organisation workspace, and staff need to steer either zone from one phone. ADR-0433 already says to keep one-session-per-account semantics and add venue-zone identities with distinct lease ownership; this ADR is the concrete design for that.

This ADR records a proposed decision. Nothing in it is implemented or measured yet.

## Decision

### One session per zone

- The session key becomes `(workspace_id, zone_id)`. A personal workspace keeps exactly one session with `zone_id` null, so personal behaviour, routes and tests are unchanged. A business workspace has one session per active zone and none with a null zone.
- Every rule from ADR-0415 holds per zone: one speaker with a 20 s lease, remotes with the extrapolated position, sequence numbers, idempotent commands, Play here, offline speaker rules, only the speaker reports listening events.
- **A device holds at most one zone lease at a time.** A heartbeat or Play here for zone B from a device that holds zone A's live lease is refused with "This player is playing Bar. Move it to Terrace?" (the move is a manager action, below). This is what makes "one speaker per zone" true across zones, not just within one.

### Zones that share one physical speaker

- SelectaDJ plays one stream per zone and does not synchronise audio across devices. If one amplifier feeds two areas, those areas are **one zone** in SelectaDJ ("Bar and terrace"). The setup guide says so plainly.
- If two zones are wired to two outputs of one mini PC (two sound cards), each needs its own kiosk browser profile and its own pairing; the browser page can only reach the system's chosen output device unless `setSinkId` is supported, so the guide recommends one player device per zone. Two browser windows on one machine both trying to play to one output is refused at pairing: a kiosk reports a stable machine fingerprint (ADR-0445) and a second zone pairing from the same machine warns "This machine already plays Bar. Two zones on one speaker will play over each other."
- Multi-room synchronised playback is out of scope (rejected below).

### Moving a device between zones

- Managers move a kiosk to another zone from the venue view (ADR-0453 S3). If the kiosk holds its current zone's lease during opening hours, the confirm says "Bar will go silent unless its standby player takes over" and offers "Move now" or "Move at closing time".
- Moving now: the old zone's lease is released (sequence++), the kiosk fades out over one second, re-binds to the new zone and starts it only if the new zone is open and has no live speaker. The old zone falls to its standby kiosk (ADR-0445) if it has one, otherwise it raises the silent-zone alert (ADR-0445).
- A kiosk can never be bound to zones in two venues; moving across venues is unpair and pair.

### Home speaker, standby, and staff Play here

- Each zone names a **home** kiosk and optionally a **standby** kiosk (`zones.home_device_id`, `zones.standby_device_id`, ADR-0442). During opening hours, the standby heartbeats as a remote; if the zone's lease has been dead for 20 s and the home kiosk is not heartbeating, the standby's next heartbeat takes over (the existing `TOOK_OVER` path). When the home kiosk returns, it does not snatch the lease back mid-song: the standby hands back at the next song boundary (a server-issued `hand_back` command), so the bar never hears a cut.
- **A staff phone pressing Play here on a zone** is allowed for people with `business.zone.control` (ADR-0452) as an emergency speaker, because a silent bar is worse than a phone speaker. It asks first: "Play Bar music from this phone? The Bar player will stop." While a person device holds a zone lease, managers see "Bar is playing from Sam's phone", the phone shows "Hand back to Bar player", and when the home kiosk heartbeats again the phone is offered the hand-back. The phone cannot switch to its personal workspace until it hands back (ADR-0453 D9). An iPhone gets ADR-0415's keep-the-screen-on warning.
- A zone setting `allow_person_speakers` (default on) lets a venue forbid it; with it off, Play here is hidden for that zone and the API refuses with 403 `person_speaker_off`.

### Remotes across zones

- A remote sees every zone in its scope (ADR-0452 venue scope; out-of-scope zones answer 404 exactly like missing ones) and controls one zone at a time through the ZoneSwitcher (ADR-0453 D10).
- Commands name the zone: `POST /api/zones/{zone_id}/playback/commands`, with the same body as `/api/playback/commands`. The personal routes stay as they are and act on the null-zone session.
- Zone volume is session state (a `volume` field on the zone session row, 0 to 100), set by any remote within ADR-0450's cap and applied by the speaker as software gain. It is the only volume a remote can change; the personal session keeps volume local to the device, as today.

### Events

- `PlaybackEvents.publish` gains the zone in its payload; the outbox row carries `zone_id`; a device's SSE stream (`/api/events`) delivers zone events only for zones in the person's scope, and a kiosk only for its own zone.

### Rendering: each zone's current mix first, zones fair within the organisation

- Each zone has its own current mix (the one playing) and may have drafts. The render priority rule holds per zone: what each zone is about to play is URGENT, the rest of each zone's current mix is MIX, and so on (04-queue-and-scheduling.md section 4A.5).
- Seam, proxy and stem jobs carry `zone_id` (a new nullable column on `jobs`, set by the producer, null for personal and organisation-wide work such as analysis).
- Across organisations nothing changes: the organisation is one fair-share account with the Business weight from ADR-0448 (8 for interactive work of a zone inside opening hours).
- Inside the organisation, the job order becomes: urgency, then `needed_by`, then **zone fairness** (among jobs with equal urgency and no earlier deadline, the zone that was served least recently goes first), then render-line position, then age. So the zone whose next hand-off is soonest always wins, and a busy zone (a Rooms flood on the terrace) cannot starve the bar's next transition.
- The deadline boost allowance (section 4A.4, "3 boosts per 10 minutes") is counted per zone, not per organisation. The interactive concurrency cap for a business workspace is per zone (ADR-0448), so one zone cannot fill every slot.
- A personal workspace's jobs have `zone_id` null and see no change.

## Data model and code touchpoints

| Change | Where | Notes |
|---|---|---|
| `playback_sessions`: new `id` primary key, `zone_id` (nullable), `volume`; unique index on `(workspace_id, coalesce(zone_id, ''))` | `playback/schema.py`, Alembic migration | Existing rows get `zone_id` null; the migration keeps one row per personal workspace |
| `Session` dataclass gains `zone_id` and `volume` | `playback/model.py` | `position_at` and `frozen` unchanged |
| A `SessionKey(workspace_id, zone_id)` replaces the bare `workspace_id` argument in `get_session`, `heartbeat`, `take_over`, `submit_command`, `on_reconnect`, `speaker_online`, `session_view`, `is_reporting_device` | `playback/session.py`, `store.py` (`load_session`, `lock_session`, `_session_query`) | Personal callers pass `SessionKey(workspace_id, None)`; a thin wrapper keeps old signatures for one release |
| One-zone-lease rule | `session.heartbeat`, `session.take_over` | Inside the same transaction: refuse if the device holds a live lease on another session row of the workspace |
| `playback_commands.zone_id`; idempotency unique on `(workspace_id, idempotency_key)` kept | `playback/schema.py` | Keys stay unique per workspace, so a retried key on another zone is a conflict, never a silent replay |
| New commands `hand_back` and `set_volume` | `playback/commands.py` | `set_volume` clamps to ADR-0450's cap |
| Zone routes `/api/zones/{zone_id}/playback/...` | `playback/api.py` (or new `business/zone_api.py`) | Personal `/api/playback/...` unchanged |
| `jobs.zone_id`; in-account order adds zone fairness; per-zone boost allowance | `work/schema.py`, `work/claims.py`, `scheduling/policy.py` | `fair_heads` stays per workspace; the zone order is inside the account |
| Eviction reads every session row | `storage/eviction.py` | See ADR-0442 task 9 |
| `PlayingBar` and `DevicesPanel` show the zone; `usePlaybackDevice` takes an optional `zoneId` | `web/src/devices/` | Personal UI unchanged |

## User outcome and acceptance contract

Every zone plays its own music from its own speaker, never two copies, and any staff phone can steer the zone it is looking at. Each zone's next transition is always ready first, and a busy zone never starves another.

## Edge cases

- **Two kiosks paired to one zone.** One is home, one is standby; only one holds the lease; the standby takes over only after the lease is dead for 20 s and hands back at a song boundary.
- **A zone's kiosk and a staff phone both press Play here within a second.** The session row lock orders them; the second sees a live lease and gets the ADR-0415 "Playing on ... Play here instead?" question.
- **A staff phone holding the lease leaves the venue** (walks out, phone locks). Its lease lapses after 20 s; the home kiosk, still heartbeating as a remote, takes over at its next heartbeat; the phone on reconnect is told "Playback moved to Bar player" and fades out.
- **A remote steers zone A while looking at zone B** (stale UI). Commands name the zone in the path, so they apply only where intended; a command based on an old sequence for that zone is refused with its current state.
- **The same idempotency key reused on two zones** (a client bug). The second is refused as `idempotency_conflict`.
- **Moving a kiosk between zones during service.** As above: confirm, now or at closing, standby or silent-zone alert.
- **Zones sharing one amplifier.** Model them as one zone; the second pairing from the same machine warns.
- **A paused zone** (over the paid count, or archived). Its session refuses heartbeats with `zone_paused`; its kiosk shows Closed (ADR-0453 S5).
- **Staff offboarded while their phone holds a zone lease.** Revocation (ADR-0452, within 30 s) signs out the device; the existing "signing out the active device ends playback gracefully" rule applies, then the home kiosk takes over at its next heartbeat.
- **A person's personal session is playing on the same phone that is asked to be the Bar's emergency speaker.** The phone asks to stop personal music first; one browser plays one session at a time (today's one-tab rule).
- **Many zones in one organisation all need their next transition at once** (every venue opens at 17:00). Deadlines order them; zone fairness splits ties; the per-zone cap stops one zone hogging slots; if a hand-off still cannot be ready, the planner picks a cheaper ready move (section 4A.4), never silence.
- **A Rooms flood on the terrace** fills the organisation's interactive lane with request renders. Requests are REQUEST urgency (1), below the bar's URGENT (0); zone fairness only orders equal urgency, so the bar's next seam still goes first.

## Rejected alternatives

- **One session per venue with zones as outputs.** Different music per zone is the point.
- **Synchronised multi-room playback across devices.** Needs sample-accurate clock sync between browsers; out of scope, and one amplifier feeding two areas covers the common case.
- **Per-zone fair-share accounts in the scheduler.** It would let an organisation multiply its weight by adding zones; ADR-0448 sets the organisation's weight once.
- **Forbidding staff phones as speakers.** A silent zone is the worst failure; the emergency speaker is allowed with a confirm and a venue switch to turn it off.

## Implementation checklist - 0/11 Implemented; 0/11 independently Verified

1. **BZ-0443-01 - Session per zone.** **Acceptance:** `playback_sessions` is keyed by `(workspace_id, zone_id)` with a migration that keeps one null-zone row per personal workspace; every ADR-0415 test passes unchanged for personal workspaces. **Required verification:** Migration test on SQLite and PostgreSQL; `tests/test_cloud_playback_session.py`, `tests/test_cloud_playback_races.py` and `tests/test_cloud_playback_api.py` green. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0443-02 - Session functions take a zone.** **Acceptance:** `heartbeat`, `take_over`, `submit_command`, `on_reconnect`, `session_view` and the speaker checks accept a `SessionKey`; two zones in one workspace run independent leases, sequences and positions. **Required verification:** Unit and integration tests with two zones. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0443-03 - One zone lease per device.** **Acceptance:** A device holding zone A's live lease is refused on zone B, inside the same transaction; concurrent attempts never leave one device leasing two zones. **Required verification:** Concurrency test on PostgreSQL with 20 parallel attempts. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0443-04 - Home and standby kiosks.** **Acceptance:** The standby takes over only after the lease is dead for 20 s; the home kiosk's return triggers `hand_back` at the next song boundary with no overlap and no cut. **Required verification:** Integration test with a fake clock; Playwright two-context test sampling both players every 100 ms. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0443-05 - Staff Play here as emergency speaker.** **Acceptance:** A person with `business.zone.control` can take a zone after a confirm; managers see who is playing it; the phone is offered hand-back when the kiosk returns; `allow_person_speakers` off refuses with `person_speaker_off`; the phone cannot switch to personal while holding the lease. **Required verification:** Integration tests; Playwright test in the cloud harness. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0443-06 - Moving devices between zones.** **Acceptance:** Move now and move at closing work; moving now releases the old lease, fades the kiosk and starts the new zone only if open and unclaimed; the old zone falls to standby or raises the silent-zone alert; a second zone paired from the same machine warns. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0443-07 - Remotes across zones.** **Acceptance:** Zone routes accept commands for in-scope zones only (others 404); the ZoneSwitcher steers the selected zone; stale and cross-zone idempotency conflicts are refused. **Required verification:** Integration tests; Playwright test switching zones on a phone viewport. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0443-08 - Zone volume in the session.** **Acceptance:** `set_volume` changes the zone's volume for every remote, clamped to the ADR-0450 cap; the speaker applies it as gain; personal sessions keep local volume. **Required verification:** Unit tests; vitest for the speaker gain. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0443-09 - Zone events.** **Acceptance:** Outbox events carry `zone_id`; SSE delivers a zone's events only to devices with that zone in scope and to its own kiosk. **Required verification:** Integration test with two people scoped to different venues. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0443-10 - Each zone's current mix renders first, zones fair inside the organisation.** **Acceptance:** Jobs carry `zone_id`; the in-account order is urgency, `needed_by`, zone fairness, render line, age; deadline boosts are counted per zone; a simulated Rooms flood on one zone never delays another zone's URGENT seam past its deadline. **Required verification:** Scenario in the scheduling simulator (`src/selecta/scheduling/simulator.py`, `tests/test_cloud_scheduling_simulator.py`) with three zones and a flood; integration test of the claim order. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0443-11 - Flag `business.zones`.** **Acceptance:** Registered in `src/selecta/flags/cloud.json` (cloud mode, default off, requires `business.orgs`) with the zone routes; `docs/flags.md` regenerated; with it off zone routes answer 404 and the personal device panel reflows unchanged. **Required verification:** `tests/test_flags.py`; Playwright flag-off run. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12, awaiting the owner's decision. Older ADRs keep their statuses; this one only links to them.
