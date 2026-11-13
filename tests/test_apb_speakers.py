"""ADR-0433: speaker platforms, zones, transfer and reconnection, offline rights, runbooks."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from selecta import flags
from selecta.venueops import speaker_platforms as sp
from selecta.venueops.continuity import Play, evaluate
from selecta.venueops.leases import LeaseTable, NotASpeaker, StaleLease
from selecta.venueops.offline_rights import Licence, OfflineRefused, OfflineStore
from selecta.venueops.zones import Speaker, ZoneDirectory, ZoneError

ON = "autopilot.venue_mode venue.continuity venue.speakers"
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def venue_flags():
    flags.use(ON)
    yield
    flags.use(None)


# ---- AV-0433-01: platform certification matrix -------------------------------------------------


def test_every_platform_starts_not_certified_and_iphone_is_remote_only():
    matrix = sp.Matrix()
    assert [p.id for p in sp.primary_platforms()] == ["windows-chromium", "macos-chromium-safari"]
    for row in matrix.rows():
        if row["tier"] == "remote_only":
            assert row["status"] == "remote only" and not row["checks"]
        else:
            assert row["status"] == "not certified"
            assert set(row["checks"].values()) == {"not certified"}
    assert "not certified" in matrix.markdown()


def test_certification_needs_person_hardware_and_evidence_for_every_check(tmp_path):
    matrix = sp.Matrix()
    with pytest.raises(sp.CertificationError):
        matrix.record_result("windows-chromium", "soak_6h", passed=True, hardware="",
                             by="", evidence="")
    with pytest.raises(sp.CertificationError):
        matrix.record_result("iphone-safari", "soak_6h", passed=True, hardware="x", by="y",
                             evidence="z")
    for check in sp.CHECK_IDS[:-1]:
        matrix.record_result("windows-chromium", check, passed=True, hardware="Test PC",
                             by="Tester", evidence=f"report-{check}.json")
    assert not matrix.certified("windows-chromium")
    matrix.record_result("windows-chromium", sp.CHECK_IDS[-1], passed=False,
                         hardware="Test PC", by="Tester", evidence="video.mp4")
    assert matrix.status("windows-chromium") == "failed"
    matrix.record_result("windows-chromium", sp.CHECK_IDS[-1], passed=True,
                         hardware="Test PC", by="Tester", evidence="video2.mp4")
    assert matrix.certified("windows-chromium")
    path = tmp_path / "matrix.json"
    matrix.save(path)
    assert sp.Matrix.load(path).certified("windows-chromium")
    path.write_text('{"records": [{"platform": "ipad-safari", "check": "soak_6h", '
                    '"result": "passed"}]}', encoding="utf-8")
    with pytest.raises(sp.CertificationError):
        sp.Matrix.load(path)


# ---- AV-0433-02: scoped zones ------------------------------------------------------------------


def _venue(zones: int = 2, ttl: float = 2.0) -> ZoneDirectory:
    directory = ZoneDirectory("venue-1", LeaseTable(ttl_s=ttl), entitled_zones=zones)
    directory.define("bar", "Bar")
    directory.assign("bar", Speaker("bar-a", "Bar left"))
    directory.assign("bar", Speaker("bar-b", "Bar right"))
    if zones > 1:
        directory.define("terrace", "Terrace")
        directory.assign("terrace", Speaker("ter-a", "Terrace"))
    return directory


def test_zones_are_scoped_by_entitlement_and_own_their_speakers():
    one = ZoneDirectory("venue-x", LeaseTable())
    one.define("main", "Main room")
    with pytest.raises(ZoneError, match="may have 1 zone"):
        one.define("patio", "Patio")
    directory = _venue()
    with pytest.raises(ZoneError, match="already in Bar"):
        directory.assign("terrace", Speaker("bar-a", "Bar left"))
    with pytest.raises(ZoneError):
        directory.define("Bad Id!", "x")
    directory.assign("terrace", Speaker("phone", "Manager phone", can_play_audio=False))
    with pytest.raises(NotASpeaker):
        directory.start("terrace", "phone", 0.0)
    directory.start("bar", "bar-a", 0.0)
    directory.start("terrace", "ter-a", 0.0)
    assert directory.playing(0.5) == {"bar": "bar-a", "terrace": "ter-a"}
    with pytest.raises(ZoneError, match="Move the music"):
        directory.unassign("bar", "bar-a", 0.5)


def test_zones_need_their_flag():
    flags.use("autopilot.venue_mode venue.continuity")
    with pytest.raises(flags.FlagOff):
        ZoneDirectory("v", LeaseTable()).define("bar", "Bar")


# ---- AV-0433-03: transfer and reconnection -----------------------------------------------------


def test_transfer_fences_old_speaker_and_resumes_from_position():
    directory = _venue()
    start = directory.start("bar", "bar-a", 0.0)
    directory.confirm("bar", start.token, "song-1", 30.0, 1.0)
    moved = directory.transfer("bar", "bar-b", 2.0)
    assert moved.from_speaker == "bar-a" and moved.resume_song == "song-1"
    assert moved.resume_at_s == pytest.approx(31.0)
    with pytest.raises(StaleLease):
        directory.confirm("bar", start.token, "song-1", 32.0, 2.5)  # old speaker refused
    with pytest.raises(ZoneError, match="already playing"):
        directory.transfer("bar", "bar-b", 2.6)
    plays = [Play("song-1", 0.0, 2.0, "bar-a", "bar"),
             Play("song-1", 2.0, 60.0, "bar-b", "bar", resumed=True)]
    report = evaluate(plays, 0.0, 60.0, zones=["bar"])
    assert not report.overlaps and not report.duplicates and not report.gaps


def test_dropped_speaker_reconnects_and_resumes_where_it_stopped():
    directory = _venue(ttl=2.0)
    start = directory.start("bar", "bar-a", 0.0)
    directory.confirm("bar", start.token, "song-2", 40.0, 1.0)
    directory.drop("bar-a", 1.5)
    back = directory.reconnect("bar-a", 2.5)
    assert back is not None and back.kind == "reconnect"
    assert back.token > start.token and back.resume_at_s == pytest.approx(40.0)
    with pytest.raises(StaleLease):
        directory.confirm("bar", start.token, "song-2", 41.0, 2.6)
    directory.confirm("bar", back.token, "song-2", 41.0, 2.6)


def test_failover_then_returning_speaker_stays_quiet():
    directory = _venue(ttl=2.0)
    start = directory.start("bar", "bar-a", 0.0)
    directory.confirm("bar", start.token, "song-3", 10.0, 0.5)
    directory.drop("bar-a", 1.0)
    assert directory.failover("bar", 1.5) is None  # lease still live: wait for it to lapse
    moved = directory.failover("bar", 3.0)
    assert moved is not None and moved.to_speaker == "bar-b" and moved.kind == "failover"
    assert moved.resume_at_s == pytest.approx(10.0)
    assert directory.reconnect("bar-a", 4.0) is None  # bar-b plays; bar-a stays silent
    assert directory.playing(4.0) == {"bar": "bar-b"}
    kinds = [h.kind for h in directory.history]
    assert kinds == ["start", "failover"]


# ---- AV-0433-04: offline rights ----------------------------------------------------------------


def _licence(**overrides) -> Licence:
    base = dict(licence_id="L1", song_id="s1", venue_id="venue-1", cleared=True,
                allows_offline=True, expires_at=10_000.0)
    base.update(overrides)
    return Licence(**base)


def test_offline_copy_needs_cleared_offline_licence(tmp_path):
    original = tmp_path / "library" / "s1.flac"
    original.parent.mkdir()
    original.write_bytes(b"fLaC" + b"\x00" * 100)
    store = OfflineStore("venue-1", tmp_path / "offline")
    for licence, reason in [
        (None, "no licence"),
        (_licence(cleared=False), "not cleared"),
        (_licence(allows_offline=False), "does not allow offline"),
        (_licence(venue_id="venue-2"), "different venue"),
        (_licence(expires_at=5.0), "expired"),
        (_licence(revoked=True), "withdrawn"),
    ]:
        with pytest.raises(OfflineRefused, match=reason):
            store.keep_offline("s1", original, licence, now=10.0)
    assert not store.copies


def test_offline_copy_expires_and_withdraws_without_touching_original(tmp_path):
    original = tmp_path / "s1.flac"
    data = b"fLaC" + b"\x01" * 100
    original.write_bytes(data)
    store = OfflineStore("venue-1", tmp_path / "offline")
    copy = store.keep_offline("s1", original, _licence(), now=0.0)
    assert copy.path.parent == tmp_path / "offline" and copy.path != original
    assert copy.expires_at == 10_000.0
    assert store.playable("s1", 9_999.0) == copy.path
    assert store.playable("s1", 10_000.0) is None
    assert store.expire(10_001.0) == ["s1"] and not copy.path.exists()
    long = _licence(licence_id="L2", expires_at=10**9)
    again = store.keep_offline("s1", original, long, now=0.0)
    assert again.expires_at == 30 * 86400.0  # capped, must be re-checked
    assert store.withdraw("L2") == ["s1"] and not again.path.exists()
    third = store.keep_offline("s1", original, long, now=0.0)
    assert store.recheck({"L2": _licence(licence_id="L2", cleared=False)}, now=1.0) == ["s1"]
    assert not third.path.exists()
    assert original.read_bytes() == data
    assert hashlib.sha256(original.read_bytes()).hexdigest() == copy.sha256


# ---- AV-0433-05 and AV-0429-05: published runbooks ---------------------------------------------


def test_soundcheck_runbook_and_soak_protocol_are_published():
    runbook = (ROOT / "docs/autopilot/venue-soundcheck-runbook.md").read_text(encoding="utf-8")
    for heading in ("## 6. Only one speaker plays", "## 7. Network drop rehearsal",
                    "## 8. Reconnect rehearsal", "## Soundcheck sheet", "## Rolling back"):
        assert heading in runbook
    soak = (ROOT / "docs/autopilot/six-hour-soak-protocol.md").read_text(encoding="utf-8")
    from selecta.venueops.continuity import SLOS

    for slo in SLOS:
        assert f"`{slo.id}`" in soak
    assert "Speaker hardware (exact)" in soak and "person step" in soak
    for text in (runbook, soak):
        assert "—" not in text
