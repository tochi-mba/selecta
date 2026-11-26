# The engine store with its flag on: the local sweep

On 2026-11-26 the repo's existing Desktop tests were run on this machine with `core.engine_store`
forced on, in batches of 8 to 12 files with a time limit each, and every flag-on failure re-run
alone with the flag off. Since then CI runs the whole Desktop suite flag-on on every push (job
`Python / tests, engine store on`, `python-store-on` in `.github/workflows/test.yml`), so this
page is a record of what was found and fixed, not the proof of the rest.

## How

- `SELECTA_TEST_ENGINE_STORE=1` makes `tests/conftest.py` load `tests/engine_store_on.py`. It adds
  `+core.engine_store` after whatever flags a test sets (a test that names the flag, or asks for
  the build exactly with `flags.use("")`, keeps its own answer), and prints
  `engine store on: N store, M old (K with the flag off)`: store transactions, statements Selecta
  modules ran on a raw `sqlite3` connection with the flag on outside the modules that stay raw on
  purpose, and the same with the flag off (the store's own proofs run the old path on purpose).
- Cloud-only files (`test_cloud_*`, `test_bf_*`, `test_business_*`, `test_hosted_*`, 273 files)
  were skipped. The other 284 were ordered most relevant first (seams, mixes, drafts, requests,
  discovery, listening, ratings, library, scan, relink, lyrics, analysis, songs, planning, render,
  studio, Lucy, backup, upgrade, recovery, homes, API, start-up, workers, flags), then the rest.

## Numbers

| | Files |
|---|---|
| Ran to the end flag-on | 246 |
| Timed out at 280 s even alone, left to CI (slow with the flag off too; `test_mix.py` passed its first 39 of 50) | 4: `test_mix.py`, `test_mix_mixes.py`, `test_mix_render.py`, `test_s2_mix_presets.py` |
| Not run locally (the sweep stopped when CI took over) | 34, listed below |

First flag-on run of the 246: about 3,180 tests passed and 16 failed. 13 failed only with the
flag on and are fixed below; 3 failed both ways (not the flag's). Before the sweep, 5 of
`test_lucy_ready`'s 10 failed only with the flag on (fault 1 below). One more test fails only
with the flag off (below).

Store against old path, from the batches counted after the plugin split the two (19,251 store
transactions, 197 old statements with the flag on): `library.search_cache` 93, `listening` 40,
`lucy.events` 38 (fixed below; the rest is a caller with writes of its own), `eta` 16,
`lucy.conversations` 5, `mix_backend` 4, `eval.ratings` 1. Those are the paths kept on purpose for
a caller holding writes or a file not yet stamped (docs/engineering/engine-store.md). Over the
whole sweep, 26,600 store transactions ran.

Not run locally: `test_rc_saz_self_dealing`, `test_rc_srx_rooms_security`, `test_rc_sst_storage`,
`test_room_fanout_load`, `test_room_to_play`, `test_s2_steering`, `test_s2_word_edges`,
`test_s2_workshop_edges`, `test_s3_parity_task_map`, `test_s4_0109_comprehension_script` (a batch
cut off), `test_script_json`, `test_sec_af_audit`, `test_sec_bw_audit`, `test_selecta3_changes`,
`test_setting_conflicts`, `test_setup_cloud`, `test_sf_flow_locks`, `test_shared_derivations`,
`test_spare_time`, `test_staging_runner`, `test_stem_windows`, `test_t0265_constrained_profile`,
`test_t_task_evidence`, `test_todo`, `test_transition_craft`, `test_transition_craft_2`,
`test_uf_acceptance_crosswalk`, `test_uf_person_evidence`, `test_uf_research_protocol`,
`test_uf_status`, `test_user_journeys`, `test_visual_approvals`, `test_wordplay`, `test_workflows`.

## What the flag broke, and the fix

Product faults, most serious first:

1. **Seam readiness and memory missed a seam file the table had not caught up with**
   (`test_lucy_ready`, 5 tests, T-20261126-e67b). With the flag on they read only the seams
   table, which learns of a file at start-up or when `SeamStore` writes. On a real Desktop a file
   can change behind it (a mirror write that failed, a restore, a copied folder), so a ready seam
   read as not ready and a Bad rating whose mirror write was lost still read as ready. Files are
   the truth while the flag is proved: `seam_mirror` now uses a row only when it was kept after
   its file last changed, else reads the file. Test: `test_engine_store_seams_files_win.py`.
2. **Listing drafts opened a store transaction per draft** (`test_my_mixes_scale`): 500 drafts,
   516 statements and about 500 transactions where the old path ran a fixed few. `mix.read_mix`
   given rows now reads nothing. The scale test now counts the store's statements too.
3. **Lucy's event replay read the raw connection with the flag on** (found by the old-path
   count): `events.since` now reads through the store. Test: `test_engine_store_lucy_events.py`.

Tests that bypassed or measured the old path, corrected to say what they mean with the flag on:
`test_s4_scan_restart` (cuts the store's writer), `test_scan` (the chain already makes
`playback_skips`), `test_upgrade` (a library "from before" is made with the store off),
`test_local_upgrade` (the hand-made schema's fingerprint; `library.forget` before deleting),
`test_local_backup` (the preview also counts the seam tables), `test_api_contracts` (counts the
batched song read), `test_r8d_backend_speed` (watches the store's features read),
`test_s4_snapshot_export_model` and `test_s4_scope_model` (`library.forget` before deleting).

Failing both ways, not the flag's: `test_flow_export_jobs` (2) and `test_s2_export_edges` (1).
Failing only with the flag off: in `test_my_mixes_scale`, opening and changing one draft
(T-20261126-9842).

Opened: T-20261126-3582 (each store call re-probes the connection's file and stamp: 71 probes
when opening one draft), T-20261126-6a7f (a stamped library whose table is re-made by the
hand-made schema fails every store read, loudly), T-20261126-9842.

## The whole library

`tests/test_engine_store_whole_library.py` (about 40 s): one library made flag-off with something
in every slice starts flag-on (stamp at head, every table's rows the same over the flag-off
columns, every page reading a moved slice answers the same), off again and on again on the same
file, and a backup taken flag-on restores into a flag-off and a flag-on app with nothing lost.
`tools/library_compare.py` is the same check for the owner's copy of a real library
(docs/engineering/one-brain-listening.md, "Before listening").

## The tally

The raw tally, batch by batch: each flag-on result, and each failure's flag-off result.

```
## batch 1 (exit 0)
files: tests/test_engine_store_seams.py tests/test_engine_store_seams_files_win.py tests/test_engine_store_seams_postgres.py tests/test_local_durable_seams.py tests/test_s2_seam_inspector.py tests/test_s4_seam_settings.py tests/test_seam_correction_locks.py tests/test_seam_memory_nonblocking.py tests/test_seam_startup.py tests/test_engine_store_mixes.py 
on: 82 passed, 3 skipped in 69.73s (0:01:09) | engine store on: 1468 store, 633 old
## batch 2 (exit 124)
files: tests/test_engine_store_mixes_postgres.py tests/test_mix.py tests/test_mix_mixes.py tests/test_mix_render.py tests/test_my_mixes_scale.py tests/test_s2_mix_presets.py tests/test_setmix.py tests/test_drafts.py tests/test_work_queue_health.py tests/test_apb_requests.py 
on:  | 
TIMEOUT: split and retry
## batch 3 (exit 0)
files: tests/test_engine_store_requests.py tests/test_engine_store_requests_postgres.py tests/test_ex0124_request_states.py tests/test_lucy_request_class.py tests/test_request_planner.py tests/test_request_routes.py tests/test_requests.py tests/test_requests_together.py tests/test_discovery_search.py tests/test_discovery_sequence.py 
on: 301 passed, 4 skipped in 186.26s (0:03:06) | engine store on: 3805 store, 1557 old
## batch 4 (exit 0)
files: tests/test_engine_store_discovery.py tests/test_engine_store_discovery_postgres.py tests/test_ex0125_discovery.py tests/test_engine_store_listening.py tests/test_listening.py tests/test_s4_0108_export_listening.py tests/test_rhythm_calibration.py tests/test_engine_store_library.py tests/test_engine_store_library_routes.py tests/test_engine_store_library_writes.py 
on: 90 passed, 4 skipped in 185.73s (0:03:05) | engine store on: 251 store, 1369 old
## batch 5 (exit 1)
files: tests/test_library_edges.py tests/test_library_lx.py tests/test_library_paging_scale.py tests/test_library_relevance.py tests/test_s3_library_profile.py tests/test_s4_scan_restart.py tests/test_scan.py tests/test_folder_relink.py tests/test_gp_relink_choices.py tests/test_lyrics.py 
on: 2 failed, 92 passed, 1 skipped in 152.86s (0:02:32) | engine store on: 2439 store, 0 old
- tests/test_s4_scan_restart.py::test_a_restart_part_way_through_writing_leaves_no_duplicates_and_recovers_counts | off: 1 passed in 1.26s
- tests/test_scan.py::test_a_song_with_skip_history_going_does_not_stop_the_scan | off: 1 passed in 0.99s
## batch 6 (exit 0)
files: tests/test_lyrics_align.py tests/test_s4_0096_lyric_outage.py tests/test_analysis.py tests/test_device_analysis_golden.py tests/test_correction_during_watch.py tests/test_s2_correction_races.py tests/test_engine_store_songs.py tests/test_engine_store_songs_postgres.py tests/test_r10_song_audio.py tests/test_bz_billing_plan.py 
on: 51 passed, 4 skipped in 55.08s | engine store on: 224 store, 30 old
## batch 2.1 (exit 0)
files: tests/test_engine_store_mixes_postgres.py 
on:  | engine store on: 0 store, 0 old
## batch 2.2 (exit 124)
files: tests/test_mix.py 
on:  | 
TIMEOUT: split and retry
## batch 2.3 (exit 124)
files: tests/test_mix_mixes.py 
on:  | 
TIMEOUT: split and retry
## batch 2.4 (exit 124)
files: tests/test_mix_render.py 
on:  | 
TIMEOUT: split and retry
## batch 2.5 (exit 1)
files: tests/test_my_mixes_scale.py 
on: 2 failed, 8 passed in 109.56s (0:01:49) | engine store on: 10295 store, 0 old (0 with the flag off)
- tests/test_my_mixes_scale.py::test_deleting_or_playing_a_draft_leaves_the_other_drafts_rows_alone | off: 1 passed in 52.82s
- tests/test_my_mixes_scale.py::test_the_list_never_reads_revisions_and_its_queries_do_not_grow_with_drafts | off: 1 passed in 56.71s
## batch 2.6 (exit 124)
files: tests/test_s2_mix_presets.py 
on:  | 
TIMEOUT: split and retry
## batch 2.7 (exit 0)
files: tests/test_setmix.py 
on: 2 passed in 0.33s | engine store on: 0 store, 0 old (0 with the flag off)
## batch 2.8 (exit 0)
files: tests/test_drafts.py 
on: 81 passed in 31.69s | engine store on: 1065 store, 0 old (0 with the flag off)
## batch 2.9 (exit 0)
files: tests/test_work_queue_health.py 
on: 5 passed in 7.43s | engine store on: 0 store, 0 old (0 with the flag off)
## batch 2.10 (exit 0)
files: tests/test_apb_requests.py 
on: 6 passed in 0.94s | engine store on: 5 store, 0 old (0 with the flag off)
done 2. 1-10
## batch 7 (exit 0)
files: tests/test_bz_zone_autoplan.py tests/test_lucy_plan_routing.py tests/test_planner_core_paths.py tests/test_planner_core_pure.py tests/test_planner_core_repair.py tests/test_first_reel_lessons.py tests/test_reel.py tests/test_cue_change_during_render.py tests/test_device_render_golden.py tests/test_render.py 
on: 114 passed, 1 skipped in 170.07s (0:02:50) | engine store on: 113 store, 0 old (0 with the flag off)
## batch 8 (exit 124)
files: tests/test_e2e_studio_stems.py tests/test_studio.py tests/test_arrange.py tests/test_intertwine.py tests/test_engine_store_lucy.py tests/test_lucy_agent.py tests/test_lucy_api.py tests/test_lucy_cloud.py tests/test_lucy_cloud_devices.py tests/test_lucy_cloud_health.py 
on:  | 
TIMEOUT: split and retry
## batch 9 (exit 0)
files: tests/test_lucy_cloud_limits.py tests/test_lucy_cloud_step_down_cost.py tests/test_lucy_cloud_usage_enforced.py tests/test_lucy_cloud_usage_extra.py tests/test_lucy_cloud_usage_going_back.py tests/test_lucy_cloud_usage_other_limits.py tests/test_lucy_cloud_usage_shadow_parity.py tests/test_lucy_intent.py tests/test_lucy_price_baseline.py tests/test_lucy_provider_host.py 
on: 240 passed, 80 skipped in 152.46s (0:02:32) | engine store on: 0 store, 0 old (0 with the flag off)
## batch 10 (exit 1)
files: tests/test_lucy_ready.py tests/test_lucy_store.py tests/test_lucy_usage_windows.py tests/test_lx_lucy_diff.py tests/test_local_backup.py tests/test_local_upgrade.py tests/test_upgrade.py tests/test_recovery.py tests/test_e2e_home_private.py tests/test_homes.py 
on: 5 failed, 207 passed in 55.51s | engine store on: 896 store, 8 old (0 with the flag off)
- tests/test_local_backup.py::test_previewing_says_what_a_restore_replaces_and_what_it_leaves_alone | off: 1 passed in 1.20s
- tests/test_local_upgrade.py::test_a_schema_change_bumps_the_local_schema_version | off: 1 passed in 0.91s
- tests/test_local_upgrade.py::test_only_the_last_few_copies_are_kept | off: 1 passed in 1.76s
- tests/test_upgrade.py::test_a_library_from_before_can_take_corrections | off: 1 passed in 5.01s
- tests/test_upgrade.py::test_a_library_from_before_keeps_everything | off: 1 passed in 0.97s
## batch 11 (exit 1)
files: tests/test_mp_session_kit.py tests/test_s4_0110_at_session_log.py tests/test_export_retry.py tests/test_export_validation.py tests/test_flow_export_jobs.py tests/test_s2_export_edges.py tests/test_s4_snapshot_export_model.py tests/test_sf0246_frozen_export.py tests/test_api_contract_fixtures.py tests/test_api_contracts.py 
on: 5 failed, 142 passed in 89.82s (0:01:29) | engine store on: 952 store, 0 old (0 with the flag off)
- tests/test_api_contracts.py::test_the_library_is_read_again_when_a_correction_changes | off: 1 passed in 1.25s
- tests/test_flow_export_jobs.py::test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically | off: 1 failed in 1.38s
- tests/test_flow_export_jobs.py::test_once_the_file_is_being_written_cancel_is_refused | off: 1 failed in 1.12s
- tests/test_s2_export_edges.py::test_a_ready_file_that_has_gone_is_shown_expired_and_its_link_is_refused | off: 1 failed in 1.33s
- tests/test_s4_snapshot_export_model.py::TestSnapshotExport::runTest | off: 1 passed in 11.87s
## batch 12 (exit 0)
files: tests/test_worker_gateway_api.py tests/test_s3_docs_contracts.py tests/test_product.py tests/test_restart_during_mutation.py tests/test_restart_mid_work.py tests/test_local_durable_jobs.py tests/test_flag_server.py tests/test_flags.py tests/test_flags_bound.py tests/test_venue_flag_surface_registry.py 
on: 205 passed in 174.88s (0:02:54) | engine store on: 385 store, 1 old (6 with the flag off)
## batch 13 (exit 0)
files: tests/test_acceptance_ledger.py tests/test_admin_bootstrap_owner.py tests/test_admin_console_safety.py tests/test_adr_acceptance_audit.py tests/test_apa_venue_mode.py tests/test_apa_venue_policy.py tests/test_apb_continuity.py tests/test_apb_health.py tests/test_apb_learning.py tests/test_apb_market.py 
on: 140 passed, 19 skipped in 33.49s | engine store on: 0 store, 0 old (0 with the flag off)
done  7-13
## batch 8.1 (exit 0)
files: tests/test_e2e_studio_stems.py tests/test_studio.py 
on: 36 passed in 125.15s (0:02:05) | engine store on: 143 store, 0 old (0 with the flag off)
## batch 8.2 (exit 0)
files: tests/test_arrange.py tests/test_intertwine.py 
on: 103 passed in 111.41s (0:01:51) | engine store on: 0 store, 0 old (0 with the flag off)
## batch 8.3 (exit 0)
files: tests/test_engine_store_lucy.py tests/test_lucy_agent.py 
on: 21 passed in 24.39s | engine store on: 1264 store, 29 old (1778 with the flag off)
## batch 8.4 (exit 0)
files: tests/test_lucy_api.py tests/test_lucy_cloud.py 
on: 50 passed, 30 skipped in 79.78s (0:01:19) | engine store on: 2050 store, 6 old (0 with the flag off)
## batch 8.5 (exit 0)
files: tests/test_lucy_cloud_devices.py tests/test_lucy_cloud_health.py 
on: 30 passed, 25 skipped in 41.48s | engine store on: 0 store, 0 old (0 with the flag off)
done 8. 1-5
## batch 14 (exit 0)
files: tests/test_apb_rights.py tests/test_apb_roles.py tests/test_apb_rollout.py tests/test_apb_soak.py tests/test_apb_speakers.py tests/test_apb_staff.py tests/test_audio.py tests/test_audio_fixtures.py tests/test_audio_identity.py tests/test_audio_identity_cloud.py 
on: 230 passed, 13 skipped in 36.42s | engine store on: 231 store, 0 old (0 with the flag off)
## batch 15 (exit 0)
files: tests/test_audio_identity_desktop.py tests/test_baseline_archive.py tests/test_branded_surfaces.py tests/test_bz_billing_checkout.py tests/test_bz_billing_routes.py tests/test_bz_billing_staff.py tests/test_bz_derived_limits.py tests/test_bz_entitlement_routes.py tests/test_bz_entitlement_wiring.py tests/test_bz_entitlements.py 
on: 101 passed, 4 skipped in 43.78s | engine store on: 49 store, 0 old (0 with the flag off)
## batch 16 (exit 0)
files: tests/test_bz_isrc.py tests/test_bz_licensing.py tests/test_bz_licensing_routes.py tests/test_bz_playlog.py tests/test_bz_slo.py tests/test_bz_terms.py tests/test_bz_weight.py tests/test_cache_care.py tests/test_cache_walk_escape.py tests/test_catalog_client.py 
on: 122 passed in 20.18s | engine store on: 2 store, 0 old (0 with the flag off)
## batch 17 (exit 0)
files: tests/test_catalog_match.py tests/test_catalog_routes.py tests/test_catalog_service.py tests/test_checklist_evidence.py tests/test_checklist_summary.py tests/test_ci_coverage_matrix.py tests/test_ci_creative_interface.py tests/test_ci_related_links.py tests/test_ci_sharding.py tests/test_ci_workflow_caches.py 
on: 83 passed, 28 skipped in 54.15s | engine store on: 22 store, 0 old (0 with the flag off)
## batch 18 (exit 0)
files: tests/test_cli_progress.py tests/test_dev_cloud_launcher.py tests/test_dev_cloud_posture.py tests/test_dev_cloud_room_locks.py tests/test_dev_identity_tokens.py tests/test_dev_launcher.py tests/test_dev_script.py tests/test_device_beat_sources.py tests/test_devstack_guard.py tests/test_devstack_redirect_safety.py 
on: 70 passed in 11.10s | engine store on: 0 store, 0 old (0 with the flag off)
## batch 19 (exit 0)
files: tests/test_diagnostics_operations.py tests/test_dmca_reminder.py tests/test_engine_store.py tests/test_engine_store_postgres.py tests/test_eta.py tests/test_ex_0114_s4_crosswalk.py tests/test_ex_0114_side_effect_map.py tests/test_ex_0128_operations_parity.py tests/test_ex_0129_study_integrity.py tests/test_ex_0133_scale_profile.py 
on: 124 passed, 6 skipped in 39.38s | engine store on: 223 store, 56 old (0 with the flag off)
## batch 20 (exit 0)
files: tests/test_ex_0134_desktop_coupling.py tests/test_ex_study.py tests/test_feedback_missing_tempo.py tests/test_feel_gaps_local.py tests/test_file_length.py tests/test_fingerprint_sharing_guard.py tests/test_flow_cross_cutting.py tests/test_flow_release_safety.py tests/test_flow_screenshot_approval.py tests/test_flow_study_cards_0223_0247.py 
on: 54 passed in 12.41s | engine store on: 114 store, 0 old (82 with the flag off)
## batch 21 (exit 0)
files: tests/test_flow_test_crosswalk.py tests/test_flow_waveform_peaks.py tests/test_fp_review_packets.py tests/test_gp0259_explore_expectations.py tests/test_gp_0257_low_light.py tests/test_gp_0258_batch_scale.py tests/test_gp_0258_priority_undo.py tests/test_gp_0260_handoff.py tests/test_gp_0263_self_service.py tests/test_gp_music_search.py 
on: 72 passed in 174.39s (0:02:54) | engine store on: 308 store, 0 old (0 with the flag off)
## batch 22 (exit 0)
files: tests/test_gp_research_protocol.py tests/test_gp_study.py tests/test_hardware_baseline.py tests/test_hearing.py tests/test_key_benchmark.py tests/test_launch_operator_checklist.py tests/test_load_ladder.py tests/test_local_art.py tests/test_local_media_versions.py tests/test_local_work_host.py 
on: 124 passed, 6 skipped in 68.29s (0:01:08) | engine store on: 24 store, 0 old (0 with the flag off)
## batch 23 (exit 0)
files: tests/test_long_paths.py tests/test_lx_programme_status.py tests/test_lx_release_evidence.py tests/test_mi_0162_search_speed.py tests/test_mi_implementation_ledger.py tests/test_mi_study_kit.py tests/test_mp_evidence_audit.py tests/test_no_committed_secrets.py tests/test_no_promises_in_copy.py tests/test_no_quarantined_tests.py 
on: 96 passed in 35.12s | engine store on: 8 store, 0 old (0 with the flag off)
## batch 24 (exit 1)
files: tests/test_nothing_lost_local.py tests/test_one_engine_stems.py tests/test_operation_identity.py tests/test_owner_runbook.py tests/test_parity_inventory.py tests/test_polish_governance.py tests/test_polish_phase03.py tests/test_pr_slice_gate.py tests/test_r11_list_speed.py tests/test_r8d_backend_speed.py 
on: 1 failed, 100 passed in 134.80s (0:02:14) | engine store on: 264 store, 4 old (0 with the flag off)
- tests/test_r8d_backend_speed.py::test_load_song_never_reads_the_waveform_or_raw_beats | off: 1 passed in 0.87s
## batch 25 (exit 127)
files: tests/test_rc_saz_self_dealing.py tests/test_rc_srx_rooms_security.py tests/test_rc_sst_storage.py tests/test_room_fanout_load.py tests/test_room_to_play.py tests/test_s2_steering.py tests/test_s2_word_edges.py tests/test_s2_workshop_edges.py tests/test_s3_parity_task_map.py tests/test_s4_0109_comprehension_script.py 
on:  | 
## batch 26 (exit 1)
files: tests/test_s4_0111_search_cache.py tests/test_s4_0112_golden_promotion.py tests/test_s4_0112_suite_inventory.py tests/test_s4_card_action_parity.py tests/test_s4_contrast_pairs.py tests/test_s4_folder_input.py tests/test_s4_governance.py tests/test_s4_parity_map.py tests/test_s4_scope_model.py tests/test_s4_selector_collisions.py 
on: 1 failed, 73 passed in 28.47s | engine store on: 838 store, 93 old (0 with the flag off)
- tests/test_s4_scope_model.py::TestScopedWrites::runTest | off: 1 passed in 11.75s
```
