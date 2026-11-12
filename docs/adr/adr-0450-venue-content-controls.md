# ADR-0450 - Venue content controls: explicit filter, blocklists, brand rules, volume limits

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/12 Not started.
- **Independent verification:** 0/12 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; branch `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P0 for the business launch (no venue plays without these rules). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0416 (Rooms), ADR-0425 (venue music identity and schedules), ADR-0431 (moderated requests), ADR-0435 (role security and safe sound), ADR-0442 to ADR-0446 (organisations, zones, hours, kiosks, offline); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/request_planner.py`, `src/selecta/requests.py`, `src/selecta/rooms/planning.py`, `src/selecta/rooms/requesting.py`, `src/selecta/lucy/tools.py`, `src/selecta/lucy/policy.py`, `src/selecta/library/scan.py` (tag reading); new `src/selecta/business/content/`; new `web/src/business/content/`.
- **Proposal chapter:** [docs/saas/19b-business-experience.md](../saas/19b-business-experience.md#19b1-content-controls).

## Context and evidence boundary

A venue plays music to the public, often with children present, under licence conditions and a brand. Today Selecta has per-song set-aside and never-play choices and the planner's own musical judgement, but nothing that says "no explicit lyrics on the terrace before 18:00", "never this artist in any of our venues", or "brunch stays between 90 and 115 BPM". A venue also needs volume caps (neighbours, licence conditions) that staff cannot exceed.

Explicit content cannot be detected reliably from audio. Lyrics lookups (LRCLIB) miss many songs, miss slang and languages, and cannot tell a clean edit from the original. So the explicit flag must come from people and from tags, with analysis offered only as a hint to review.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

### One rule engine, one answer

- A single pure function, `content_policy.allowed(song, zone, at)`, answers "may this song play in this zone at this moment" with `allowed` or `refused` plus the first rule that refused it. Every place that chooses, offers or plays a song calls it (list below). There is no second copy of the rules anywhere.
- Rules are stored per organisation, venue, zone and daypart and compiled into a **policy snapshot** with a version number. Every plan, cached horizon, request decision and play-log row carries the snapshot version it was made under.
- Rules only narrow. An organisation rule applies to every venue; a venue rule adds to it; a zone or daypart rule adds again. A lower level can never re-allow what a higher level refused. The one exception is a manager's **expiring override** (below), which is itself audited and visible.

### Explicit flag

- Each song in the organisation library has `explicit` = `explicit`, `clean` or `unknown`, with its source (`tag`, `manual`, `bulk`, `import`) and who set it.
- **From tags** at upload: MP4 `rtng` (1 explicit, 2 or 4 clean), ID3 `TXXX:ITUNESADVISORY`, Vorbis and FLAC `ITUNESADVISORY` or `EXPLICIT`. Anything else is `unknown`. A tag never overrides a manual choice.
- **Manual**: the song sheet in the business library has a three-way choice. Venue managers and above may set it.
- **Bulk editor**: select many songs (search, filters such as "unknown only", "by artist", "by crate") and set them in one action, with a summary ("Marking 214 songs as clean") and undo. A CSV import matches by ISRC first, then by exact artist and title, and shows matched, ambiguous and unmatched rows before anything is saved.
- **Hint only**: when lyrics are available, songs whose lyrics contain words on a review list are put in a "Worth checking" list. A hint never sets `clean` or `explicit` by itself.
- **Clean versions**: a manager can link an explicit song to its clean edit. Where the explicit one is refused, the planner may use the linked clean edit in its place.
- **Filter modes** per zone and daypart: `Off` (everything), `No explicit` (refuses `explicit`, plays `unknown`), `Clean only` (plays only songs marked `clean`). New zones start on `No explicit`, and the manager view always shows how many songs in the zone's pool are still `unknown`.

### Blocklists

- Entries block a song, an artist (normalised name, with the matched variants listed), an album, or a library tag or genre. Each entry has a scope (organisation, venue or zone), an optional end date, a reason and its author.
- A blocked song never appears in a zone's pool, in guest search, in Lucy's suggestions or as a bridge.

### Allowed crates per zone and daypart

- Each zone's daypart block (ADR-0444) names the venue crates it draws from. A block with no crates uses the zone's default crates; a zone with no default crates uses the venue's whole pool.
- The effective pool is: allowed crates, minus set-aside, never-play and unanalysed songs, minus blocklists, minus the explicit filter, minus songs outside the brand rules.

### Brand rules

- Per zone and daypart: a BPM range and an energy range (the planner's own energy measure), plus spacing: the same song not again within N hours (default 4), the same artist not within M minutes (default 30).
- BPM ranges count half and double time by default ("a 70 BPM song counts as 140"), switchable per rule.
- Transitions and bridges stay inside the ranges. Moving between dayparts uses the existing energy steering over the block's lead-in, never a hard cut.
- When the pool gets too small to keep music going, rules relax in a fixed order, and only these: song spacing, then artist spacing, then the energy range, then the BPM range. **The explicit filter, blocklists and allowed crates never relax.** Each relaxation is shown to the manager ("Terrace is repeating songs sooner than usual: 31 songs fit brunch rules") and written to the activity log.

### Volume caps and quiet hours

- Each zone has a maximum volume (a software gain on the kiosk player, applied after Selecta's loudness levelling so the number means the same thing for every song). Staff set the volume anywhere from silent up to the cap. Only venue managers and above change the cap.
- Quiet hours are time windows with a lower cap. Entering one lowers the volume over 30 seconds; leaving one does not raise it again by itself.
- The kiosk setup guide tells the venue to fix the hardware amplifier level, because Selecta controls only its own output.
- Zone volume is part of the zone session (ADR-0443); this ADR owns its limits.

### Who must respect the rules

| Caller | What it does with the answer |
|---|---|
| Mix and horizon planner (ADR-0444, ADR-0446) | Builds each block only from the effective pool; re-checks the cached horizon whenever the snapshot changes |
| Request planner (`request_planner.py`, ADR-0451) | Refuses a request whose song is refused; every bridge song must be allowed too; re-checks at the moment the request is placed and again when the slot comes up |
| Guest search (ADR-0451) | Shows only songs allowed in that zone now; never says why a song is missing |
| Staff "play next" and steering | Picks only from the effective pool; a refused song is not offered |
| Lucy (venue programming assistant) | Its song tools see only the effective pool for the zone and time in question; proposals are checked again before they apply; Lucy may propose a rule change, which a manager must approve, and can never apply or relax one |
| Kiosk player (ADR-0445) | Holds the snapshot and refuses to start any cached song that the snapshot refuses, even offline |
| Play log (ADR-0449) | Records the snapshot version for every play |

### Changing rules mid-service

- A saved change makes a new snapshot at once. Songs already planned that are now refused leave the horizon; the song playing finishes unless the manager chooses "Take it off now", which moves to the next song through a short, safe transition (within 30 seconds), not a cut.
- Saving a rule that would leave a scheduled block with less than 2 hours of unique allowed music warns with numbers before saving. Saving one that leaves a block with **no** allowed songs is refused, with the block named.

### Expiring overrides

- A venue manager may allow one song or artist in one zone for a set time (up to 24 hours), with a reason, for example for a private event. Overrides cannot lift the explicit filter in a zone set to `Clean only`. They are audited (ADR-0452) and listed on the zone's rules page until they end.

### Feature flags

`business.content_controls` (the engine and the manager pages), `business.content_controls.bulk` (bulk editor and CSV import) and `business.content_controls.lyrics_hint` (the "Worth checking" list), in the business flag area (ADR-0441). With the engine's flag off, business zones refuse to play rather than play unfiltered, and say so to managers.

## User outcome and acceptance contract

A venue manager sets what may play where and when, and can trust that nothing else plays: not from the schedule, not from a guest request, not from Lucy, and not from a kiosk that lost its internet. Staff can turn the music down but never past the cap.

## Edge cases

- Song has conflicting tags (MP4 says clean, a TXXX says explicit): `unknown`, listed in "Worth checking".
- Song re-uploaded with new tags after a manual choice: the manual choice stays.
- An artist name with variants ("Beyonce", "Beyoncé", "Beyoncé feat. X"): blocking the artist shows every matched variant before saving; featured artists are matched by the normalised credit list.
- Half-time BPM detection error puts a song outside the range: the half and double time rule covers most cases; a manager can correct the BPM in the song sheet (existing correction flow).
- Clean edit is itself blocked: the explicit original stays refused; nothing plays in that slot from the pair.
- Rules change while the kiosk is offline: the kiosk keeps its older, stricter-or-equal snapshot until it reconnects. A change that **loosens** rules takes effect only after reconnect; a change that **tightens** rules made while it was offline is applied on reconnect, and cached songs it refuses are dropped before they start.
- A guest request accepted under old rules is refused under new ones: the request is withdrawn and the guest sees "That one doesn't fit the music here right now".
- Quiet hours start in the middle of a staff volume change: the cap wins; the staff slider shows the new cap.
- Overnight quiet hours (23:00 to 07:00) and DST nights: computed in the venue's time zone, as ADR-0444 does for opening hours.
- An override outlives a later blocklist entry for the same artist: the newer, stricter blocklist entry wins and the override is ended with a note.
- An organisation with 200,000 songs and 5,000 blocklist entries: snapshot compile stays under 2 seconds and lookups are O(1) per song.

## Rejected alternatives

- Detecting explicit content from audio or lyrics automatically (unreliable; a false "clean" is the worst error a venue can suffer).
- Letting zone rules override organisation rules (a franchise HQ must be able to rely on its rules).
- Relaxing the explicit filter or blocklists to avoid silence (silence is bad, but the wrong song in front of children or a brand is worse; the manager is alerted instead).
- Hardware volume control (outside a browser's reach; documented in the setup guide instead).

## Implementation checklist - 0/12 Implemented; 0/12 independently Verified

1. **BZ-0450-01 - Policy engine and snapshots.** **Acceptance:** `content_policy.allowed(song, zone, at)` returns allowed or refused with the first refusing rule for every rule kind; snapshots are versioned, compiled per zone, and only narrow from organisation to venue to zone to daypart. **Required verification:** Unit and Hypothesis property tests (narrowing only, determinism, refusal reason always named). **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0450-02 - Explicit flag from tags.** **Acceptance:** MP4 `rtng`, ID3 `TXXX:ITUNESADVISORY`, Vorbis and FLAC advisory fields set `explicit` or `clean` at upload; conflicting or missing tags give `unknown`; a tag never overwrites a manual choice. **Required verification:** Unit tests with generated files for each container. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0450-03 - Manual flag and clean-version links.** **Acceptance:** Managers set explicit, clean or unknown on a song and link a clean edit; staff and viewers cannot; each change is audited; the planner swaps in a linked clean edit where the original is refused. **Required verification:** API tests per role; planner integration test. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0450-04 - Bulk editor and CSV import.** **Acceptance:** Select by search and filters, set many songs at once with a count and undo; CSV import matches ISRC then artist and title and shows matched, ambiguous and unmatched rows before saving. **Required verification:** Vitest for the editor; pytest for matching; Playwright for select, apply and undo. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0450-05 - Lyrics hint list.** **Acceptance:** Songs whose available lyrics contain review-list words appear in "Worth checking"; a hint never changes the flag. **Required verification:** Unit tests including a song with no lyrics and a non-English song. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0450-06 - Blocklists.** **Acceptance:** Song, artist (with variant preview), album and tag entries at organisation, venue and zone scope, with optional end date and reason; blocked songs never reach pools, guest search, Lucy or bridges. **Required verification:** Integration tests across every caller. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0450-07 - Allowed crates per zone and daypart.** **Acceptance:** The effective pool equals allowed crates minus set-aside, never-play, unanalysed, blocked, explicit-filtered and out-of-range songs, with the fallback to zone defaults and the venue pool. **Required verification:** Property tests over generated libraries and schedules. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0450-08 - Brand rules and the relaxation order.** **Acceptance:** BPM (with half and double time) and energy ranges and song and artist spacing hold; when the pool is too small only spacing, then energy, then BPM relax, each relaxation shown to the manager and logged; explicit, blocklist and crate rules never relax. **Required verification:** Planner tests with shrinking pools; a test that a relaxation never admits a refused song. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0450-09 - Volume caps and quiet hours.** **Acceptance:** Staff volume is clamped to the zone cap; quiet hours lower the cap over 30 seconds in the venue's time zone (overnight and DST nights included); only managers change caps. **Required verification:** Unit tests for the clamp and ramp; Playwright on the staff view; a kiosk test measuring output gain. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0450-10 - Every caller respects the rules.** **Acceptance:** Mix planner, request planner and bridges, guest search, staff play-next and steering, Lucy tools and proposals, and the kiosk's offline start check all call the one engine; a static test fails if a song-choosing path skips it. **Required verification:** One integration test per caller with a refused song planted; Lucy injection test asking for a blocked song; the static path test. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0450-11 - Mid-service changes and overrides.** **Acceptance:** A new snapshot drops refused songs from the horizon, finishes or safely moves off the current song, refuses saves that empty a block and warns under 2 hours; expiring overrides respect `Clean only`, end on time and are audited. **Required verification:** Integration tests; offline kiosk test for tighten and loosen order. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0450-12 - Flags and refusal when off.** **Acceptance:** `business.content_controls`, `.bulk` and `.lyrics_hint` exist in the registry with `docs/flags.md` regenerated; with the engine off, business zones refuse to play and managers see why; pages reflow. **Required verification:** `tests/test_flags.py`; flag sweep in the business browser tests. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
