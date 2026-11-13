"""ADR-0449 BZ-0449-07: ISRC read from tags, manual entry with audit, coverage per venue."""

from __future__ import annotations

import importlib.util
import struct

import pytest

from selecta.business import isrc, playlog
from selecta.business.commercial_audit import audit_rows
from selecta.business.commercial_facts import OrgFacts, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES
from selecta.persistence import make_engine, metadata

HAS_MUTAGEN = importlib.util.find_spec("mutagen") is not None
T0 = 1_780_000_000.0
ORG = OrgFacts("org1", "ws1", "Bar Group", venues=(VenueFacts("v1", "Soho"),
                                                    VenueFacts("v2", "Leeds")))


@pytest.fixture()
def conn(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


@pytest.mark.parametrize(("raw", "expected"), [
    ("GB-ABC-26-00001", "GBABC2600001"),
    ("gbabc2600001", "GBABC2600001"),
    (" US-S1Z-99-00001 ", "USS1Z9900001"),
    (b"FRZ039800212", "FRZ039800212"),
    ("ISRC:GBABC2600001", "GBABC2600001"),
    ("GB-ABC-26-0001", None),
    ("1BABC2600001", None),
    ("GBABC26000012", None),
    ("", None),
    (None, None),
])
def test_normalise(raw, expected):
    assert isrc.normalise(raw) == expected


def test_display_format():
    assert isrc.display("GBABC2600001") == "GB-ABC-26-00001"
    with pytest.raises(isrc.InvalidIsrc):
        isrc.display("nope")


class _Frame:
    def __init__(self, text):
        self.text = text


def test_read_from_tag_mappings():
    assert isrc.read_from_tags({"TSRC": _Frame(["GBABC2600001"])}) == "GBABC2600001"
    assert isrc.read_from_tags({"isrc": ["usabc9900002"]}) == "USABC9900002"
    assert isrc.read_from_tags(
        {"----:com.apple.iTunes:ISRC": [b"DEABC0500003"]}) == "DEABC0500003"
    assert isrc.read_from_tags({"TSRC": _Frame(["junk"]), "isrc": ["GBABC2600004"]}) \
        == "GBABC2600004"
    assert isrc.read_from_tags({"title": ["x"]}) is None
    assert isrc.read_from_tags(None) is None


def _silent_wav(path):
    data = b"\x00\x00" * 800
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(data))
    path.write_bytes(header + data)


@pytest.mark.skipif(not HAS_MUTAGEN, reason="mutagen not installed")
def test_read_from_tagged_fixture_files(tmp_path):
    from mutagen.id3 import ID3, TSRC
    from mutagen.wave import WAVE

    mp3 = tmp_path / "tagged.mp3"
    tags = ID3()
    tags.add(TSRC(encoding=3, text=["GB-ABC-26-00001"]))
    tags.save(str(mp3))
    # An ID3 tag on its own is enough for mutagen's ID3 reader.
    assert isrc.read_from_tags(ID3(str(mp3))) == "GBABC2600001"

    wav = tmp_path / "tagged.wav"
    _silent_wav(wav)
    audio = WAVE(str(wav))
    audio.add_tags()
    audio.tags.add(TSRC(encoding=3, text=["USABC9900002"]))
    audio.save()
    assert isrc.read_from_file(wav) == "USABC9900002"

    plain = tmp_path / "plain.wav"
    _silent_wav(plain)
    assert isrc.read_from_file(plain) is None
    assert isrc.read_from_file(tmp_path / "missing.mp3") is None


def test_tag_read_recorded_once(conn):
    assert isrc.record_tag_isrc(conn, "ws1", "t1", {"isrc": ["GBABC2600001"]}, actor="up1",
                                now=T0) == "GBABC2600001"
    isrc.record_tag_isrc(conn, "ws1", "t1", {"isrc": ["GBABC2600001"]}, actor="up1", now=T0)
    history = isrc.edit_history(conn, "ws1", "t1")
    assert len(history) == 1 and history[0]["source"] == "tag"


def test_manual_entry_audited_and_validated(conn):
    with pytest.raises(isrc.InvalidIsrc):
        isrc.set_manual(conn, workspace_id="ws1", organisation_id="org1", track_id="t1",
                        isrc="bad", actor="owner1", now=T0)
    isrc.record_tag_isrc(conn, "ws1", "t1", {"TSRC": _Frame(["GBABC2600001"])}, actor="up1",
                         now=T0)
    edit = isrc.set_manual(conn, workspace_id="ws1", organisation_id="org1", track_id="t1",
                           isrc="GB-ABC-26-00009", actor="owner1", now=T0 + 1)
    assert edit["old_isrc"] == "GBABC2600001" and edit["new_isrc"] == "GBABC2600009"
    assert isrc.current_isrc(conn, "ws1", "t1") == "GBABC2600009"
    assert isrc.set_manual(conn, workspace_id="ws1", organisation_id="org1", track_id="t1",
                           isrc="GBABC2600009", actor="owner1", now=T0 + 2) is None
    rows = audit_rows(conn, "org1", "isrc.edited")
    assert len(rows) == 1 and rows[0]["detail"]["old_isrc"] == "GBABC2600001"


def test_coverage_per_venue(conn):
    def play(n, venue, track, code):
        return {"idempotency_key": f"{venue}-{n}", "zone_id": "z", "track_id": track,
                "title": track, "artist": "A", "isrc": code, "started_at": T0 + n,
                "seconds_played": 10, "source": "schedule"}

    playlog.append(conn, ORG, "v1", [play(1, "v1", "a", "GBABC2600001"),
                                     play(2, "v1", "a", None),
                                     play(3, "v1", "b", None),
                                     play(4, "v1", "c", None),
                                     play(5, "v1", "d", "GBABC2600002")], now=T0)
    playlog.append(conn, ORG, "v2", [play(1, "v2", "b", None)], now=T0)
    cov = isrc.coverage(conn, "ws1", "org1", "v1")
    assert (cov.tracks, cov.with_isrc, cov.share) == (4, 2, 0.5)
    isrc.set_manual(conn, workspace_id="ws1", organisation_id="org1", track_id="b",
                    isrc="GBABC2600003", actor="owner1", now=T0)
    assert isrc.coverage(conn, "ws1", "org1", "v1").with_isrc == 3
    assert isrc.coverage(conn, "ws1", "org1", "v2").share == 1.0
    assert isrc.coverage(conn, "ws1", "org1", "v1", start=T0 + 10).tracks == 0
