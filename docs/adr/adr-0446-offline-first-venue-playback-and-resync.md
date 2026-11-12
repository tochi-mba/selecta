# ADR-0446 - Offline-first venue playback and resync

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/13 Not started.
- **Independent verification:** 0/13 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off); the real-network tasks run with pilot venues in Phase B1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0415 (offline speaker rules), ADR-0397 and ADR-0399 (storage layout, playback proxies), ADR-0394 and ADR-0395 (jobs and scheduling), ADR-0426 (rolling musical horizon), ADR-0427 (conservative transitions and failover) and ADR-0429 (six-hour venue audio continuity) of the Autopilot programme; their statuses are unchanged. Sibling Business ADRs: ADR-0441 to ADR-0445, ADR-0447 to ADR-0454.
- **Source touchpoints:** `web/src/devices/audioSpeaker.ts` (local copies of the current and next two songs); `web/src/devices/usePlaybackDevice.ts`; `src/selecta/playback/session.py` (`on_reconnect`); `src/selecta/work/proxies.py` (`prepare`, `needed_by`); `src/selecta/storage/eviction.py`; `src/selecta/routes/cloud_proxy.py` and the derived playback URL route; new `web/src/kiosk/cache.ts`, `kiosk/offline.ts`, `kiosk/clock.ts`, `web/src/kiosk/sw.ts`; new `src/selecta/business/horizon.py`, `business/permits.py`, `business/resync.py`.
- **Proposal chapter:** [docs/saas/19a-venue-operations.md](../saas/19a-venue-operations.md#19a5-offline-first-playback).

## Context and evidence boundary

Venue internet drops. Routers are rebooted at the start of a shift, a card terminal hogs the line, a storm takes the line out for an afternoon. The rule is simple: the music never stops because the internet dropped.

Today a cloud speaker keeps the current song and the next two as local blob copies (`audioSpeaker.ts`), which covers minutes, not hours. Playback files are lossless FLAC fetched with presigned URLs valid for at most 15 minutes (05-storage-uploads-playback.md sections 5.1 and 5.8), about 375 MB per hour of listening. The player refreshes a URL once on a 403. Proxies are made lazily by `work/proxies.prepare` with the urgency and `needed_by` of the work that needs them. On reconnect, `session.on_reconnect` carries on if nobody took over and fades out if someone did. Seam rendering is server work; a kiosk cannot render a new transition.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; the sizes and durations below are estimates to be measured in the pilot.

## Decision

### The horizon: four hours ready ahead

- During warming and open states (ADR-0444), each zone keeps a **horizon** of planned mix ahead of the playing position: target **4 hours** of songs with their transitions **rendered and downloaded to the kiosk**, never less than 1 hour while open.
- The horizon has the three parts ADR-0426 names: **committed** (the playing song and the next two transitions; never replanned, see ADR-0444), **prepared** (rendered and cached, may be replanned), and **planned** (chosen but not yet rendered or downloaded).
- Render jobs for the horizon carry `zone_id` (ADR-0443) and `needed_by` = the moment the transition will be heard. The next two transitions are URGENT (interactive); the rest of the first hour is MIX (standard); hours two to four are standard with later deadlines, so a busy organisation fills the near horizon first and the far horizon in spare capacity, within ADR-0448's render-ahead budget. Proxies are prepared through `work/proxies.prepare(need="mix", for_job=...)`, so they inherit the seam's lane and urgency.
- At the end of a day the horizon past closing is not rendered. During warming, the first hour is rendered first so the zone can open even if the rest is late.
- The horizon spans block boundaries and stay-open-late extensions are added to it at once.

### The kiosk cache

- The kiosk stores horizon files in the Cache Storage API (or the Origin Private File System where faster), keyed by **artifact key plus checksum**, never by URL. Each file's SHA-256 is checked after download; a mismatch is discarded and fetched again.
- The kiosk asks for **persistent storage** (`navigator.storage.persist()`) at pairing and reports whether it was granted; without it the browser may evict the cache under pressure, and the health report says so.
- **Storage cap.** The kiosk measures `navigator.storage.estimate()` and uses at most the smaller of **4 GB** and **50% of the reported quota**, leaving room for the browser. At about 375 MB per hour plus seam clips, 4 hours is about 1.6 GB, so a device with 4 GB free holds the full horizon with margin. A device that cannot hold the target holds what fits and reports it ("This player can hold 1 h 40 min of music offline"); a device that cannot hold 1 hour is reported as unsuitable in the manager view.
- **Eviction order**: already-played files first, oldest played first; then planned files furthest in the future; never the committed window. The fallback reel (below) keeps its own small reserve.
- When the v2 segment files arrive (05 section 5.8, only the slices a mix plays), the same cap holds 40% to 60% more hours.

### Downloading with signed URLs

- The kiosk fetches with short-lived presigned URLs asked for just before each download, as today. A 403 (expired URL) triggers one refresh and a retry with an HTTP `Range` from the bytes already saved, so a long download survives URL expiry.
- **Offline, no URL is ever needed**: playback reads only the cache. A URL that expired while the kiosk was offline is simply discarded; the next download after reconnect asks for a fresh one.
- Downloads are paced (at most 2 at a time, lower while a card terminal is busy is not knowable, so a manager can set a bandwidth cap per venue) and pause while the device is offline.

### The offline bundle and permit

- With the horizon, the kiosk keeps a signed **offline bundle**, refreshed on every heartbeat that has something new:
  - the venue's opening instants for the next 7 days and the hours rules (ADR-0444), with the IANA zone, so it can also compute later days;
  - the zone's programme version (ADR-0444) and the content policy snapshot (ADR-0450), so it refuses any cached song the snapshot refuses, even offline;
  - volume cap and quiet hours (ADR-0450);
  - an **offline permit**: organisation, venue, zone, device, plan state (paid, pilot, grace), the licence attestation's expiry (ADR-0449), the stop instant if a payment grace or a pilot end has set one (ADR-0447, ADR-0452), an issue time and a `valid_until`.
- The bundle is signed with an Ed25519 key whose public half ships in the kiosk app; the kiosk refuses a bundle that fails the signature or is older than the one it holds.
- **Grace while offline.** `valid_until` is 7 days after issue. While the permit is valid the kiosk plays by its rules as if online. When it runs out while still offline, the kiosk keeps playing until the end of the current open period and then stops at close, showing Closed; it starts again as soon as it reconnects and gets a new permit. Licence expiry and billing stops are evaluated by the kiosk from the permit with the same rules the server uses, so being offline never extends or shortens them.
- The 7 days is a proposal for the owner (open question below).

### Playing offline, and when the horizon runs out

- Offline, the kiosk plays the horizon exactly as planned: songs, rendered transitions, schedule boundaries already planned in, closing fade at the close it computes.
- **Past the horizon** (offline more than about 4 hours during service), it switches to the **fallback reel**: it replays cached songs that the current block's snapshot allows, never the same song within the spacing rule where the cache allows it, joined by the player's own equal-power crossfade at phrase-length (no rendered seam, so the conservative move ADR-0427 prefers), aiming at the block's energy from the cached analysis summaries. It records each fallback hand-off in the play log as `offline_fallback`. This is quieter musically than a planned mix, and still never silence.
- Only if nothing allowed is cached (every cached song refused by a tightened snapshot) does the kiosk stop, showing "The music will be back shortly" (ADR-0453 S5).

### Commands while the kiosk is offline

- **Transport commands** (play, pause, skip, seek) are only meaningful live. A remote sending one to a zone whose speaker is unreachable is refused at once with `speaker_offline`: "The Bar player is offline. It's still playing saved music. Use the player's own screen, or try again when it's back." Nothing is queued on the server, so a skip never fires an hour later.
- **State changes** (steering energy, volume, schedule and hours edits, stay open late, content rules, request approvals) are server state. They apply on the server at once and reach the kiosk on reconnect with the next bundle, in order, each tagged with its server time. A volume change made while offline is applied on reconnect only if it is less than 10 minutes old; older volume changes are kept as the zone's setting but the kiosk ramps to them over 30 seconds rather than jumping.
- **Staff devices that are themselves offline** queue their commands locally for at most 2 minutes and drop older ones with a plain message (ADR-0453 D10).
- **Commands at the kiosk itself** (the hidden staff panel's Reload, or a future local control) are recorded in the kiosk's local log and uploaded on reconnect as facts that already happened, not as commands to be checked.

### Resync

- On reconnect the kiosk calls `POST /api/kiosk/resync` with: its device log since the last acknowledged sequence (songs played with start times, fallback hand-offs, pauses, restarts, local actions; each entry with a device sequence number and an idempotency key), its position now, the bundle and permit versions it holds, and which cached files it has.
- The server applies the log idempotently (by device and device sequence), so retries never duplicate play logs (ADR-0449 export) or listening events, and only then answers.
- **Who wins:**
  - **What played** is a fact: the device wins. The server's session anchor is moved to the device's position; play logs and SLO minutes come from the device log.
  - **Rules and schedules** are the server's: the server wins. A tightened content snapshot is sent first, and the kiosk refuses any cached song it now refuses before its next song (ADR-0450).
  - **Who is the speaker** follows ADR-0415's reconnect rule: if nobody took the zone, the kiosk carries on and renews its lease; if a standby or a staff phone took over meanwhile (ADR-0443), the kiosk's log is still accepted and it fades out at the next song boundary, told who is playing; the home-kiosk hand-back rule then applies.
  - **The plan**: the server replans the horizon from the device's actual position (keeping the device's committed window if the files are still valid), and the kiosk discards cached files the new plan no longer needs, oldest first.
- A device whose token was revoked while offline gets nothing on reconnect, uploads nothing, wipes its cache and shows the pairing screen.
- A song deleted while the kiosk was offline (ADR-0442) is evicted on resync; if it played meanwhile, the log says so.

### Clocks

- Online, the kiosk keeps a **server time offset** from `server_time` in each answer (as `usePlaybackDevice.ts` does for remotes), smoothed over the last 10 samples, and tracks elapsed time with the monotonic `performance.now()`. Schedule decisions use `trusted_now = last_server_time + monotonic_elapsed`, never the device wall clock, so a kiosk whose clock is six hours wrong still opens and closes on time.
- The kiosk reports drift (wall clock against trusted time) in health; over 2 minutes is shown to the manager as a device fault, with no effect on playback.
- **After a reboot with no server contact**, monotonic time restarts and trusted time is lost. The kiosk then uses the device wall clock only if it is plausible: after the bundle's issue time and before the permit's `valid_until`. Otherwise time is **untrusted**: it does not auto-start and shows Tap to start with "Time unknown" (ADR-0445); a tap plays the current block of the day the device believes it is, at the zone's quiet-hours volume, until time is trusted again.
- The server never trusts device clocks for anything it records: log entries are re-timed from the device's trusted offset where known and marked `approximate_time` where not.

### Security of the cache

- The cache holds the organisation's music for the horizon only (about 4 hours), never the library. It is not encrypted at rest beyond the browser's own protection: a key on the same device would not stop someone who has the device. The guide and the business terms (ADR-0449) say a stolen player exposes up to its cached hours, and unpairing (ADR-0445) stops it from getting more and ends its permit on reconnect.

## Data model and code touchpoints

| Change | Where | Notes |
|---|---|---|
| `business/horizon.py` | new | Plans and keeps each open zone's 4-hour horizon; creates seam and proxy work with `zone_id` and `needed_by`; uses `work/proxies.prepare` |
| New `zone_horizons` (zone, revision, committed_until, prepared_until, planned_until, updated_at) | new `business/schema.py` | Read by eviction (ADR-0442 task 9) |
| New `kiosk_cache_reports` (device, artifact keys held, bytes, quota, persisted) | same | Latest only; feeds eviction protection and the manager view |
| `business/permits.py` | new | Builds and signs the offline bundle and permit (Ed25519); key held by the API, rotated with overlap |
| `business/resync.py` and `POST /api/kiosk/resync` | new | Idempotent device-log apply; replan from device position |
| New `device_log_entries` (device, device_seq unique per device, kind, payload, device_time, server_time, approximate_time) | same | Source for ADR-0449 play logs and ADR-0448 SLO minutes |
| `speaker_offline` refusal for transport commands | `playback/session.py` `submit_command` | Zone sessions only; personal sessions keep `no_speaker` behaviour |
| Kiosk cache, offline engine, clock and service worker | new `web/src/kiosk/cache.ts`, `offline.ts`, `clock.ts`, `sw.ts`; `audioSpeaker.ts` gains a cache source | The fallback reel's crossfade lives in the kiosk player |

## User outcome and acceptance contract

When the venue internet drops, nobody in the room notices. The music plays from saved hours, the schedule still changes on time, and when the line comes back everything catches up without a jolt and without counting anything twice.

## Edge cases

- **Internet drops for two hours during service.** The horizon covers it; schedule boundaries already planned play out; on reconnect the log uploads once and the horizon is topped up.
- **Offline for six hours.** Four hours of horizon, then the fallback reel, then reconnect.
- **The device cannot hold four hours.** It holds what fits, says so, and the fallback reel covers the rest.
- **A signed URL expires mid-download.** Refresh and resume with `Range`. Expired while offline: discarded, never used.
- **A staff phone presses skip while the kiosk is offline.** Refused at once with `speaker_offline` and plain words; nothing fires later.
- **A manager tightens the explicit filter while the kiosk is offline.** Applied on the server at once; on reconnect the kiosk refuses newly refused cached songs before the next song.
- **A standby took over while the home kiosk was offline.** On reconnect the home kiosk's log is accepted; it fades out at the next song boundary and the hand-back rule applies.
- **The kiosk's clock is six hours wrong.** Trusted time is used; the drift is shown as a device fault.
- **Power cut and router down together; the kiosk boots with no network.** Plausible wall clock: plays the cached horizon from the scheduled point. Implausible: waits for a tap.
- **Offline past the permit's 7 days.** Plays to the end of the current open period, then stops at close; restarts on reconnect.
- **A pilot or payment grace stop instant passes while offline.** The kiosk stops at that close from its permit (ADR-0447: "the kiosk stops at its own known close time from its cached schedule").
- **Licence attestation expires while offline.** The kiosk applies ADR-0449's rule from the permit, exactly as the server would.
- **Duplicate resync after a lost answer.** Idempotent by device sequence; logs never double.
- **The device was unpaired while offline.** Reconnect wipes the cache and shows pairing.
- **A song deleted while the kiosk was offline.** Evicted on resync; logged if it played.
- **The browser evicts the cache under storage pressure.** Without persistent storage this can happen; the kiosk notices missing files, refetches when online and reports it; offline, it falls back to what remains.

## Rejected alternatives

- **Rendering transitions on the kiosk.** Seam rendering needs the full engine and minutes of CPU per seam; a kiosk-side simple crossfade is the fallback instead.
- **Queueing transport commands on the server.** A skip applied an hour late is worse than a refused skip.
- **Streaming instead of caching.** Fails exactly when the internet does.
- **Encrypting the cache with a device key.** Gives no protection against someone holding the device and complicates recovery; honest limits are stated instead.
- **No offline grace for plan and licence checks.** Would silence venues during outages, which is the failure the product exists to avoid.

## Implementation checklist - 0/13 Implemented; 0/13 independently Verified

1. **BZ-0446-01 - Horizon planner.** **Acceptance:** Each open or warming zone keeps a 4-hour horizon with committed, prepared and planned parts; render work carries `zone_id` and `needed_by`; the next two transitions are URGENT, the rest of the first hour MIX, hours two to four standard; nothing past closing is rendered. **Required verification:** Integration tests with a made-up library and a fake clock; simulator scenario with 20 zones opening at once. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0446-02 - Kiosk cache.** **Acceptance:** Files are stored by artifact key and checksum, verified after download, persistent storage is requested and reported, and the 4-hour horizon is saved ahead during opening hours. **Required verification:** vitest for `cache.ts`; Playwright test including `test_four_hours_of_music_are_saved_ahead_during_opening` (time compressed). **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0446-03 - Storage cap and eviction.** **Acceptance:** The cap is the smaller of 4 GB and 50% of quota; played files go first, oldest first, then the furthest planned; the committed window is never evicted; a device that holds less reports its hours. **Required verification:** vitest with a mocked `storage.estimate`; Playwright `test_device_storage_cap_evicts_oldest_played_first`. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0446-04 - Signed URL expiry.** **Acceptance:** A 403 mid-download refreshes the URL once and resumes with `Range`; offline playback never needs a URL. **Required verification:** vitest with a mocked fetch; integration test against the derived playback URL route. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0446-05 - Offline bundle and permit.** **Acceptance:** The bundle carries 7 days of opening instants, programme, content snapshot, volume rules and the permit; it is signed with Ed25519 and a bad or older bundle is refused; keys rotate with overlap. **Required verification:** Unit tests for `permits.py`; vitest for verification in the kiosk. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0446-06 - Offline grace.** **Acceptance:** With a valid permit the kiosk plays by its rules offline; past `valid_until` it plays to the end of the open period and stops at close; billing, pilot and licence stops from the permit match the server's decisions. **Required verification:** Shared test vectors run against the server rules and the kiosk code. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0446-07 - Offline playback and fallback reel.** **Acceptance:** Offline the horizon plays as planned including block boundaries and the closing fade; past it the fallback reel plays allowed cached songs with crossfades, logged as `offline_fallback`; only when nothing allowed is cached does it stop with "The music will be back shortly". **Required verification:** Playwright tests with the network cut and a fake clock, including `test_internet_drop_for_two_hours_keeps_playing` and `test_offline_beyond_saved_music_shows_back_shortly`. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0446-08 - Commands while offline.** **Acceptance:** Transport commands to an unreachable zone speaker are refused with `speaker_offline` and plain words; state changes apply on the server and reach the kiosk in order on reconnect; stale volume changes ramp; staff devices drop queued commands older than 2 minutes. **Required verification:** Integration tests; Playwright `test_queued_commands_older_than_two_minutes_are_dropped`. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0446-09 - Resync.** **Acceptance:** The device log applies idempotently; the device wins on what played, the server on rules and schedules; the lease follows ADR-0415's reconnect rule; the horizon replans from the device's position; a revoked device wipes its cache. **Required verification:** Integration tests for each conflict, including `test_reconnect_after_lease_taken_fades_out` and `test_offline_play_logs_upload_once_on_reconnect`. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0446-10 - Clocks.** **Acceptance:** Schedule decisions use trusted time from the server offset and monotonic elapsed time; drift over 2 minutes is a reported fault; after a reboot without contact a plausible wall clock is used and an implausible one waits for a tap. **Required verification:** vitest for `clock.ts`; Playwright `test_kiosk_clock_six_hours_wrong_uses_server_time`. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0446-11 - Eviction protects cached horizons.** **Acceptance:** Server-side eviction never removes an artifact a zone's horizon or a kiosk's cache report names. **Required verification:** Unit tests in `tests/test_cloud_storage_eviction.py`. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0446-12 - Real venue network chaos.** **Acceptance:** At a pilot venue or a bench with the real kiosk hardware: the router is switched off for 2 hours during service and for 6 hours on a closed day spanning opening, the device is power-cycled while offline, and the music never stops and resyncs cleanly, each recorded with times and logs. **Required verification:** Needs a person: run the chaos checks on real hardware and a real network and record the results. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0446-13 - Flag `business.offline`.** **Acceptance:** Registered in `src/selecta/flags/cloud.json` (cloud mode, default off, requires `business.kiosk`); `docs/flags.md` regenerated; with it off the kiosk keeps only today's three-song copies and the manager view hides offline hours with layouts reflowing. **Required verification:** `tests/test_flags.py`; Playwright flag-off run. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12, awaiting the owner's decision. Older ADRs keep their statuses; this one only links to them.
