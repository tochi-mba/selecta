"""Local cache care: eviction never costs the current mix, orphans and crash leftovers go, and the
tidy does nothing with `workspace.cache_care` off."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from selecta import cache_care, db, flags, stems
from selecta.config import Settings
from selecta.seams import SeamRequest

DAY = 24 * 60 * 60


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    found = Settings(tmp_path / "home")
    found.ensure_dirs()
    return found


def _age(path: Path, seconds: float) -> None:
    moment = time.time() - seconds
    targets = [path, *path.rglob("*")] if path.is_dir() else [path]
    for target in targets:
        os.utime(target, (moment, moment))


def _seam(settings: Settings, request: SeamRequest, key: str | None = None, size: int = 1000):
    folder = settings.renders_dir / "seams" / (key or request.key)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "clip.flac").write_bytes(os.urandom(size))
    state = {"status": "ready", "key": folder.name, "request": asdict(request)}
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")
    return folder


def _window(settings: Settings, source: Path, start: float = 10.0, length: float = 46.0) -> Path:
    folder = stems._window_folder(settings, source, start, length)
    folder.mkdir(parents=True, exist_ok=True)
    for name in cache_care.STEM_NAMES:
        (folder / f"{name}.wav").write_bytes(b"\0" * 1000)
    marker = {"source": str(source.resolve()), "start": start, "duration": length}
    (folder / "window.json").write_text(json.dumps(marker), "utf-8")
    return folder


def _library(settings: Settings, song_ids: list[int]) -> None:
    conn = db.connect(settings.db_path)
    for song_id in song_ids:
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song_id, f"x{song_id}.flac", ".", 1, 0.0, 200.0),
        )
    conn.commit()
    conn.close()


def _cap(monkeypatch, settings: Settings, cap: int) -> None:
    monkeypatch.setattr(Settings, "effective_cache_cap_bytes", property(lambda _self: cap))
    monkeypatch.setattr(stems, "largest_cache_bytes", lambda _settings: cap)


# --- eviction -----------------------------------------------------------------------------------


def test_eviction_goes_oldest_first_but_never_takes_the_current_mix(settings, monkeypatch):
    playing = _seam(settings, SeamRequest(1, 2))
    older = _seam(settings, SeamRequest(3, 4))
    newer = _seam(settings, SeamRequest(5, 6))
    _age(playing, 3 * DAY)  # the mix's seam is the oldest of all
    _age(older, 2 * DAY)
    _age(newer, 1 * DAY)
    cache_care.remember_protected(settings, {playing.name})
    _cap(monkeypatch, settings, 2600)  # room for two of the three
    stems.prune_cache(settings)  # as the storage page does, naming nothing to keep
    assert playing.is_dir()
    assert not older.exists()
    assert newer.is_dir()


def test_a_lower_limit_keeps_the_mix_even_when_it_alone_is_over(settings, monkeypatch):
    playing = [_seam(settings, SeamRequest(n, n + 1)) for n in (1, 3, 5)]
    spare = _seam(settings, SeamRequest(7, 8))
    cache_care.remember_protected(settings, {folder.name for folder in playing})
    _cap(monkeypatch, settings, 10)
    stems.prune_cache(settings)
    assert all(folder.is_dir() for folder in playing)
    assert not spare.exists()


def test_splitting_a_seams_second_window_keeps_its_first(settings, monkeypatch, tmp_path):
    source = tmp_path / "a.flac"
    source.write_bytes(b"audio")
    first = _window(settings, source, 10.0)
    _age(first, DAY)
    stems._hold(first.name)
    second = _window(settings, source, 90.0)
    _cap(monkeypatch, settings, 4500)
    stems.prune_cache(settings, {second.name})
    assert first.is_dir() and second.is_dir()
    stems._held.clear()
    stems.prune_cache(settings, {second.name})
    assert not first.exists()


def test_a_seam_heard_recently_outlasts_one_written_later(settings, monkeypatch):
    heard = _seam(settings, SeamRequest(1, 2))
    unheard = _seam(settings, SeamRequest(3, 4))
    _age(heard, 2 * DAY)
    _age(unheard, 1 * DAY)
    stems.mark_used(heard / "clip.flac")
    _cap(monkeypatch, settings, 1500)
    stems.prune_cache(settings)
    assert heard.is_dir()
    assert not unheard.exists()


def test_protected_keys_survive_a_broken_record(settings):
    cache_care.remember_protected(settings, {"abc"})
    assert cache_care.protected_keys(settings) == {"abc"}
    (settings.renders_dir / cache_care.PROTECTED_FILE).write_text("{not json", "utf-8")
    assert cache_care.protected_keys(settings) == set()


# --- orphans ------------------------------------------------------------------------------------


def test_orphans_go_and_everything_still_reachable_stays(settings, tmp_path):
    _library(settings, [1, 2])
    for song_id in (1, 3):
        np.savez_compressed(settings.features_dir / f"{song_id}.npz", beats=np.arange(4))
    kept = _seam(settings, SeamRequest(1, 2))
    gone_song = _seam(settings, SeamRequest(1, 3))
    old_engine = _seam(settings, SeamRequest(2, 1), key="0123456789abcdef0123")
    playing_but_gone = _seam(settings, SeamRequest(2, 3, move="cut_on_one"))
    cache_care.remember_protected(settings, {playing_but_gone.name})
    source = tmp_path / "song.flac"
    source.write_bytes(b"audio")
    current = _window(settings, source, 10.0)
    changed = _window(settings, source, 50.0)
    missing_source = tmp_path / "gone.flac"
    missing_source.write_bytes(b"audio")
    missing = _window(settings, missing_source, 10.0)
    missing_source.unlink()
    for folder in (current, changed, missing):
        _age(folder, 2 * cache_care.CRASH_GRACE_S)
    os.utime(source, (time.time() + 60, time.time() + 60))  # edited: only new windows match
    current_after_edit = _window(settings, source, 10.0)
    _age(current_after_edit, 2 * cache_care.CRASH_GRACE_S)

    swept = cache_care.tidy(settings)

    assert (settings.features_dir / "1.npz").exists()
    assert not (settings.features_dir / "3.npz").exists()
    assert kept.is_dir()
    assert not gone_song.exists()
    assert not old_engine.exists()
    assert playing_but_gone.is_dir()
    assert not current.exists() and not changed.exists() and not missing.exists()
    assert current_after_edit.is_dir()
    assert swept.removed["seam of a removed song"] == 1
    assert swept.removed["seam from an older engine"] == 1
    assert swept.removed["features of a removed song"] == 1
    assert swept.freed_bytes > 0


def test_stems_nobody_used_for_two_weeks_go(settings, tmp_path):
    source = tmp_path / "song.flac"
    source.write_bytes(b"audio")
    stale = _window(settings, source, 10.0)
    fresh = _window(settings, source, 50.0)
    held = _window(settings, source, 90.0)
    _age(stale, 15 * DAY)
    _age(fresh, 2 * DAY)
    _age(held, 15 * DAY)
    cache_care.remember_protected(settings, {held.name})
    cache_care.tidy(settings)
    assert not stale.exists()
    assert fresh.is_dir() and held.is_dir()


# --- crash leftovers ----------------------------------------------------------------------------


def test_crash_leftovers_go_once_nothing_can_still_be_writing_them(settings):
    exports = settings.home / "exports"
    exports.mkdir()
    old_part = exports / "mix.flac.part"
    new_part = exports / "other.flac.part"
    finished = exports / "mix.flac"
    for path in (old_part, new_part, finished):
        path.write_bytes(b"x" * 100)
    history = settings.home / "seam-history"
    history.mkdir()
    old_tmp = history / "tmpabc.tmp"
    old_tmp.write_text("{", "utf-8")
    unfinished = settings.home / "stems" / "deadbeef"
    (unfinished / "htdemucs" / "window").mkdir(parents=True)
    (unfinished / "window.wav").write_bytes(b"x" * 100)
    (unfinished / "htdemucs" / "window" / "vocals.wav").write_bytes(b"x" * 100)
    unrecorded = settings.renders_dir / "seams" / "feedface"
    unrecorded.mkdir(parents=True)
    (unrecorded / "preview.flac").write_bytes(b"x" * 100)
    half_clip = _seam(settings, SeamRequest(1, 2)) / "clip.flac.part"
    half_clip.write_bytes(b"x" * 100)
    for path in (old_part, finished, old_tmp, unfinished, unrecorded, half_clip):
        _age(path, 2 * cache_care.CRASH_GRACE_S)

    swept = cache_care.tidy(settings)

    assert not old_part.exists() and not old_tmp.exists() and not half_clip.exists()
    assert new_part.exists(), "a write still in progress must be left alone"
    assert finished.exists()
    assert not unfinished.exists()
    assert not unrecorded.exists()
    assert swept.removed["crash leftover"] == 3
    assert swept.removed["unfinished stem window"] == 1


def test_a_finished_window_keeps_its_stems_and_loses_the_spent_excerpt(settings, tmp_path):
    source = tmp_path / "song.flac"
    source.write_bytes(b"audio")
    window = _window(settings, source)
    (window / "window.wav").write_bytes(b"x" * 100)
    _age(window, 2 * cache_care.CRASH_GRACE_S)
    (window / "window.json").touch()  # used just now
    cache_care.tidy(settings)
    assert not (window / "window.wav").exists()
    assert all((window / f"{name}.wav").exists() for name in cache_care.STEM_NAMES)


def test_atomic_clip_writes_leave_no_partial_file(tmp_path):
    target = tmp_path / "clip.flac"
    target.write_bytes(b"old")
    audio = np.zeros((4410, 2), dtype=np.float32)
    cache_care.write_flac_atomically(target, audio, 44100)
    assert sf.info(target).frames == 4410
    assert not (tmp_path / "clip.flac.part").exists()


def test_band_is_written_whole(tmp_path):
    folder = tmp_path / "w"
    folder.mkdir()
    tone = np.full((441, 2), 0.25, dtype=np.float32)
    parts = {}
    for name in cache_care.STEM_NAMES:
        parts[name] = folder / f"{name}.wav"
        sf.write(parts[name], tone, 44100, subtype="PCM_16")
    band = stems.band_of(stems.StemWindow(**parts))
    assert band.name == "band.wav"
    assert not (folder / "band.wav.part").exists()
    assert np.allclose(sf.read(band, dtype="float32")[0], 0.75, atol=1e-3)


# --- duplicates and the database ----------------------------------------------------------------


def test_identical_clips_share_one_copy_and_count_once(settings):
    one = _seam(settings, SeamRequest(1, 2))
    two = _seam(settings, SeamRequest(1, 2, soft=True))
    other = _seam(settings, SeamRequest(3, 4))
    (two / "clip.flac").write_bytes((one / "clip.flac").read_bytes())
    before = stems.cache_bytes(settings)
    swept = cache_care.tidy(settings)
    assert swept.linked == 1
    assert os.path.samefile(one / "clip.flac", two / "clip.flac")
    assert not os.path.samefile(one / "clip.flac", other / "clip.flac")
    assert stems.cache_bytes(settings) == before - 1000
    # rewriting one seam's clip leaves the other's alone
    cache_care.write_flac_atomically(two / "clip.flac", np.zeros((441, 2)), 44100)
    assert len((one / "clip.flac").read_bytes()) == 1000


def test_a_library_with_much_free_space_is_compacted_once(settings):
    conn = db.connect(settings.db_path)
    conn.execute("CREATE TABLE filler(x BLOB)")
    conn.executemany("INSERT INTO filler VALUES(?)", [(os.urandom(4000),) for _ in range(4000)])
    conn.commit()
    conn.execute("DELETE FROM filler")
    conn.commit()
    conn.close()
    before = settings.db_path.stat().st_size
    report = cache_care.tidy_database(settings.db_path)
    assert report.get("vacuumed") is True
    assert report["bytes_after"] < before / 4
    with sqlite3.connect(settings.db_path) as check:
        assert check.execute("PRAGMA auto_vacuum").fetchone()[0] == cache_care.INCREMENTAL
        assert check.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert check.execute("SELECT count(*) FROM songs").fetchone()[0] == 0


def test_a_library_already_incremental_hands_back_every_free_page(settings):
    """PRAGMA incremental_vacuum frees one page per step, so its result has to be read whole."""
    conn = db.connect(settings.db_path)
    conn.execute("CREATE TABLE filler(x BLOB)")
    conn.executemany("INSERT INTO filler VALUES(?)", [(os.urandom(4000),) for _ in range(4000)])
    conn.commit()
    conn.execute("DELETE FROM filler")
    conn.commit()
    conn.close()
    cache_care.tidy_database(settings.db_path)  # compacted once, now incremental
    conn = sqlite3.connect(settings.db_path)
    conn.executemany("INSERT INTO filler VALUES(?)", [(os.urandom(4000),) for _ in range(500)])
    conn.commit()
    conn.execute("DELETE FROM filler")
    conn.commit()
    assert conn.execute("PRAGMA freelist_count").fetchone()[0] > 100
    conn.close()
    cache_care.tidy_database(settings.db_path)
    with sqlite3.connect(settings.db_path) as check:
        assert check.execute("PRAGMA freelist_count").fetchone()[0] == 0


# --- the flag -----------------------------------------------------------------------------------


def test_with_the_flag_off_nothing_is_tidied(settings):
    flags.use(f"-{cache_care.FLAG}")
    _library(settings, [1])
    np.savez_compressed(settings.features_dir / "9.npz", beats=np.arange(4))
    orphan = _seam(settings, SeamRequest(1, 9))
    leftover = settings.home / "stems" / "deadbeef"
    leftover.mkdir(parents=True)
    (leftover / "window.wav").write_bytes(b"x")
    _age(leftover, 2 * cache_care.CRASH_GRACE_S)
    swept = cache_care.tidy(settings)
    assert swept.removed == {} and swept.linked == 0
    assert orphan.is_dir() and leftover.is_dir()
    assert (settings.features_dir / "9.npz").exists()
