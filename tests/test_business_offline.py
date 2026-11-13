"""ADR-0446 offline-first venue playback rules (pure functions)."""

from __future__ import annotations

from selecta.business import offline as off

NOW = 1_800_000_000.0
HOUR = 3600.0
MB = 1024 * 1024


def _items(count: int, duration: float = 240.0, size: int = 25 * MB, start: float = NOW):
    return [
        {
            "id": f"s{i}",
            "key": f"art/{i}",
            "duration_s": duration,
            "bytes": size,
            "sha256": f"h{i}",
            "starts_at": start + i * duration,
        }
        for i in range(count)
    ]


def _open_schedule(opens: float = NOW - HOUR, closes: float = NOW + 10 * HOUR):
    return {"tz": "Europe/London", "periods": [{"opens_at": opens, "closes_at": closes}]}


def test_constants_match_adr():
    assert off.HORIZON_TARGET_S == 4 * 3600
    assert off.DEFAULT_DEVICE_CAP_BYTES == 4 * 1024**3
    assert off.CLOCK_SUSPECT_S == 120


def test_device_cap_is_smaller_of_4gb_and_half_quota():
    assert off.device_cap_bytes(None) == off.DEFAULT_DEVICE_CAP_BYTES
    assert off.device_cap_bytes(2 * 1024**3) == 1024**3
    assert off.device_cap_bytes(100 * 1024**3) == off.DEFAULT_DEVICE_CAP_BYTES


def test_manifest_holds_four_hours_when_open_and_fits():
    m = off.horizon_manifest("z1", _items(80), NOW, _open_schedule())
    assert m["state"] == "open"
    assert m["fits_cap"] is True
    assert m["hours_covered"] == 4.0
    assert len(m["segments"]) == 60
    assert all(s["download"] and not s["speculative"] for s in m["segments"])
    assert [s["committed"] for s in m["segments"][:4]] == [True, True, True, False]
    assert m["segments"][0].keys() >= {"id", "key", "starts_at", "duration_s", "bytes", "sha256"}
    assert not m["below_minimum"]


def test_manifest_cap_keeps_nearest_first_and_reports_hours():
    m = off.horizon_manifest("z1", _items(80), NOW, _open_schedule(), cap_bytes=25 * MB * 25)
    assert m["fits_cap"] is False
    assert [s["id"] for s in m["segments"]] == [f"s{i}" for i in range(25)]
    assert m["hours_covered"] == round(25 * 240 / 3600, 2)
    assert "1 h 40 min" in off.offline_hours_text(m["hours_covered"])
    assert "SelectaDJ" in off.offline_hours_text(1.0)


def test_manifest_below_minimum_flagged_when_cap_under_an_hour():
    m = off.horizon_manifest("z1", _items(80), NOW, _open_schedule(), cap_bytes=25 * MB * 5)
    assert m["below_minimum"] is True


def test_committed_window_kept_even_over_cap():
    m = off.horizon_manifest("z1", _items(10), NOW, _open_schedule(), cap_bytes=1)
    assert [s["id"] for s in m["segments"]] == ["s0", "s1", "s2"]
    assert m["fits_cap"] is False


def test_manifest_stops_at_close_and_skips_finished():
    items = _items(80, start=NOW - 480)
    m = off.horizon_manifest("z1", items, NOW, _open_schedule(closes=NOW + HOUR))
    assert m["segments"][0]["id"] == "s2"
    assert all(s["starts_at"] < NOW + HOUR for s in m["segments"])
    assert m["close_at"] == NOW + HOUR


def test_manifest_closed_is_speculative_and_warming_downloads():
    closed = off.horizon_manifest("z1", _items(5), NOW, {"periods": []})
    assert closed["state"] == "closed"
    assert all(s["speculative"] and not s["download"] for s in closed["segments"])
    warm = off.horizon_manifest("z1", _items(5), NOW, _open_schedule(opens=NOW + 600))
    assert warm["state"] == "warming"
    assert all(s["download"] for s in warm["segments"])


def test_manifest_explicit_committed_flags_and_cumulative_starts():
    items = [{"id": "a", "duration_s": 100, "bytes": 1, "committed": True},
             {"id": "b", "duration_s": 100, "bytes": 1}]
    m = off.horizon_manifest("z1", items, NOW, _open_schedule())
    assert [s["committed"] for s in m["segments"]] == [True, False]
    assert m["segments"][1]["starts_at"] == NOW + 100
    assert m["segments"][0]["key"] == "a"


def test_manifest_version_changes_with_content_and_schedule_window():
    sched = _open_schedule()
    sched["periods"].append({"opens_at": NOW + 20 * 86400, "closes_at": NOW + 20 * 86400 + 60})
    sched["blocks"] = [{"starts_at": NOW, "ends_at": NOW + HOUR, "name": "brunch"},
                       {"starts_at": NOW - 9 * HOUR, "ends_at": NOW - 8 * HOUR}]
    a = off.horizon_manifest("z1", _items(5), NOW, sched)
    b = off.horizon_manifest("z1", _items(6), NOW, sched)
    assert a["version"] != b["version"]
    assert a["version"] == off.horizon_manifest("z1", _items(5), NOW, sched)["version"]
    assert len(a["schedule"]["periods"]) == 1
    assert [blk.get("name") for blk in a["schedule"]["blocks"]] == ["brunch"]
    assert a["schedule"]["tz"] == "Europe/London"


def _cmd(cid, kind, at, **kw):
    return off.Command(id=cid, zone_id="z1", kind=kind, issued_at=at, **kw)


def _state(**kw):
    base = {"zone_id": "z1", "open": True, "playing": True, "last_change_at": NOW - 300,
            "current_song_id": "song-1", "volume": 50, "volume_changed_at": NOW - 300,
            "close_at": NOW + HOUR}
    base.update(kw)
    return base


def test_resync_orders_by_corrected_time_and_dedupes():
    cmds = [
        _cmd("b", "volume", NOW - 30, payload={"volume": 40}, seq=2),
        _cmd("a", "volume", NOW - 90, device_offset_s=30, payload={"volume": 30}, seq=1),
        _cmd("a", "volume", NOW - 90, device_offset_s=30, payload={"volume": 30}, seq=1),
    ]
    out = off.resync(_state(), cmds, NOW)
    assert out["applied"] == ["a", "b"]
    assert out["duplicates"] == ["a"]
    assert out["state"]["volume"] == 40
    again = off.resync(out["state"], cmds, NOW)
    assert again["applied"] == [] and sorted(again["duplicates"]) == ["a", "a", "b"]


def test_resync_accepts_dicts():
    raw = {"id": "x", "zone_id": "z1", "kind": "steer", "issued_at": NOW - 5,
           "payload": {"energy": 1}, "seq": 1}
    out = off.resync(_state(), [raw], NOW)
    assert out["state"]["steering"] == {"energy": 1}


def test_resync_drops_stale_with_reasons():
    cmds = [
        _cmd("old", "steer", NOW - 20 * 60),
        _cmd("queued", "steer", NOW - 5 * 60),
        _cmd("skip", "skip", NOW - 10, payload={"song_id": "song-0"}),
        _cmd("vol", "volume", NOW - 400, device_offset_s=300, payload={"volume": 10}),
        _cmd("bad", "dance", NOW - 1),
        off.Command(id="other", zone_id="z2", kind="steer", issued_at=NOW - 1),
    ]
    out = off.resync(_state(volume_changed_at=NOW - 30), cmds, NOW)
    reasons = {d["id"]: d["reason"] for d in out["dropped"]}
    assert reasons == {"old": "too_old", "queued": "queued_too_long",
                       "skip": "song_already_changed", "vol": "superseded",
                       "bad": "unknown_kind", "other": "wrong_zone"}
    assert out["applied"] == []


def test_skip_of_current_song_applies():
    out = off.resync(_state(), [_cmd("s", "skip", NOW - 5, payload={"song_id": "song-1",
                                                                    "next_song_id": "song-2"})], NOW)
    assert out["applied"] == ["s"]
    assert out["state"]["current_song_id"] == "song-2"


def test_transport_refused_when_speaker_offline():
    out = off.resync(_state(speaker_online=False), [_cmd("p", "play", NOW - 5)], NOW)
    assert out["dropped"][0]["reason"] == "speaker_offline"


def test_replayed_pause_never_silences_open_zone_unless_newer_and_from_person():
    stale = _cmd("p1", "pause", NOW - 60, person_id="u1")
    out = off.resync(_state(last_change_at=NOW - 30), [stale], NOW)
    assert out["dropped"][0]["reason"] == "superseded"
    assert out["state"]["playing"] is True
    anon = _cmd("p2", "close_now", NOW - 10)
    out = off.resync(_state(), [anon], NOW)
    assert out["dropped"][0]["reason"] == "no_person"
    fresh = _cmd("p3", "pause", NOW - 10, person_id="u1")
    out = off.resync(_state(), [fresh], NOW)
    assert out["applied"] == ["p3"] and out["state"]["playing"] is False


def test_kiosk_facts_skip_age_limits():
    fact = _cmd("k", "pause", NOW - 3 * HOUR, origin="kiosk")
    out = off.resync(_state(open=False, last_change_at=0), [fact], NOW)
    assert out["applied"] == ["k"]


def test_stay_open_late_close_now_and_approvals():
    cmds = [
        _cmd("late", "stay_open_late", NOW - 50, payload={"minutes": 60}, person_id="u"),
        _cmd("ap", "approve_request", NOW - 40, payload={"request_id": "r1"}),
        _cmd("ap2", "approve_request", NOW - 35, payload={"request_id": "r1"}),
        _cmd("close", "close_now", NOW - 20, person_id="u"),
    ]
    out = off.resync(_state(), cmds, NOW)
    assert out["applied"] == ["late", "ap", "ap2", "close"]
    assert out["state"]["approved_requests"] == ["r1"]
    assert out["state"]["open"] is False and out["state"]["close_at"] == NOW - 20


def test_stay_open_late_extends_close():
    out = off.resync(_state(), [_cmd("late", "stay_open_late", NOW - 5,
                                     payload={"minutes": 30})], NOW)
    assert out["state"]["close_at"] == NOW + HOUR + 1800


def test_volume_apply_mode():
    assert off.volume_apply_mode(60)["mode"] == "jump"
    assert off.volume_apply_mode(11 * 60) == {"mode": "ramp", "ramp_s": 30.0}


def test_kiosk_now_uses_monotonic_and_flags_drift():
    trusted = off.kiosk_now(NOW, 1000.0, 1600.0)
    assert trusted == NOW + 600
    assert off.kiosk_now(NOW, 1000.0, 900.0) == NOW
    assert off.clock_suspect(trusted + 6 * HOUR, trusted) is True
    assert off.clock_suspect(trusted + 119, trusted) is False


def test_wall_clock_plausible_after_reboot():
    assert off.wall_clock_plausible(NOW, NOW - 10, NOW + 10)
    assert not off.wall_clock_plausible(NOW - 6 * HOUR, NOW - 10, NOW + 10)


def test_offline_plan_plays_cache_when_it_covers_close():
    m = off.horizon_manifest("z1", _items(80), NOW, _open_schedule(closes=NOW + 2 * HOUR))
    plan = off.offline_plan(m, NOW + 60)
    assert plan["action"] == "play_cache"
    assert plan["current"] == "s0"
    assert plan["fallback"] is None
    assert plan["minutes_left"] == round((2 * HOUR - 60) / 60, 1)


def test_offline_plan_falls_back_to_reel_before_silence():
    m = off.horizon_manifest("z1", _items(80), NOW, _open_schedule())
    plan = off.offline_plan(m, NOW + 60)
    assert plan["action"] == "play_cache"
    assert plan["fallback"]["mode"] == "fallback_reel"
    assert plan["fallback"]["starts_at"] == NOW + 4 * HOUR
    later = off.offline_plan(m, NOW + 5 * HOUR)
    assert later["action"] == "fallback_reel"
    assert later["minutes_left"] == 0
    assert later["fallback"]["log_kind"] == "offline_fallback"


def test_offline_plan_stops_only_when_nothing_allowed():
    m = off.horizon_manifest("z1", _items(5), NOW, _open_schedule())
    plan = off.offline_plan(m, NOW + 2 * HOUR, allowed_keys=[])
    assert plan["action"] == "stop"
    assert plan["message"] == off.BACK_SHORTLY_TEXT
    some = off.offline_plan(m, NOW + 2 * HOUR, allowed_keys=["art/1"])
    assert some["fallback"]["pool"] == ["art/1"]


def test_offline_plan_follows_cached_schedule_and_permit():
    m = off.horizon_manifest("z1", _items(5), NOW, _open_schedule(closes=NOW + HOUR))
    after_close = off.offline_plan(m, NOW + 2 * HOUR)
    assert after_close["state"] == "closed" and after_close["action"] == "closed"
    expired = off.offline_plan(m, NOW + 60, permit_valid_until=NOW)
    assert expired["permit_expired"] is True
    assert expired["action"] == "play_cache"
    assert expired["close_at"] == NOW + HOUR
