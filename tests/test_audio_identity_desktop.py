"""Audio ids on a Desktop library (`library.audio_identity` with `core.engine_store`).

The library migration `lib0004audioid` meets an existing column and runs once; the hash job fills
the file hash and the audio id in one read, skips a file the system marks as not on this computer
(a cloud placeholder) or can't read, without marking it; a re-tagged file keeps its analysis and
correction, is not queued for analysis, and finds its features again under the same audio key;
with either flag off everything is as before. Synthetic files from the shared fixtures only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from selecta import db, flags
from selecta.analysis.pipeline import features_path, load_features
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.engine_store import library, song_hashes
from selecta.engine_store import songs as stored

FIXTURES = Path(__file__).parent / "fixtures" / "audio_identity"


def _fixture_bytes(name: str) -> bytes:
    """A fixture's bytes, which travel in the manifest: the repo ignores audio file names."""
    files = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))["files"]
    return base64.b64decode(next(entry["bytes"] for entry in files if entry["file"] == name))
MANIFEST = {
    entry["file"]: entry
    for entry in json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))["files"]
}
BOTH = "+core.engine_store"
NO_AUDIO = "+core.engine_store -library.audio_identity"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _song(settings: Settings, fixture: str, song_id: int = 1) -> Path:
    """A library with one analysed, corrected song whose file is a copy of `fixture`."""
    flags.use("")
    settings.features_dir.mkdir(parents=True, exist_ok=True)
    music = settings.home / "music"
    music.mkdir(exist_ok=True)
    file = music / f"{song_id}.mp3"
    file.write_bytes(_fixture_bytes(fixture))
    facts = file.stat()
    conn = db.connect(settings.db_path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, str(file), "music", facts.st_size, facts.st_mtime, 32.0, "Artist", "Old"),
    )
    db.save_analysis(conn, song_id, {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "8A"})
    conn.execute("INSERT INTO song_overrides(song_id,bpm,camelot) VALUES(?,124.0,'9A')", (song_id,))
    conn.commit()
    conn.close()
    np.savez_compressed(features_path(settings, song_id), peaks=np.arange(5, dtype=np.float32))
    return file


def _row(settings: Settings, song_id: int = 1) -> dict:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return dict(conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone())
    finally:
        conn.close()


def _start(settings: Settings) -> None:
    db._CHECKED.clear()
    db.connect(settings.db_path).close()


def test_the_migration_meets_an_existing_column_and_runs_once(home):
    _song(home, "mp3-a-id3.mp3")
    conn = sqlite3.connect(home.db_path)
    # as `recovery.recover` can leave a file: the column, but no index and no stamp for it
    conn.execute('ALTER TABLE songs ADD COLUMN "audio_id"')
    conn.execute("UPDATE songs SET audio_id='kept'")
    conn.commit()
    conn.close()
    flags.use(BOTH)
    _start(home)
    assert _row(home)["audio_id"] == "kept"
    # a later revision (lib0005provenance) may sit on top; this one must be in the chain
    assert library.bring_forward(home.db_path) == library.head()
    assert "lib0004audioid" in library.known()
    conn = sqlite3.connect(home.db_path)
    try:
        names = [row[1] for row in conn.execute("PRAGMA table_info(songs)")]
        indexes = [row[1] for row in conn.execute("PRAGMA index_list(songs)")]
    finally:
        conn.close()
    assert names.count("audio_id") == 1
    assert "ix_songs_audio_id" in indexes


def test_the_hash_job_fills_both_hashes_in_one_read(home, monkeypatch):
    file = _song(home, "mp3-a-id3.mp3")
    flags.use(BOTH)
    _start(home)
    reads: list[Path] = []
    real_open = open

    def counted(path, mode="r", *args, **kwargs):
        if "b" in mode and Path(path).name == file.name:
            reads.append(Path(path))
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", counted)
    monkeypatch.setattr(song_hashes, "file_sha256", lambda path: pytest.fail("a second read"))
    assert song_hashes.fill_all(library.store_for(home.db_path)) == 1
    row = _row(home)
    assert row["content_hash"] == hashlib.sha256(file.read_bytes()).hexdigest()
    assert row["audio_id"] == MANIFEST["mp3-a-id3.mp3"]["audio_id"]
    assert len(reads) == 1


def test_a_file_without_an_audio_id_is_marked_read_and_not_read_again(home):
    _song(home, "mp3-bad-no-frame.mp3")
    flags.use(BOTH)
    _start(home)
    store = library.store_for(home.db_path)
    assert song_hashes.fill_all(store) == 1
    assert _row(home)["audio_id"] == ""
    assert song_hashes.fill_all(store) == 0


@pytest.mark.parametrize("attribute", [0x1000, 0x40000, 0x400000])
def test_a_cloud_placeholder_is_skipped_and_tried_again_later(home, monkeypatch, attribute):
    file = _song(home, "mp3-a-id3.mp3")
    flags.use(BOTH)
    _start(home)
    store = library.store_for(home.db_path)
    real_stat = os.stat

    def placeholder(path, *args, **kwargs):
        facts = real_stat(path, *args, **kwargs)
        if Path(path).name != file.name:
            return facts
        return SimpleNamespace(
            st_size=facts.st_size, st_mtime=facts.st_mtime, st_file_attributes=attribute
        )

    real_open = open

    def never(path, mode="r", *args, **kwargs):
        if Path(path).name == file.name:
            pytest.fail("a placeholder was read")
        return real_open(path, mode, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(song_hashes.os, "stat", placeholder)
        patch.setattr("builtins.open", never)
        assert song_hashes.fill_all(store) == 0
    assert _row(home)["content_hash"] is None and _row(home)["audio_id"] is None
    # once the file is on this computer, the next pass reads it
    assert song_hashes.fill_all(store) == 1


def test_a_dataless_mac_file_is_skipped():
    facts = SimpleNamespace(st_file_attributes=0, st_flags=0x40000000)
    assert song_hashes.not_here(facts)
    assert not song_hashes.not_here(SimpleNamespace(st_flags=0))


def test_a_read_error_skips_the_song_without_stopping_the_pass(home, monkeypatch):
    file = _song(home, "mp3-a-id3.mp3")
    _song(home, "flac-a-tagged.flac", song_id=2)
    flags.use(BOTH)
    _start(home)
    real_open = open

    def refused(path, mode="r", *args, **kwargs):
        if Path(path).name == file.name:
            raise PermissionError("not allowed")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", refused)
    assert song_hashes.fill_all(library.store_for(home.db_path)) == 1
    assert _row(home, 1)["content_hash"] is None
    assert _row(home, 2)["audio_id"] == MANIFEST["flac-a-tagged.flac"]["audio_id"]


def _retag(settings: Settings, file: Path, fixture: str) -> None:
    """What a scan does when another player re-tagged the file: new bytes, tags, size and time."""
    file.write_bytes(_fixture_bytes(fixture))
    facts = file.stat()
    conn = db.connect(settings.db_path)
    try:
        row = dict(conn.execute("SELECT * FROM songs WHERE path=?", (str(file),)).fetchone())
        record = {
            key: value
            for key, value in row.items()
            if key not in {"id", "duplicate_of", "content_hash", "audio_id"}
        }
        record.update(size=facts.st_size, mtime=facts.st_mtime, title="New")
        db.upsert_song(conn, record)
        conn.commit()
    finally:
        conn.close()


def _kept(settings: Settings) -> tuple[dict, dict, list]:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        analysis = dict(conn.execute("SELECT bpm, camelot FROM analysis").fetchone())
        correction = dict(conn.execute("SELECT bpm, camelot FROM song_overrides").fetchone())
    finally:
        conn.close()
    conn = db.connect(settings.db_path)
    try:
        waiting = [row["id"] for row in db.songs_needing_analysis(conn, ANALYSIS_VERSION)]
    finally:
        conn.close()
    return analysis, correction, waiting


def test_a_retagged_file_keeps_its_analysis_and_finds_its_features(home):
    file = _song(home, "mp3-a-id3.mp3")
    flags.use(BOTH)
    _start(home)
    store = library.store_for(home.db_path)
    song_hashes.fill_all(store)
    before = _row(home)
    key = stored.audio_features_key("local", before["audio_id"], ANALYSIS_VERSION)
    library.artifacts_for(home).publish(key, features_path(home, 1))
    _retag(home, file, "mp3-a-retitled.mp3")
    cleared = _row(home)
    assert cleared["title"] == "New" and cleared["id"] == 1
    assert cleared["content_hash"] is None and cleared["audio_id"] is None
    assert _kept(home) == ({"bpm": 120.0, "camelot": "8A"}, {"bpm": 124.0, "camelot": "9A"}, [])
    assert song_hashes.fill_all(store) == 1
    after = _row(home)
    assert after["audio_id"] == before["audio_id"]
    assert after["content_hash"] != before["content_hash"]
    features_path(home, 1).unlink()  # only the artifact under the audio key is left
    assert np.array_equal(load_features(home, 1, ("peaks",))["peaks"], np.arange(5))


@pytest.mark.parametrize("asked", ["", NO_AUDIO])
def test_with_either_flag_off_a_retag_is_as_before(home, asked):
    file = _song(home, "mp3-a-id3.mp3")
    flags.use(asked)
    _start(home)
    if asked:
        assert song_hashes.fill_all(library.store_for(home.db_path)) == 1
        assert _row(home)["audio_id"] is None
    _retag(home, file, "mp3-a-retitled.mp3")
    row = _row(home)
    assert row["title"] == "New" and row.get("audio_id") is None
    assert _kept(home) == ({"bpm": 120.0, "camelot": "8A"}, {"bpm": 124.0, "camelot": "9A"}, [])
    if not asked:
        assert "audio_id" not in row and "content_hash" not in row
