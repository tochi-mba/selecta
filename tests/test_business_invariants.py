"""BZ-0454-01: the business invariants B1 to B9 catch planted violations and pass clean traces.

ADR-0454 Decision, "Business invariants": each of B1 to B9 needs a planted-violation test.
Every planted test starts from one clean trace with a fact of every kind and adds exactly one
bad fact, then asserts the checker names exactly that invariant.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from bz_contract.invariants import (  # noqa: F401
    allow_snapshot,
    at,
    bz_trace,
    record_access,
    record_audio,
    record_grace_end,
    record_horizon,
    record_lease,
    record_offboarding,
    record_payload,
    record_play,
    record_play_log,
    record_stop,
    record_venue,
    record_volume,
    record_warning,
    record_window,
)

from selecta.audit.business_invariants import (
    CUSTOMER_FIELDS,
    MANAGER_ONLY_KEYS,
    NAMES,
    NOT_CHECKED_IN_DB,
    BusinessInvariantBroken,
    BusinessViolation,
    assert_trace_clean,
    check_trace,
)
from selecta.audit.business_trace import BusinessTrace

OPENS = at(10)
CLOSES = at(22)


def clean_trace() -> BusinessTrace:
    """One venue (v1, org o1, zone z1) open 10:00 to 22:00 with a clean fact of every kind."""
    trace = BusinessTrace(observed_until=at(23))
    record_venue(trace, "v1", "o1", ["z1"])
    record_window(trace, "v1", OPENS, CLOSES)
    record_horizon(trace, "z1", "k1", at(9, 50), 4 * 3600)
    record_audio(trace, "z1", "k1", at(10, 0, 30), CLOSES)
    record_lease(trace, "z1", "k1", at(9, 59), CLOSES)
    allow_snapshot(trace, "s1", ["song-a", "song-b"])
    record_play(trace, "p1", zone_id="z1", song_id="song-a", started=at(10, 1), snapshot_id="s1")
    record_play(
        trace,
        "p2",
        zone_id="z1",
        song_id="song-b",
        started=at(10, 5),
        snapshot_id="s1",
        offline=True,
    )
    song = {"song_id": 7, "title": "Amazing Grace", "artist": "The Pilots", "length_s": 201.0}
    record_payload(trace, "kiosk", {"state": "playing", "now_playing": song, "zone_name": "Bar"})
    record_payload(
        trace,
        "guest",
        {
            "room_name": "Front bar",
            "now_playing": song,
            "requests_open": True,
            "coming_up": [{"request_id": "r1", "song": song, "votes": 2, "nickname": "Sam"}],
        },
    )
    record_payload(trace, "display", {"state": "showing", "code": "ABC123", "upcoming": []})
    record_access(
        trace,
        actor_kind="person",
        actor_id="u1",
        actor_org="o1",
        resource_org="o1",
        in_scope=True,
        succeeded=True,
    )
    record_access(
        trace,
        actor_kind="kiosk",
        actor_id="k1",
        actor_org="o1",
        resource_org="o2",
        in_scope=False,
        succeeded=False,
    )
    record_grace_end(trace, "o1", at(20))
    record_warning(trace, "o1", "72h", at(20) - timedelta(hours=72))
    record_warning(trace, "o1", "24h", at(20) - timedelta(hours=24))
    record_stop(trace, "v1", CLOSES, "billing")
    record_stop(trace, "v1", at(15), "manual", mid_song=True)
    record_offboarding(trace, "u9", at(12), at(12, 0, 30))
    record_offboarding(trace, "u8", at(12), None)
    record_volume(trace, "z1", "k1", at(12), 0.5, 0.6)
    return trace


def invariants(trace: BusinessTrace) -> set[str]:
    return {violation.invariant for violation in check_trace(trace)}


def only(trace: BusinessTrace, invariant: str) -> list[BusinessViolation]:
    found = check_trace(trace)
    assert {violation.invariant for violation in found} == {invariant}, [str(v) for v in found]
    return found


# General ----------------------------------------------------------------------------------


def test_names_are_exactly_b1_to_b9() -> None:
    assert list(NAMES) == [f"B{number}" for number in range(1, 10)]
    assert set(NOT_CHECKED_IN_DB) == set(NAMES)
    assert all(chr(0x2014) not in sentence for sentence in NAMES.values())


def test_clean_trace_has_no_violations() -> None:
    assert check_trace(clean_trace()) == []
    assert_trace_clean(clean_trace())


def test_empty_trace_is_clean() -> None:
    assert check_trace(BusinessTrace()) == []


def test_bz_trace_fixture_yields_a_fresh_trace(bz_trace: BusinessTrace) -> None:  # noqa: F811
    """The fixture hands out an empty trace and checks it at teardown (gate P3)."""
    assert bz_trace.plays == [] and bz_trace.windows == []
    record_venue(bz_trace, "v1", "o1", ["z1"])
    record_window(bz_trace, "v1", OPENS, CLOSES)
    record_audio(bz_trace, "z1", "k1", OPENS, CLOSES)


def test_assert_trace_clean_lists_every_violation() -> None:
    trace = clean_trace()
    record_volume(trace, "z1", "k1", at(13), 0.9, 0.6)
    record_offboarding(trace, "u7", at(12), at(12, 5))
    with pytest.raises(BusinessInvariantBroken) as raised:
        assert_trace_clean(trace)
    message = str(raised.value)
    assert "2 business invariant violation(s)" in message
    assert "B8:" in message and "B9:" in message
    assert isinstance(raised.value, AssertionError)


def test_violation_str_names_the_invariant() -> None:
    assert str(BusinessViolation("B3", "two speakers")) == "B3: two speakers"


# B1 ---------------------------------------------------------------------------------------


def silence_trace(gap_seconds: float, horizon_seconds: float = 3600) -> BusinessTrace:
    trace = clean_trace()
    trace.audio.clear()
    record_audio(trace, "z1", "k1", OPENS, at(12))
    record_audio(trace, "z1", "k1", at(12, 0, gap_seconds), CLOSES)
    record_horizon(trace, "z1", "k1", at(11, 59), horizon_seconds)
    return trace


def test_b1_planted_silence_with_saved_music() -> None:
    found = only(silence_trace(600), "B1")
    assert "600 s" in found[0].detail


def test_b1_silence_of_exactly_60_seconds_is_fine() -> None:
    assert check_trace(silence_trace(60)) == []


def test_b1_silence_of_61_seconds_is_a_violation() -> None:
    only(silence_trace(61), "B1")


def test_b1_silence_without_a_playable_horizon_is_not_platform_caused() -> None:
    """The latest report before the gap says nothing is saved, so the silence is not B1."""
    assert check_trace(silence_trace(600, horizon_seconds=0)) == []


def test_b1_late_start_after_opening_counts() -> None:
    trace = clean_trace()
    trace.audio.clear()
    record_audio(trace, "z1", "k1", at(10, 2), CLOSES)
    only(trace, "B1")


def test_b1_silence_after_close_is_fine() -> None:
    trace = clean_trace()
    assert trace.observed_until == at(23)
    assert check_trace(trace) == []


def test_b1_twenty_four_hour_venue_is_judged_until_observed_end() -> None:
    trace = clean_trace()
    trace.windows.clear()
    trace.audio.clear()
    trace.stops.clear()
    trace.observed_until = at(30)
    record_window(trace, "v1", OPENS, None)
    record_audio(trace, "z1", "k1", OPENS, at(26))
    record_audio(trace, "z1", "k1", at(26, 1), at(30))
    assert check_trace(trace) == []
    record_horizon(trace, "z1", "k1", at(25), 1800)
    trace.audio[-1] = trace.audio[-1].__class__("z1", "k1", at(26, 5), at(30))
    found = only(trace, "B1")
    assert "300 s" in found[0].detail


def test_b1_handover_between_devices_is_continuous() -> None:
    trace = clean_trace()
    trace.audio.clear()
    record_audio(trace, "z1", "k1", OPENS, at(14))
    record_audio(trace, "z1", "k2", at(14), CLOSES)
    assert check_trace(trace) == []


# B2 ---------------------------------------------------------------------------------------


def test_b2_planted_refused_song() -> None:
    trace = clean_trace()
    record_play(trace, "p9", zone_id="z1", song_id="song-x", started=at(11), snapshot_id="s1")
    assert "refused" in only(trace, "B2")[0].detail


def test_b2_unknown_snapshot_is_a_violation() -> None:
    trace = clean_trace()
    record_play(trace, "p9", zone_id="z1", song_id="song-a", started=at(11), snapshot_id="s?")
    only(trace, "B2")


def test_b2_clean() -> None:
    trace = clean_trace()
    allow_snapshot(trace, "s2", ["song-c"])
    record_play(trace, "p9", zone_id="z1", song_id="song-c", started=at(11), snapshot_id="s2")
    assert check_trace(trace) == []


# B3 ---------------------------------------------------------------------------------------


def test_b3_planted_two_speakers() -> None:
    trace = clean_trace()
    record_lease(trace, "z1", "phone-1", at(13), at(13, 5))
    only(trace, "B3")


def test_b3_back_to_back_handover_is_fine() -> None:
    trace = clean_trace()
    trace.leases.clear()
    record_lease(trace, "z1", "k1", at(9, 59), at(14))
    record_lease(trace, "z1", "k2", at(14), CLOSES)
    assert check_trace(trace) == []


def test_b3_one_second_overlap_is_a_violation() -> None:
    trace = clean_trace()
    trace.leases.clear()
    record_lease(trace, "z1", "k1", at(9, 59), at(14, 0, 1))
    record_lease(trace, "z1", "k2", at(14), CLOSES)
    only(trace, "B3")


def test_b3_same_device_and_other_zones_are_fine() -> None:
    trace = clean_trace()
    record_lease(trace, "z1", "k1", at(12), at(13))
    record_lease(trace, "z2", "k2", at(12), at(13))
    assert check_trace(trace) == []


# B4 ---------------------------------------------------------------------------------------


def test_b4_planted_billing_key_on_kiosk() -> None:
    trace = clean_trace()
    record_payload(trace, "kiosk", {"state": "playing", "billing_state": "grace"})
    only(trace, "B4")


def test_b4_nested_denylisted_key_is_found() -> None:
    trace = clean_trace()
    body = {"coming_up": [{"request_id": "r1", "song": {"title": "x", "staff_name": "Ann"}}]}
    record_payload(trace, "guest", body)
    found = only(trace, "B4")
    assert "coming_up[0].song.staff_name" in found[0].detail


def test_b4_manager_words_and_emails_in_values_are_found() -> None:
    trace = clean_trace()
    record_payload(trace, "display", {"state": "problem", "message": "Payment overdue"})
    record_payload(trace, "guest", {"message": "Ask boss@example.com"})
    assert len(only(trace, "B4")) == 2


def test_b4_key_outside_the_allowlist_is_found() -> None:
    trace = clean_trace()
    record_payload(trace, "display", {"state": "showing", "zone_id": "z1"})
    only(trace, "B4")


def test_b4_song_titles_may_use_any_words() -> None:
    trace = clean_trace()
    song = {"title": "Billing Pilot Grace", "artist": "Licence to Seat", "length_s": 1.0}
    record_payload(trace, "guest", {"now_playing": song})
    assert check_trace(trace) == []


def test_b4_allowlists_cover_the_three_surfaces_and_exclude_the_denylist() -> None:
    assert set(CUSTOMER_FIELDS) == {"kiosk", "guest", "display"}
    for fields in CUSTOMER_FIELDS.values():
        assert not fields & MANAGER_ONLY_KEYS
    assert {"billing", "grace", "invoice", "email", "role", "health"} <= MANAGER_ONLY_KEYS


def test_b4_unknown_surface_is_a_violation() -> None:
    trace = clean_trace()
    record_payload(trace, "manager", {"state": "playing"})
    only(trace, "B4")


# B5 ---------------------------------------------------------------------------------------


def test_b5_planted_cross_organisation_success() -> None:
    trace = clean_trace()
    record_access(
        trace,
        actor_kind="tablet",
        actor_id="t1",
        actor_org="o1",
        resource_org="o2",
        in_scope=True,
        succeeded=True,
    )
    only(trace, "B5")


def test_b5_out_of_scope_success_is_a_violation() -> None:
    trace = clean_trace()
    record_access(
        trace,
        actor_kind="person",
        actor_id="u2",
        actor_org="o1",
        resource_org="o1",
        in_scope=False,
        succeeded=True,
    )
    only(trace, "B5")


def test_b5_refused_attempts_are_fine() -> None:
    trace = clean_trace()
    record_access(
        trace,
        actor_kind="person",
        actor_id="u2",
        actor_org="o2",
        resource_org="o1",
        in_scope=False,
        succeeded=False,
    )
    assert check_trace(trace) == []


# B6 ---------------------------------------------------------------------------------------


def stop_trace(moment=CLOSES, **stop: bool) -> BusinessTrace:
    trace = clean_trace()
    trace.stops.clear()
    record_stop(trace, "v1", moment, "billing", **stop)
    return trace


def test_b6_stop_at_close_is_fine() -> None:
    assert check_trace(stop_trace(CLOSES)) == []
    assert check_trace(stop_trace(CLOSES - timedelta(seconds=5))) == []


def test_b6_stop_one_minute_before_close_is_a_violation() -> None:
    found = only(stop_trace(CLOSES - timedelta(minutes=1)), "B6")
    assert "inside an open window" in found[0].detail


def test_b6_stop_outside_opening_hours_is_fine() -> None:
    assert check_trace(stop_trace(at(27))) == []


def test_b6_mid_song_stop_is_a_violation() -> None:
    only(stop_trace(CLOSES, mid_song=True), "B6")


def test_b6_stop_before_grace_end_is_a_violation() -> None:
    trace = stop_trace(CLOSES)
    record_grace_end(trace, "o1", at(23))
    only(trace, "B6")


def test_b6_missing_24h_warning_is_a_violation() -> None:
    trace = stop_trace(CLOSES)
    trace.warnings[:] = [warning for warning in trace.warnings if warning.kind != "24h"]
    assert "24h" in only(trace, "B6")[0].detail


def test_b6_warning_sent_after_the_stop_does_not_count() -> None:
    trace = stop_trace(CLOSES)
    trace.warnings[:] = [warning for warning in trace.warnings if warning.kind != "72h"]
    record_warning(trace, "o1", "72h", CLOSES + timedelta(minutes=1))
    only(trace, "B6")


def test_b6_duplicated_warning_is_a_violation() -> None:
    trace = stop_trace(CLOSES)
    record_warning(trace, "o1", "24h", at(20) - timedelta(hours=23))
    assert "2 24h" in only(trace, "B6")[0].detail


def test_b6_warning_for_another_cause_does_not_count() -> None:
    trace = clean_trace()
    trace.stops.clear()
    record_stop(trace, "v1", CLOSES, "pilot_end")
    only(trace, "B6")
    record_warning(trace, "o1", "72h", at(10) - timedelta(hours=72), cause="pilot_end")
    record_warning(trace, "o1", "24h", at(10) - timedelta(hours=24), cause="pilot_end")
    assert check_trace(trace) == []


def test_b6_twenty_four_hour_venue_never_stops_for_billing() -> None:
    trace = clean_trace()
    trace.windows.clear()
    trace.stops.clear()
    record_window(trace, "v1", OPENS, None)
    trace.audio.clear()
    record_audio(trace, "z1", "k1", OPENS, at(23))
    record_stop(trace, "v1", at(22, 30), "billing")
    assert "open 24 hours" in only(trace, "B6")[0].detail


def test_b6_other_stop_reasons_are_not_judged() -> None:
    trace = clean_trace()
    record_stop(trace, "v1", at(14), "licence", mid_song=True)
    assert check_trace(trace) == []


# B7 ---------------------------------------------------------------------------------------


def test_b7_planted_missing_row() -> None:
    trace = clean_trace()
    record_play(
        trace,
        "p9",
        zone_id="z1",
        song_id="song-a",
        started=at(11),
        snapshot_id="s1",
        logged=False,
    )
    assert "missing" in only(trace, "B7")[0].detail


def test_b7_offline_play_uploaded_twice_is_a_violation() -> None:
    trace = clean_trace()
    offline = next(play for play in trace.plays if play.offline)
    record_play_log(trace, offline)
    found = only(trace, "B7")
    assert "played offline" in found[0].detail and "2 times" in found[0].detail


def test_b7_row_without_a_play_is_a_violation() -> None:
    trace = clean_trace()
    play = trace.plays[0]
    record_play_log(trace, play.__class__("ghost", "z1", "v1", "song-a", at(11), "s1"))
    only(trace, "B7")


def test_b7_offline_play_uploaded_once_is_fine() -> None:
    trace = clean_trace()
    assert any(play.offline for play in trace.plays)
    assert check_trace(trace) == []


# B8 ---------------------------------------------------------------------------------------


def test_b8_access_31_seconds_after_removal_is_a_violation() -> None:
    trace = clean_trace()
    record_offboarding(trace, "u7", at(12), at(12, 0, 31))
    only(trace, "B8")


def test_b8_access_30_seconds_after_removal_is_fine() -> None:
    trace = clean_trace()
    record_offboarding(trace, "u7", at(12), at(12, 0, 30))
    assert check_trace(trace) == []


# B9 ---------------------------------------------------------------------------------------


def test_b9_planted_level_over_cap() -> None:
    trace = clean_trace()
    record_volume(trace, "z1", "k1", at(13), 0.61, 0.6)
    only(trace, "B9")


def test_b9_quiet_hours_transition() -> None:
    """At 21:00 quiet hours drop the cap from 0.8 to 0.4: the level must follow at once."""
    trace = clean_trace()
    record_volume(trace, "z1", "k1", at(20, 59, 59), 0.8, 0.8)
    record_volume(trace, "z1", "k1", at(21), 0.4, 0.4)
    record_volume(trace, "z1", "k1", at(21, 0, 1), 0.4 + 1e-9, 0.4)
    assert check_trace(trace) == []
    record_volume(trace, "z1", "k1", at(21, 0, 2), 0.8, 0.4)
    assert "0.800" in only(trace, "B9")[0].detail
