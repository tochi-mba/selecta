"""Discovery on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: discovery leaves the file's schema exactly as before, with no engine stamp. Flag on: a
library made by today's code holding links of every kind (legacy kinds the start-up step renames
included) and compared pairs keeps every row through the migration, and every discovery
operation gives the same rows through the store as the old path gives on a copy. A pair's links
and its compared mark land together or not at all. Backup and restore carry the tables.
Temporary homes and synthetic songs only.
"""

from __future__ import annotations

import io
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from selecta import backup, db, flags
from selecta.config import Settings
from selecta.discovery import search, sweep
from selecta.engine_store import discovery as stored
from selecta.engine_store import library
from selecta.engine_store.library_migrations.versions import lib0009discovery

FLAG_ON = "+core.engine_store"
TABLES = ("seam_book", "discovery_comparisons")
LRC = "[00:10.00]we dance all night until the morning light\n[00:20.00]morning comes again"
LRC_B = "[00:05.00]light up the sky tonight\n[00:15.00]and we dance"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _songs(count: int = 7) -> list[SimpleNamespace]:
    """Synthetic analysed songs: random bar chroma, with songs 1 and 2 sharing a sequence."""
    rng = np.random.default_rng(5)
    shared = rng.random((10, 12)) ** 3
    songs = []
    for song in range(1, count + 1):
        chroma = rng.random((40, 12)) ** 3
        if song in (1, 2):
            chroma[8 + song : 18 + song] = shared
        songs.append(
            SimpleNamespace(
                id=song,
                artist=f"Artist {song}",
                duration=200.0,
                chroma_bars=chroma,
                bar_times=np.arange(40, dtype=float) * 2.0,
            )
        )
    return songs


def _synthetic(path: Path) -> None:
    """Today's library with links of every kind and compared pairs, made by the old path."""
    flags.use("")
    conn = db.connect(path)
    for song in range(1, 9):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,title,artist,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (song, f"/music/{song}.flac", "/music", 1, 1.0, 200.0, f"Song {song}",
             f"Artist {song}", 0 if song == 8 else 1),
        )
    conn.executemany(
        "INSERT INTO lyrics(song_id,status,synced) VALUES(?,'synced',?)", [(3, LRC), (4, LRC_B)]
    )
    rows = [
        (1, 2, "same_melody", json.dumps({"old": 1}), 0.9, "new"),
        (2, 3, "harmonic_cousin", json.dumps({"old": 2}), 0.8, "approved"),
        (3, 4, "harmonic_sequence_candidate", json.dumps({"bars": 8}), 0.95, "rejected"),
        (5, 8, "harmonic_sequence_candidate", json.dumps({"bars": 8}), 0.99, "new"),  # not music
        (4, 5, "exact_word", json.dumps({"phrase": "love"}), 0.7, "new"),
    ]
    conn.executemany(
        "INSERT INTO seam_book(song_a,song_b,kind,payload,score,status) VALUES(?,?,?,?,?,?)", rows
    )
    conn.commit()
    sweep.sweep(conn, _songs(4), pair_limit=3)
    conn.close()


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _rows(path: Path) -> dict[str, list]:
    conn = sqlite3.connect(path)
    try:
        return {
            "links": conn.execute(
                "SELECT id,song_a,song_b,kind,payload,score,status FROM seam_book ORDER BY id"
            ).fetchall(),
            "compared": conn.execute(
                "SELECT song_a,song_b,fingerprint_a,fingerprint_b FROM discovery_comparisons "
                "ORDER BY 1,2"
            ).fetchall(),
        }
    finally:
        conn.close()


def _old_list(conn) -> list:
    return [dict(row) for row in conn.execute(
        "SELECT d.id,d.song_a,d.song_b,d.kind,d.payload,d.score,d.status,a.artist artist_a,"
        "a.title title_a,b.artist artist_b,b.title title_b FROM seam_book d "
        "JOIN songs a ON a.id=d.song_a JOIN songs b ON b.id=d.song_b "
        "WHERE d.kind='harmonic_sequence_candidate' AND a.is_music=1 AND b.is_music=1 "
        "AND a.duplicate_of IS NULL AND b.duplicate_of IS NULL ORDER BY d.score DESC,d.id")]


def _every_operation(conn, through_store: bool) -> list:
    """Each discovery operation once. Returns what each said."""
    said: list = [search.lyric_search(conn)]
    said.append(search.audio_search(conn, _songs(), limit=6, seed=1))
    said.append(sweep.sweep(conn, _songs(), pair_limit=5))
    said.append(sweep.sweep(conn, _songs(), pair_limit=100))
    songs = _songs()
    songs[2].chroma_bars = songs[2].chroma_bars[::-1].copy()  # song 3 measured again
    said.append(sweep.sweep(conn, songs, pair_limit=100))
    store = search.store_of(conn)
    assert (store is not None) == through_store
    if through_store:
        said.append(stored.listed(store))
        said.append([stored.review(store, i, "approved") for i in (3, 5, 99)])
        said.append([stored.harmonic_link(store, i) for i in (2, 3, 99)])
        said.append(stored.count_touching(store, [1, 3]))
    else:
        said.append(_old_list(conn))
        reviewed = []
        for i in (3, 5, 99):
            reviewed.append(bool(conn.execute(
                "UPDATE seam_book SET status='approved' WHERE id=? "
                "AND kind='harmonic_sequence_candidate'", (i,)).rowcount))
        conn.commit()
        said.append(reviewed)
        said.append([
            None if row is None else tuple(row) for row in (
                conn.execute("SELECT song_a,song_b,payload FROM seam_book WHERE id=? "
                             "AND kind='harmonic_sequence_candidate'", (i,)).fetchone()
                for i in (2, 3, 99))
        ])
        said.append(conn.execute(
            "SELECT COUNT(*) FROM seam_book WHERE song_a IN (1,3) OR song_b IN (1,3)"
        ).fetchone()[0])
    return said


def test_the_migration_makes_the_comparisons_table_as_the_sweep_does():
    assert lib0009discovery.COMPARISONS == sweep.COMPARISONS


def test_flag_off_discovery_leaves_the_schema_as_it_was_and_no_stamp(home):
    _synthetic(home.db_path)
    before = _schema(home.db_path)
    flags.use("")
    conn = db.connect(home.db_path)
    _every_operation(conn, through_store=False)
    conn.close()
    assert _schema(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) is None
        for table in TABLES:
            names = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            assert "workspace_id" not in names
    finally:
        conn.close()


def test_the_migration_keeps_every_row_and_adopts_in_place(home):
    _synthetic(home.db_path)
    flags.use("")
    db.connect(home.db_path).close()  # the start-up step renames the legacy kinds
    before = _rows(home.db_path)
    assert {row[3] for row in before["links"]} >= {"tonal_profile_cousin", "exact_word"}
    assert before["compared"]
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    assert _rows(home.db_path) == before
    db.connect(home.db_path).close()  # twice changes nothing
    assert _rows(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) == library.head()
        for table in TABLES:
            values = {row[0] for row in conn.execute(f"SELECT DISTINCT workspace_id FROM {table}")}
            assert values == {"local"}
        keys = [row[1] for row in conn.execute("PRAGMA table_info(discovery_comparisons)")
                if row[5]]
        assert keys == ["song_a", "song_b"]  # one workspace in a library: the keys stay
    finally:
        conn.close()


def test_legacy_kinds_are_renamed_on_an_adopted_table(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    conn = sqlite3.connect(home.db_path)
    conn.execute("UPDATE seam_book SET kind='same_melody' WHERE id=1")  # an older app's row
    conn.commit()
    conn.close()
    db._CHECKED.clear()
    db.connect(home.db_path).close()
    kinds = dict(_rows(home.db_path)["links"][i][:4:3] for i in range(2))
    assert kinds == {1: "tonal_profile_cousin", 2: "tonal_profile_cousin"}


def test_every_discovery_operation_through_the_store_matches_the_old_path(home, tmp_path):
    _synthetic(home.db_path)
    old = tmp_path / "old.sqlite"
    shutil.copy(home.db_path, old)
    flags.use("")
    conn = db.connect(old)
    said_old = _every_operation(conn, through_store=False)
    conn.close()

    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    said_new = _every_operation(conn, through_store=True)
    conn.close()

    assert said_new[2]["checked"] == 5 and said_new[2]["added"] >= 1
    assert json.dumps(said_new, default=str) == json.dumps(said_old, default=str)
    assert _rows(home.db_path) == _rows(old)
    library.forget(old)


def _pairs_split(path: Path) -> tuple[set, set]:
    rows = _rows(path)
    linked = {(row[1], row[2]) for row in rows["links"]}
    marked = {(row[0], row[1]) for row in rows["compared"]}
    return linked, marked


def test_a_sweep_stopped_midway_never_splits_a_pair(home, monkeypatch):
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    for song in range(1, 8):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,title,artist,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song, f"/m/{song}.flac", "/m", 1, 1.0, 200.0, f"S{song}", f"A{song}"),
        )
    conn.commit()
    calls = {"n": 0}

    def stop_at_the_sixth() -> None:
        calls["n"] += 1
        if calls["n"] == 6:
            raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        sweep.sweep(conn, _songs(), pair_limit=100, before_pair=stop_at_the_sixth)
    linked, marked = _pairs_split(home.db_path)
    assert len(marked) == 5 and linked <= marked

    # cut off inside the write itself: after the links, before the mark
    real = stored._insert_new

    def links_then_crash(connection, store, links):
        added = real(connection, store, links)
        if links:
            raise RuntimeError("cut off part way")
        return added

    monkeypatch.setattr(stored, "_insert_new", links_then_crash)
    with pytest.raises(RuntimeError):
        sweep.sweep(conn, _songs(), pair_limit=100)
    after_linked, after_marked = _pairs_split(home.db_path)
    assert after_linked <= after_marked
    assert after_linked == linked  # the crashed pair left no links
    conn.close()


def test_a_caller_with_pending_writes_stays_on_its_own_connection(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    conn.execute("UPDATE songs SET title='Pending' WHERE id=4")
    assert search.store_of(conn) is None
    conn.commit()
    assert search.store_of(conn) is not None
    conn.close()


def test_backup_and_restore_carry_the_discoveries(home, tmp_path):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    sweep.sweep(conn, _songs(), pair_limit=4)
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    conn.close()
    restored = tmp_path / "restored"
    restored.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        zipped.extract("selecta.sqlite", restored)
    assert _rows(restored / "selecta.sqlite") == kept
