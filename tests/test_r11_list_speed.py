"""r11: the caches behind a quicker My Mixes list never change an answer.

A seam's key names its files on disk, so it stays byte for byte what it always was. A seam record
read from the memo is never older than the file. The cache walk counts what it always counted, and
a held job clock answers one request without hiding other writers from later ones."""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, replace

import pytest

from selecta import seam_kinds, seam_records, stems
from selecta.config import ANALYSIS_VERSION
from selecta.eta import JobClock
from selecta.seam_kinds import RENDER_VERSION, SeamRequest


def _old_key(request: SeamRequest) -> str:
    """The key exactly as it was worked out before r11."""
    fields = asdict(request)
    for name in ("shape", "leave_after"):
        if fields[name] is None:
            del fields[name]
    text = json.dumps([fields, ANALYSIS_VERSION, RENDER_VERSION], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


REQUESTS = [
    SeamRequest(1, 2),
    SeamRequest(5, 9, "cut_on_one", 8, 64, 1, "chorus", True),
    SeamRequest(3, 4, shape="v:a,b"),
    SeamRequest(3, 4, leave_after=12.5),
    SeamRequest(3, 4, leave_after=12),
    SeamRequest(3, 4, leave_after=0.0),
    SeamRequest(3, 4, leave_after=-0.0),
    SeamRequest(3, 4, bars=1),
    SeamRequest(3, 4, bars=True),
    SeamRequest(2, 1, move="stem_studio", exit_bar=0, entry_bar=0),
]


def test_keys_are_byte_for_byte_the_old_ones():
    # pinned too, so a change to the old computation itself can't slip by
    assert SeamRequest(1, 2).key == "c9dbccae51a011224ec1"
    assert SeamRequest(5, 9, "cut_on_one", 8, 64, 1, "chorus", True).key == "87e3a6e4135bc8b65068"
    assert SeamRequest(3, 4, shape="v:a,b").key == "c26ac5e7f4aa2ade84a1"
    assert SeamRequest(3, 4, leave_after=12.5).key == "e597c2e135ba193174cc"
    seam_kinds._KEYS.clear()
    for request in REQUESTS:
        assert request.key == _old_key(request), request
    # again: from the memo, from a rebuilt request, and from the instance itself
    for request in REQUESTS:
        rebuilt = replace(request)
        assert rebuilt.key == request.key == _old_key(request), request


def test_equal_requests_that_json_writes_differently_keep_their_own_keys():
    assert SeamRequest(3, 4, leave_after=12).key != SeamRequest(3, 4, leave_after=12.0).key
    assert SeamRequest(3, 4, bars=1).key != SeamRequest(3, 4, bars=True).key
    assert SeamRequest(3, 4, leave_after=0.0).key != SeamRequest(3, 4, leave_after=-0.0).key


def test_the_kept_key_is_invisible_to_equality_and_fields():
    request = SeamRequest(7, 8, "cut_on_one")
    fresh = SeamRequest(7, 8, "cut_on_one")
    assert request.key
    assert request == fresh and hash(request) == hash(fresh)
    assert "_key" not in asdict(request)


def test_the_key_memo_stays_bounded(monkeypatch):
    monkeypatch.setattr(seam_kinds, "_KEYS_KEPT", 5)
    seam_kinds._KEYS.clear()
    for a in range(20):
        assert SeamRequest(a, a + 1).key == _old_key(SeamRequest(a, a + 1))
    assert len(seam_kinds._KEYS) <= 5


@pytest.fixture
def settled(monkeypatch):
    """Records count as settled at once, so the memo can be seen at work."""
    seam_records.forget_all()
    monkeypatch.setattr(seam_records, "SETTLED_NS", -(10**18))
    yield
    seam_records.forget_all()


def _write(path, state):
    path.write_text(json.dumps(state), "utf-8")


def test_a_record_is_parsed_once_and_each_reader_gets_its_own_copy(tmp_path, settled, monkeypatch):
    meta = tmp_path / "seam.json"
    _write(meta, {"status": "ready", "key": "k", "request": {"a": 1}})
    first = seam_records.read_seam_record(meta)
    calls = []
    real = json.loads
    monkeypatch.setattr(seam_records.json, "loads", lambda text: calls.append(1) or real(text))
    second = seam_records.read_seam_record(meta)
    assert first == second and not calls
    second["status"] = "changed"
    assert seam_records.read_seam_record(meta)["status"] == "ready"


def test_a_changed_or_removed_record_never_reads_stale(tmp_path, settled):
    meta = tmp_path / "seam.json"
    _write(meta, {"status": "queued", "key": "k"})
    assert seam_records.read_seam_record(meta)["status"] == "queued"
    # same size, same modified time: only the file id can tell (a record swapped in whole)
    stamp = meta.stat().st_mtime_ns
    other = tmp_path / "other.json"
    _write(other, {"status": "failed", "key": "k"})
    os.utime(other, ns=(stamp, stamp))
    os.replace(other, meta)
    assert seam_records.read_seam_record(meta)["status"] == "failed"
    # rewritten in place with a new size
    _write(meta, {"status": "ready", "key": "k", "rating": "good"})
    assert seam_records.read_seam_record(meta)["status"] == "ready"
    meta.unlink()
    assert seam_records.read_seam_record(meta) is None
    meta.write_text("{half a rec", "utf-8")
    assert seam_records.read_seam_record(meta) is None


def test_a_record_written_just_now_is_never_kept(tmp_path):
    """The disk's clock moves in steps, so a same-size rewrite moments later could share a stamp.
    Until a record has settled, every look reads it again."""
    seam_records.forget_all()
    meta = tmp_path / "seam.json"
    _write(meta, {"status": "queued", "key": "k"})
    stamp = meta.stat().st_mtime_ns
    assert seam_records.read_seam_record(meta)["status"] == "queued"
    _write(meta, {"status": "failed", "key": "k"})  # same size as "queued"
    os.utime(meta, ns=(stamp, stamp))
    assert seam_records.read_seam_record(meta)["status"] == "failed"
    assert os.fspath(meta) not in seam_records._records


def test_the_record_memo_stays_bounded(tmp_path, settled, monkeypatch):
    monkeypatch.setattr(seam_records, "KEPT", 3)
    for n in range(10):
        meta = tmp_path / f"{n}.json"
        _write(meta, {"status": "ready", "key": str(n)})
        assert seam_records.read_seam_record(meta)["key"] == str(n)
    assert len(seam_records._records) <= 3


def _old_window_dirs(root):
    """The cache walk exactly as it was before r11."""
    found = []
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        stats = [p.stat() for p in folder.rglob("*") if p.is_file()]
        if not stats:
            continue
        size = sum(stat.st_size // max(stat.st_nlink, 1) for stat in stats)
        marker = folder / "window.json"
        if marker.exists():
            touched = marker.stat().st_mtime
        else:
            touched = max(max(stat.st_atime, stat.st_mtime) for stat in stats)
        found.append((folder, size, touched))
    return sorted(found)


def test_the_cache_walk_counts_what_it_always_counted(tmp_path):
    root = tmp_path / "cache"
    (root / "plain").mkdir(parents=True)
    (root / "plain" / "clip.flac").write_bytes(b"x" * 300)
    (root / "plain" / "seam.json").write_text("{}", "utf-8")
    nested = root / "marked" / "deeper" / "deepest"
    nested.mkdir(parents=True)
    (nested / "vocals.wav").write_bytes(b"v" * 1000)
    (root / "marked" / "window.json").write_text("{}", "utf-8")
    (root / "marked" / "deeper" / "window.json").write_text("{not the marker}", "utf-8")
    os.utime(root / "marked" / "window.json", (1_000_000, 1_000_000))
    (root / "empty" / "inside").mkdir(parents=True)
    (root / "stray.txt").write_text("not a window", "utf-8")
    linked = root / "linked"
    linked.mkdir()
    try:
        os.link(root / "plain" / "clip.flac", linked / "clip.flac")
    except OSError:
        pytest.skip("this disk can't make hard links")
    walked = sorted(stems._window_dirs(root))
    assert walked == _old_window_dirs(root)
    sizes = {folder.name: size for folder, size, _ in walked}
    assert sizes == {"plain": 152, "marked": 1018, "linked": 150}
    assert dict((f.name, t) for f, _, t in walked)["marked"] == 1_000_000


def test_a_held_clock_reads_once_and_lets_go_after(tmp_path, monkeypatch):
    clock = JobClock(tmp_path)
    clock.record("cut_on_one", 4.0)
    looks = []
    real = clock._on_disk
    monkeypatch.setattr(clock, "_on_disk", lambda: looks.append(1) or real())
    with clock.held():
        for _ in range(50):
            clock.estimate("cut_on_one")
        assert len(looks) == 1
        with clock.held():  # nested holds share the outer one
            clock.estimate("cut_on_one")
        assert len(looks) == 1
    # once let go, another writer's time is seen at once
    time.sleep(0.01)
    JobClock(tmp_path).record("cut_on_one", 8.0)
    assert clock.times()["cut_on_one"] == [4.0, 8.0]


def test_recording_while_held_never_drops_another_writers_time(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("cut_on_one", 4.0)
    with clock.held():
        JobClock(tmp_path).record("cut_on_one", 6.0)
        clock.record("cut_on_one", 8.0)
    assert clock.times()["cut_on_one"] == [4.0, 6.0, 8.0]
