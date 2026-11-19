"""Hours, time and kiosk edge cases under their ADR-0454 names (BZ-0454-02).

Hours run the real `business.hours` model; the kiosk cases run `business.offline`, the server
side of the offline contract the kiosk mirrors (web/src/business/offline). The kiosk-only cases
(power cut, autoplay, storage eviction, auto-update) are vitest tests of the kiosk code itself,
in web/src/kiosk/kioskEdges.business.test.ts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from selecta.business import hours as h
from selecta.business import offline
from selecta.business.hours import Hours, Period

LONDON = ZoneInfo("Europe/London")
NEW_YORK = ZoneInfo("America/New_York")


def intervals(hours: Hours, first: date, days: int = 2):
    start = datetime(first.year, first.month, first.day, tzinfo=ZoneInfo(hours.tz))
    return h.periods_between(hours, start, start + timedelta(days=days))


# --- hours and time ---------------------------------------------------------------------------


def test_overnight_hours_close_after_midnight_belong_to_the_opening_day():
    friday = Hours("Europe/London", (Period(4, "18:00", "02:00"),))
    found = intervals(friday, date(2026, 11, 20))  # Friday 20 November
    assert len(found) == 1
    night = found[0]
    assert night.opening_date == date(2026, 11, 20)
    assert night.scheduled_end == datetime(2026, 11, 21, 2, 0, tzinfo=LONDON).astimezone(UTC)
    at_one = datetime(2026, 11, 21, 1, 0, tzinfo=LONDON)
    state = h.state_at(found, at_one)
    assert state.state in ("open", "closing") and state.interval.opening_date == night.opening_date


def test_venue_time_zone_differs_from_head_office():
    """Head office is in London; the venue keeps New York hours in its own zone."""
    venue = Hours("America/New_York", tuple(Period(d, "17:00", "23:00") for d in range(7)))
    found = intervals(venue, date(2026, 11, 20), days=1)
    assert found[0].start == datetime(2026, 11, 20, 17, 0, tzinfo=NEW_YORK).astimezone(UTC)
    london_evening = datetime(2026, 11, 20, 20, 0, tzinfo=LONDON)  # 15:00 in New York
    assert h.state_at(found, london_evening).state != "open"


def test_open_24_hours_has_no_close_and_no_stop():
    always = Hours("Europe/London", tuple(Period(d, "00:00", "24:00", True) for d in range(7)))
    noon = datetime(2026, 11, 20, 12, 0, tzinfo=LONDON)
    state = h.next_change(always, None, noon)
    assert state.state == "open"
    assert state.interval is not None and state.interval.scheduled_end is None
    assert state.next_state in (None, "closed") and (state.next_change is None
                                                     or state.next_state is None)


def test_kiosk_clock_six_hours_wrong_uses_server_time():
    server_time = 1_800_000_000.0
    wall = server_time - 6 * 3600  # the device thinks it is six hours earlier
    trusted = offline.kiosk_now(server_time, monotonic_at_sync=100.0, monotonic_now=160.0)
    assert trusted == server_time + 60
    assert offline.clock_suspect(wall, trusted)  # shown to the manager, playback unaffected
    schedule = {"periods": [{"opens_at": server_time - 60, "closes_at": server_time + 3600}]}
    assert offline.zone_state(schedule, trusted)[0] == "open"
    assert offline.zone_state(schedule, wall)[0] == "closed"  # what a wall clock would wrongly say


# --- kiosk and offline ------------------------------------------------------------------------

NOW = 1_800_000_000.0


def _items(count: int, length: float = 200.0, bytes_per: int = 8_000_000):
    return [{"id": f"s{i}", "key": f"art/{i}", "duration_s": length, "bytes": bytes_per,
             "sha256": f"h{i}", "kind": "song"} for i in range(count)]


def test_four_hours_of_music_are_saved_ahead_during_opening():
    schedule = {"periods": [{"opens_at": NOW - 3600, "closes_at": NOW + 10 * 3600}]}
    manifest = offline.horizon_manifest("z1", _items(120), NOW, schedule)
    covered = sum(s["duration_s"] for s in manifest["segments"])
    assert offline.HORIZON_TARGET_S - 200 <= covered <= offline.HORIZON_TARGET_S + 200


def _cached(count: int, start: float, length: float = 200.0):
    return {"schedule": {"periods": [{"opens_at": start - 3600, "closes_at": start + 12 * 3600}]},
            "segments": [{"id": f"s{i}", "key": f"art/{i}", "kind": "song",
                          "starts_at": start + i * length, "duration_s": length}
                         for i in range(count)]}


def test_internet_drop_for_two_hours_keeps_playing():
    manifest = _cached(72, NOW)  # four hours saved
    two_hours_later = offline.offline_plan(manifest, NOW + 2 * 3600)
    assert two_hours_later["action"] == "play_cache" and two_hours_later["current"]
    assert two_hours_later["message"] is None


def test_offline_beyond_saved_music_shows_back_shortly():
    manifest = _cached(3, NOW)
    after = offline.offline_plan(manifest, NOW + 3 * 3600, allowed_keys=[])
    assert after["action"] == "stop" and after["message"] == offline.BACK_SHORTLY_TEXT
    reel = offline.offline_plan(manifest, NOW + 3 * 3600)
    assert reel["action"] == "fallback_reel"  # with allowed saved songs it keeps playing


def test_queued_commands_older_than_two_minutes_are_dropped():
    state = {"zone_id": "z1", "open": True, "speaker_online": True}
    queued = [
        {"id": "old", "zone_id": "z1", "kind": "volume", "issued_at": NOW - 150,
         "payload": {"volume": 30}, "seq": 1, "device_id": "tab"},
        {"id": "new", "zone_id": "z1", "kind": "volume", "issued_at": NOW - 30,
         "payload": {"volume": 40}, "seq": 2, "device_id": "tab"},
    ]
    result = offline.resync(state, queued, NOW)
    assert result["applied"] == ["new"]
    assert result["dropped"] == [{"id": "old", "kind": "volume", "reason": "queued_too_long"}]
    again = offline.resync(result["state"], queued, NOW + 1)
    assert again["applied"] == [] and "new" in again["duplicates"]  # never applied twice
