"""The feel system's local-app gaps (ADR-0477, ADR-0478): the cover cache tidy, the finished
file's measured outline and the scan's real progress."""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from selecta import cache_care, db
from selecta.config import SAMPLE_RATE, Settings
from selecta.export_validation import SHAPE_POINTS, verify_export
from selecta.library import art
from selecta.library.scan import scan_folder


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    found = Settings(tmp_path / "home")
    found.ensure_dirs()
    return found


def _old(path: Path) -> None:
    moment = time.time() - cache_care.CRASH_GRACE_S * 2
    os.utime(path, (moment, moment))


def _kept_cover(settings: Settings, key: str, sha: str) -> tuple[Path, Path]:
    root = settings.home / "art" / art.VERSION
    (root / "files").mkdir(parents=True, exist_ok=True)
    (root / "pictures").mkdir(parents=True, exist_ok=True)
    marker = root / "files" / key
    marker.write_text(f"{sha} image/jpeg", "ascii")
    picture = root / "pictures" / f"{sha}.jpg"
    picture.write_bytes(b"\xff\xd8\xff" + b"\0" * 64)
    return marker, picture


def test_covers_of_files_that_left_go_and_those_still_in_the_library_stay(settings, tmp_path):
    song = tmp_path / "song.flac"
    song.write_bytes(b"\0" * 10)
    stat = song.stat()
    conn = db.connect(settings.db_path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(1,?,?,?,?,200.0)",
        (str(song), ".", stat.st_size, stat.st_mtime),
    )
    conn.commit()
    live_marker, live_picture = _kept_cover(
        settings, art.file_key(str(song), stat.st_size, stat.st_mtime), "a" * 64
    )
    gone_marker, gone_picture = _kept_cover(settings, "f" * 64, "b" * 64)
    fresh_marker, fresh_picture = _kept_cover(settings, "e" * 64, "c" * 64)
    for path in (live_marker, live_picture, gone_marker, gone_picture):
        _old(path)
    swept = cache_care.Swept()
    cache_care._old_covers(settings, conn, time.time(), swept)
    conn.close()
    assert live_marker.exists() and live_picture.exists()
    assert not gone_marker.exists() and not gone_picture.exists()
    # anything younger than the grace period may still be being written by a scan
    assert fresh_marker.exists() and fresh_picture.exists()
    assert swept.removed == {"cover of a file that changed or left": 1, "cover no song uses": 1}


def test_an_unplugged_drive_keeps_its_covers(settings):
    conn = db.connect(settings.db_path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(1,?,?,?,?,200.0)",
        ("Z:/away/song.flac", ".", 10, 12345.5),
    )
    conn.commit()
    key = art.file_key("Z:/away/song.flac", 10, 12345.5)
    marker, picture = _kept_cover(settings, key, "d" * 64)
    _old(marker)
    _old(picture)
    cache_care._old_covers(settings, conn, time.time(), cache_care.Swept())
    conn.close()
    assert marker.exists() and picture.exists()


def test_the_verified_file_gives_its_own_outline(tmp_path):
    frames = SAMPLE_RATE * 2
    rising = np.linspace(0, 0.8, frames)[:, None].repeat(2, 1)
    path = tmp_path / "mix.flac"
    sf.write(path, rising, SAMPLE_RATE, subtype="PCM_16", format="FLAC")
    shape: list[float] = []
    verify_export(path, frames / SAMPLE_RATE, shape)
    assert len(shape) == SHAPE_POINTS
    assert shape[0] < 0.05 and abs(shape[-1] - 0.8) < 0.01
    assert all(before <= after for before, after in zip(shape, shape[1:], strict=False))


def test_scan_progress_is_told_real_counts_and_a_failing_listener_never_stops_it(tmp_path):
    folder = tmp_path / "music"
    folder.mkdir()
    (folder / "notes.txt").write_text("not music", "utf-8")
    conn = db.connect(tmp_path / "library.sqlite")
    heard: list[tuple[int, int]] = []

    def listen(done: int, found: int) -> None:
        heard.append((done, found))
        raise RuntimeError("a broken display")

    report = scan_folder(conn, folder, progress=listen)
    conn.close()
    assert report.found == 0
    assert heard and all(found == 0 and done == 0 for done, found in heard)
