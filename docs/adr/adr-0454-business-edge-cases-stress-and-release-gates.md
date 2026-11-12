# ADR-0454 - Business edge cases, stress and release-gate testing

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/15 Not started.
- **Independent verification:** 0/15 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; branch `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P0; gates both release moments (ready for pilots, ready to sell). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0411 (stress, chaos and release gates), ADR-0437 (performance and long-session evidence), ADR-0440 (phased rollout and GO NO-GO), ADR-0441 to ADR-0453; their statuses are unchanged.
- **Source touchpoints:** `tests/` (new `tests/test_business_*.py`), `tests/sim/`, `tests/load/` (new `tests/load/business_*.py`, `tests/load/k6/business_*.js`), `tests/e2e_cloud_server.py`, `infra/staging/run.py`, `src/selecta/audit/invariants.py`, `src/selecta/audit/invariant_proofs.py`; new `web/e2e-business/`.
- **Proposal chapter:** [docs/saas/19b-business-experience.md](../saas/19b-business-experience.md#19b5-testing-and-release-gates).

## Context and evidence boundary

Business is the first SelectaDJ product where a failure is public: a silent bar on a Friday night, an explicit song in a family restaurant, music stopping because a card expired. The Cloud programme's ladder, invariants and catastrophe suite (docs/saas/15-stress-testing.md, ADR-0411) cover accounts and jobs; they do not cover opening hours, time zones, unattended kiosks, zones, staff roles or billing that must never silence a venue mid-service.

The owner will build the plan fully but not sell it yet: a few friendly pilot venues come first. So the gates separate **ready for pilots** (all code and tests pass) from **ready to sell** (legal sign-off and validated pricing).

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

### Business invariants (checked after every business test and scenario)

Added to `selecta.audit.invariants` as B1 to B9, next to the ten Cloud invariants:

1. **B1 No platform-caused silence.** No zone inside opening hours is silent for more than 60 s while a playable cached horizon exists on its kiosk.
2. **B2 No refused song plays.** Every play-log row's song was allowed by the content snapshot it names (ADR-0450).
3. **B3 One speaker per zone.** No two devices hold or act on one zone's lease at once.
4. **B4 No manager state on customer screens.** Kiosk, guest and display payloads contain only allowlisted fields.
5. **B5 No cross-organisation or out-of-scope access** succeeds, for people, kiosks or tablets.
6. **B6 Billing and pilots never stop music mid-service.** Playback stops for billing or a pilot end only at a venue's closing time after the grace or end date, and only after the 72 h and 24 h warnings were sent.
7. **B7 Play log exactly once.** Every played song appears once in the play log, including songs played offline and uploaded later.
8. **B8 Offboarding is complete.** A removed person has no working session, device or PIN 30 s after removal.
9. **B9 Volume never exceeds the cap** reported by the kiosk at any time, including quiet-hours transitions.

### Edge cases as named tests

Each line is one test (Python under `tests/test_business_<area>.py`, browser under `web/e2e-business/<area>.business.ts`). Names are fixed now so the checklist can track them.

**Hours and time** (`test_business_hours.py`): `test_overnight_hours_close_after_midnight_belong_to_the_opening_day` · `test_spring_forward_inside_opening_hours_keeps_the_right_close` · `test_fall_back_repeated_hour_does_not_close_twice` · `test_holiday_closure_overrides_the_weekly_hours` · `test_stay_open_late_extends_only_tonight` · `test_stay_open_late_beyond_the_staff_allowance_is_refused` · `test_venue_time_zone_differs_from_head_office` · `test_hours_edit_during_service_takes_effect_at_the_next_boundary` · `test_open_24_hours_has_no_close_and_no_stop` · `test_kiosk_clock_six_hours_wrong_uses_server_time`.

**Zones and sessions** (`test_business_zones.py`): `test_two_kiosks_paired_to_one_zone_one_holds_the_lease` · `test_remote_controls_only_zones_in_scope` · `test_play_here_as_emergency_speaker_takes_the_zone_lease` · `test_removed_zone_stops_at_its_next_close` · `test_downgrade_pauses_zones_over_the_paid_count_owner_picks` · `test_zone_volume_is_session_state_shared_by_remotes`.

**Kiosk and offline** (`test_business_kiosk.py`, `kiosk.business.ts`): `test_power_cut_restart_resumes_without_a_tap_when_flags_allow` · `test_autoplay_blocked_shows_tap_to_start` · `test_four_hours_of_music_are_saved_ahead_during_opening` · `test_device_storage_cap_evicts_oldest_played_first` · `test_internet_drop_for_two_hours_keeps_playing` · `test_offline_beyond_saved_music_shows_back_shortly` · `test_queued_commands_older_than_two_minutes_are_dropped` · `test_reconnect_after_lease_taken_fades_out` · `test_offline_play_logs_upload_once_on_reconnect` · `test_auto_update_waits_for_closed_hours` · `test_kiosk_token_copied_to_second_machine_is_refused`.

**Content controls** (`test_business_content.py`): `test_conflicting_advisory_tags_give_unknown` · `test_manual_flag_survives_reupload` · `test_clean_only_refuses_unknown` · `test_blocked_artist_variants_are_all_refused` · `test_lower_scope_cannot_reallow_a_higher_block` · `test_relaxation_never_admits_a_refused_song` · `test_save_that_empties_a_block_is_refused` · `test_tighten_while_kiosk_offline_applies_before_next_song_on_reconnect` · `test_override_cannot_lift_clean_only` · `test_lucy_cannot_suggest_or_apply_a_blocked_song` · `test_bridge_songs_obey_the_rules` · `test_quiet_hours_ramp_down_over_thirty_seconds`.

**Rooms for Business** (`test_business_rooms.py`, `rooms.business.ts`): `test_standing_room_opens_and_closes_with_hours` · `test_card_scanned_after_close_shows_opening_time` · `test_unapproved_request_expires_after_twenty_minutes` · `test_no_staff_seen_pauses_requests` · `test_venue_network_crowd_of_500_joins` · `test_code_guessing_never_locks_out_the_venue_network` · `test_flood_switches_zone_to_staff_approval` · `test_request_refused_by_new_rules_is_withdrawn_politely` · `test_guest_payload_has_no_staff_or_billing_fields` · `test_rotated_code_keeps_guests_in_the_room`.

**Roles, SSO and offboarding** (`test_business_roles.py`): `test_each_role_holds_exactly_its_permissions` · `test_out_of_scope_venue_is_404` · `test_staff_destructive_routes_are_all_refused` · `test_manager_cannot_self_promote` · `test_removed_member_loses_access_within_thirty_seconds` · `test_kiosk_survives_its_pairing_person_leaving` · `test_scim_deactivation_offboards` · `test_sso_user_without_mapped_group_gets_no_role` · `test_last_owner_cannot_leave` · `test_personal_workspace_untouched_by_leaving` · `test_wrong_pin_five_times_locks_that_pin`.

**Billing, grace and pilots** (`test_business_grace.py`): `test_grace_ends_mid_service_music_continues_to_close` · `test_grace_ends_after_close_music_does_not_start_next_opening` · `test_payment_one_minute_before_close_cancels_the_stop` · `test_webhook_arrives_during_the_closing_fade` · `test_warnings_at_72_and_24_hours_sent_once_each` · `test_grace_end_on_a_dst_night` · `test_stay_open_late_disabled_after_grace_end` · `test_pilot_end_follows_the_same_stop_at_close_rule` · `test_pilot_converted_on_last_day_never_goes_read_only` · `test_signups_flag_off_refuses_public_organisation_creation`.

**Licensing** (`test_business_licence.py`): `test_unattested_venue_cannot_auto_start` · `test_licence_reminders_at_30_14_and_3_days` · `test_expired_licence_never_stops_mid_service_and_blocks_the_opening_after_its_grace` · `test_play_log_export_has_licensing_columns` · `test_play_log_export_of_a_month_streams_in_bounded_memory`.

**UI** (`web/e2e-business/*.business.ts`): `every surface renders each state in its matrix` · `customer bundles never contain manager copy` · `staff view has no destructive control` · `silent zone alert appears within 70 seconds and clears` · `workspace band on every business page` · `400 percent zoom reflows every surface` · `reduced motion stops every animation on the kiosk` · `500 venues grid sorts and searches under 100 ms`.

### Stress scenarios

Each scenario has a local scaled-down run (in CI, against `tests/e2e_cloud_server.py` with simulated kiosks) and a full-size staging run (`python infra/staging/run.py <name>`). Simulated kiosks are lightweight clients that heartbeat, hold leases, download horizon manifests (not audio) and report plays.

**ST1 Opening-hour peak: 500 venues, 3 zones each** (`business_peak`)
- 1,500 zones; 70% of venues share a time zone and open between 16:55 and 17:05; 20% open at 10:00; the rest spread.
- Each opening auto-starts a zone, renders and saves 4 hours ahead, heartbeats every 5 s (300 heartbeats a second at peak) and accepts guest requests (50 guests per zone at peak).
- **Pass:** every zone audible within 60 s of its opening time (p99), B1 to B9 hold, heartbeat p95 under 300 ms, 4-hour horizon complete for 99% of zones within 30 minutes of opening, interactive Business lane gets its weight-8 share while Premium accounts stay within ADR-0411 fairness bounds, zero duplicate renders.

**ST2 1,000 kiosks reconnect after an outage** (`business_reconnect`)
- 1,000 kiosks across 400 venues lose the API for 30 minutes (our outage, then a regional ISP outage variant), keep playing from saved music, then all come back within the same 10 seconds.
- **Pass:** zero audio gaps on any kiosk with saved music (B1); reconnect admission paced so the API stays under its connection budget and routine p95 under 300 ms; every kiosk reconnected within 2 minutes; exactly one speaker per zone (B3); queued staff commands older than 2 minutes dropped, newer ones applied once in order; offline play logs uploaded with zero duplicates (B7); rule snapshots refreshed before the next song.

**ST3 One schedule edit across 200 venues** (`business_bulk_schedule`)
- An HQ admin applies a new evening daypart to 200 venues; 60 of them are open and mid-block; 20 kiosks are offline; a second admin edits 5 of the same venues at the same time.
- **Pass:** the apply completes within 60 s; each venue changes atomically or is reported as failed with a reason and can be retried idempotently; online kiosks get the new schedule within 30 s; offline kiosks get it on reconnect; open venues switch at the next block boundary, never mid-song; the concurrent edit is refused with a version conflict for the 5 venues and applied for the rest; one parent audit event and 200 child events.

**ST4 Billing grace expiring at closing time** (`business_grace_close`)
- 300 organisations with failed payments; grace ends at assorted times: before opening, mid-service, exactly at close, one minute after close, on an overnight close at 02:00, on a DST night, in venues whose time zone differs from the organisation's billing country. Some pay in the last minute; some Stripe webhooks arrive late or twice.
- **Pass:** B6 holds for every venue: music continues to the venue's own close and stops with a fade, never mid-song; no venue restarts at its next opening after the stop; payment before the stop cancels it, and payment after it restores the next opening; warnings at 72 h and 24 h sent exactly once each; kiosk screens show only Closed; manager devices show the right state at each step.

**Further scenarios** (same treatment): **ST5** lunch request flood (500 zones, 50 guests each, all requesting within 5 minutes); **ST6** SSO identity-provider outage at shift change (staff tablets keep working, break-glass works); **ST7** Directory Sync offboards 2,000 people at once (B8 within 30 s for all); **ST8** play-log export of 500 venues for a month (about 8 million rows) streams in bounded memory; **ST9** rule change for a whole organisation during peak (snapshots reach every kiosk before its next song); **ST10** 72-hour soak: 50 simulated venues through three opening and closing cycles with network flaps every 30 s on 10% of kiosks.

### Real-device soak

Three real kiosk types (a mini PC on Windows or Linux with Chrome in kiosk mode, an Android TV box, an Android tablet) run for 72 hours in a test venue setup with a scheduled power cut each day and the router unplugged for 2 hours once. Measured: unplanned silence (target zero seconds), memory over time, recovery after power cut without a tap where the kiosk flags allow it, wake lock held, auto-update during closed hours only.

### Release gates

**Gate P: ready for pilots.** All of these, recorded with evidence, before the first friendly venue plays:

| Gate | Evidence |
|---|---|
| P1 All BZ code tasks for ADR-0442 to ADR-0453 that pilots need are Implemented | Business checklist |
| P2 Every named edge-case test above passes on SQLite and PostgreSQL in CI | CI run id |
| P3 Business invariants B1 to B9 hold after every business test | `assert_clean` in fixtures |
| P4 ST1 to ST4 pass locally scaled down and at full size on staging | Staging reports |
| P5 Real-device soak passes on all three kiosk types | Soak report with measured silence |
| P6 Accessibility: zero serious axe findings; keyboard sweeps; NVDA session on S2, S4 and S6 | Reports; NVDA speech log |
| P7 Security: cross-organisation sweep, kiosk token copy, stolen tablet, offboarding drill | Security test run |
| P8 Customer-facing leak tests (B4) pass for every state | CI run id |
| P9 Every business feature is behind its flag, `business.signups` is off, and turning `business.*` off returns the app to today's behaviour | Flag sweep; rollback drill |
| P10 Pilot agreement in place (BZ-0441-06) covering the venue's own licence and rights, and each pilot venue's licence attested (ADR-0449) | Needs a person: owner (and the lawyer, if the owner takes the early legal view in docs/saas/19-business-venues.md) |

**Gate S: ready to sell.** Gate P, plus:

| Gate | Evidence |
|---|---|
| S1 Legal review passed: business terms, public performance and dubbing position (ADR-0449), guest notice and Online Safety Act view for standing rooms (ADR-0451), data processing terms | Needs a person: lawyer's written view, owner records it |
| S2 Pricing validated against the competitive risk in ADR-0441 (pilot venues' willingness to pay, comparison with licensed-catalogue services) | Needs a person: owner's pricing decision with pilot evidence |
| S3 Scouting pilots ran as BZ-0441-07 requires (3 to 5 venues, at least 4 weeks each) with zero platform-caused silence and the owner's sign-off | Pilot report |
| S4 ST5 to ST10 pass on staging | Staging reports |
| S5 Stripe live-mode readiness: quantity subscriptions, invoices with PO numbers, EU reverse charge, grace emails, tested end to end in test mode and reviewed | Billing test run; owner review |
| S6 Support runbook for silent venues and a status page entry for business | Runbook link |
| S7 VoiceOver on iPhone and a real screen-reader user on S4 and S6 | Needs a person |
| S8 GO decision recorded under ADR-0440's independent GO NO-GO | Signed decision |

Only after Gate S does the owner turn `business.signups` on.

### Feature flags

Test-only harness switches live in the test servers, not the flag registry. Staging scenario commands follow `infra/staging/run.py` (refusing non-staging URLs and missing inputs).

## User outcome and acceptance contract

The owner can put SelectaDJ into a friendly venue knowing every known venue failure has a test, the platform has been pushed past real peaks, and nothing will silence the room by surprise; and can later sell it knowing the legal and pricing questions are settled, not guessed.

## Edge cases

The named tests above are the edge-case list. Further cases found during pilots are added as named tests before the fix, and the pilot report links them.

## Rejected alternatives

- One release gate (it would either delay pilots behind legal review or let selling start without it).
- Testing only with simulated kiosks (browser autoplay, wake lock and power cuts only show on real devices).
- Sampling edge cases instead of naming them all (venue failures are rare and public; each needs its own test).

## Implementation checklist - 0/15 Implemented; 0/15 independently Verified

1. **BZ-0454-01 - Business invariants.** **Acceptance:** B1 to B9 are checked by `selecta.audit.invariants` (or registered proofs where the database cannot show them), run after every business test, and each has a planted-violation test. **Required verification:** `tests/test_business_invariants.py`. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0454-02 - Hours, zones and kiosk edge-case tests.** **Acceptance:** Every named test in Hours and time, Zones and sessions, and Kiosk and offline exists and passes. **Required verification:** pytest and Playwright runs on SQLite and PostgreSQL. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0454-03 - Content and Rooms edge-case tests.** **Acceptance:** Every named test in Content controls and Rooms for Business exists and passes. **Required verification:** pytest and Playwright runs. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0454-04 - Roles, billing, pilots and licensing edge-case tests.** **Acceptance:** Every named test in Roles, Billing, grace and pilots, and Licensing exists and passes. **Required verification:** pytest runs. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0454-05 - UI edge-case tests.** **Acceptance:** Every named UI test exists and passes. **Required verification:** Playwright run of `web/e2e-business/`. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0454-06 - Simulated kiosk client.** **Acceptance:** A load client that pairs, heartbeats, holds leases, downloads horizon manifests, plays on a virtual clock, goes offline and reports plays; runs 1,000 instances in one process. **Required verification:** Unit tests; a smoke run of 50 kiosks against the cloud test server. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0454-07 - ST1 opening-hour peak.** **Acceptance:** Passes its thresholds scaled down locally and at full size (500 venues, 1,500 zones) on staging. **Required verification:** Local CI run; Needs staging: `python infra/staging/run.py business_peak`. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0454-08 - ST2 1,000 kiosks reconnect.** **Acceptance:** Passes its thresholds scaled down and at full size. **Required verification:** Local CI run; Needs staging: `python infra/staging/run.py business_reconnect`. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0454-09 - ST3 schedule edit across 200 venues.** **Acceptance:** Passes its thresholds, including the concurrent edit. **Required verification:** Local CI run; Needs staging: `python infra/staging/run.py business_bulk_schedule`. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0454-10 - ST4 grace expiring at closing time.** **Acceptance:** Passes for every listed timing, including DST, overnight closes, late and duplicate webhooks. **Required verification:** Local run with a frozen clock; Needs staging: `python infra/staging/run.py business_grace_close` with Stripe test mode. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0454-11 - ST5 to ST10.** **Acceptance:** Each further scenario passes its stated outcome locally scaled down and on staging. **Required verification:** Local runs; Needs staging for full size. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0454-12 - Real-device soak.** **Acceptance:** 72 hours on a mini PC, an Android TV box and an Android tablet with daily power cuts and a 2-hour network loss: zero unplanned silence, no memory growth beyond 20%, recovery without a tap where flags allow. **Required verification:** Needs a person: real devices in a test venue setup; soak report with measurements. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0454-13 - Gate P: ready for pilots.** **Acceptance:** P1 to P10 recorded with evidence. **Required verification:** Needs a person: the owner reviews the gate record and signs it. **Implementation:** Not started. **Independently Verified:** No.
14. **BZ-0454-14 - Gate S: ready to sell.** **Acceptance:** Gate P plus S1 to S8 recorded with evidence, after which `business.signups` may be turned on. **Required verification:** Needs a person: legal sign-off, pricing decision and the ADR-0440 GO decision. **Implementation:** Not started. **Independently Verified:** No.
15. **BZ-0454-15 - Staging commands and CI wiring.** **Acceptance:** `infra/staging/run.py` gains the business scenarios with their inputs listed in `infra/staging/README.md`; the scaled-down scenarios and edge-case tests run in CI on every merge to main. **Required verification:** `tests/test_staging_runner.py` extended; CI run id. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
