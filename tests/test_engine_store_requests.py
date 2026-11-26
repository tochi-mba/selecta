"""Song requests on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: request operations leave the file's schema exactly as before, with no engine stamp.
Flag on: a library made by today's code holding requests in every state (waiting, with a bridge
agreed and refused, scheduled, cancelled, marks of both kinds) keeps every row through the
migration, and every request operation gives the same answers and rows through the store as the
old path gives on a copy. A request joining the mix is one write with the mix's own. Backup and
restore carry the tables. Temporary homes and synthetic rows only.
"""

from __future__ import annotations

import io
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path

import pytest

from selecta import backup, db, flags, mix
from selecta import requests as song_requests
from selecta.config import Settings
from selecta.engine_store import library

FLAG_ON = "+core.engine_store"
TABLES = ("song_requests", "request_bridge_approvals", "request_routes", "request_marks")
AUTO = {"move": "auto", "from_request": True}


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _synthetic(path: Path) -> None:
    """Today's library with requests in every state, made by today's old path."""
    flags.use("")
    conn = db.connect(path)
    for song in range(1, 13):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,title,artist,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (song, f"/music/{song}.flac", "/music", 1, 1.0, 200.0, f"Song {song}",
             f"Artist {song}", 0 if song == 12 else 1),
        )
    conn.commit()
    mix.write_order(conn, [(1, None, 0), (2, None, 0), (3, None, 0)])
    plain = song_requests.add_request(conn, 4)  # waiting, never asked about a bridge
    agreed = song_requests.add_request(conn, 5)
    song_requests.choose_bridge(conn, agreed, True, [6, 5])
    refused = song_requests.add_request(conn, 7)
    song_requests.choose_bridge(conn, refused, False)
    joined = song_requests.add_request(conn, 2)
    song_requests.mark_added(conn, joined, 2)
    cancelled = song_requests.add_request(conn, 8)
    song_requests.cancel_request(conn, cancelled)
    conn.execute("INSERT INTO request_marks(song_id,kind,for_song) VALUES(3,'bridge',2)")
    conn.execute("INSERT INTO request_marks(song_id,kind,for_song) VALUES(11,'requested',NULL)")
    conn.commit()
    assert plain == 1
    conn.close()


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _rows(path: Path) -> dict[str, list]:
    """Every request row and the mix they edit, without the clock's columns."""
    conn = sqlite3.connect(path)
    try:
        return {
            "requests": conn.execute(
                "SELECT id,song_id,status FROM song_requests ORDER BY id").fetchall(),
            "approvals": conn.execute(
                "SELECT request_id,signature FROM request_bridge_approvals ORDER BY 1").fetchall(),
            "routes": conn.execute(
                "SELECT request_id,songs FROM request_routes ORDER BY 1").fetchall(),
            "marks": conn.execute(
                "SELECT song_id,kind,for_song FROM request_marks ORDER BY 1").fetchall(),
            "queue": conn.execute(
                "SELECT position,song_id,seam,locked FROM queue ORDER BY position").fetchall(),
            "undo": conn.execute(
                "SELECT value FROM preferences WHERE key='mix_undo'").fetchall(),
        }
    finally:
        conn.close()


def _without_clock(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in row.items() if k != "created_at"} for row in rows]


def _every_operation(conn) -> list:
    """Each request operation once, in every state. Returns what each said."""
    said: list = [_without_clock(song_requests.read_requests(conn))]
    for request_id in range(1, 7):
        said.append([request_id, song_requests.bridge_choice(conn, request_id),
                     song_requests.chosen_route(conn, request_id)])
    said.append(sorted(song_requests.songs_in_chosen_routes(conn)))
    said.append(sorted(song_requests.songs_in_chosen_routes(conn, leaving_out=2)))
    said.append(song_requests.add_request(conn, 4))  # the same request again
    said.append(song_requests.add_request(conn, 9))  # a new one
    for refused in (6, 12, 99):  # a bridge on its way, not music, not in the library
        with pytest.raises(ValueError) as problem:
            song_requests.add_request(conn, refused)
        said.append(str(problem.value))
    said.append(song_requests.choose_bridge(conn, 3, True))
    said.append(song_requests.choose_bridge(conn, 5, True))  # cancelled: nothing changes
    said.append(song_requests.marks_for(conn, [1, 2, 3]))  # song 11's mark goes
    said.append(song_requests.cancel_request(conn, 3))
    said.append(song_requests.cancel_request(conn, 3))
    items = mix._items(conn)
    with pytest.raises(song_requests.PlacementChanged) as problem:
        song_requests.insert_ready(conn, 1, song_requests.Slot(1, (4,)), items, 1, [AUTO, AUTO])
    said.append(str(problem.value))  # protected: nothing written
    song_requests.insert_ready(conn, 1, song_requests.Slot(2, (4,)), items, 0, [AUTO, AUTO])
    items = mix._items(conn)
    slot = song_requests.Slot(4, (6, 5), (6,))
    song_requests.insert_ready(
        conn, 2, slot, items, 1, [AUTO, AUTO], approved_bridges=(6,)
    )
    with mix.editing(conn) as mixes:
        mix.remember(mixes, "adding Song 9")
        mix.add_song(mixes, 9, None)
        song_requests.mark_added(mixes, 7, 9)
    said.append(song_requests.marks_for(conn, [item[0] for item in mix._items(conn)]))
    said.append(_without_clock(song_requests.read_requests(conn)))
    return said


def test_flag_off_request_operations_leave_the_schema_as_it_was_and_no_stamp(home):
    _synthetic(home.db_path)
    before = _schema(home.db_path)
    flags.use("")
    conn = db.connect(home.db_path)
    _every_operation(conn)
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


def test_the_migration_keeps_every_request_row_and_adopts_in_place(home):
    _synthetic(home.db_path)
    before = _rows(home.db_path)
    assert {row[2] for row in before["requests"]} == {"waiting", "scheduled", "cancelled"}
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    assert _rows(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        for table in TABLES:
            values = {row[0] for row in conn.execute(f"SELECT DISTINCT workspace_id FROM {table}")}
            assert values == {"local"}
        keys = [row[1] for row in conn.execute("PRAGMA table_info(request_marks)") if row[5]]
        assert keys == ["song_id"]  # one workspace in a library, so the song stays the key
    finally:
        conn.close()


def test_every_request_operation_through_the_store_matches_the_old_path(home, tmp_path):
    _synthetic(home.db_path)
    old = tmp_path / "old.sqlite"
    shutil.copy(home.db_path, old)
    flags.use("")
    conn = db.connect(old)
    said_old = _every_operation(conn)
    conn.close()

    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    with song_requests._opened(conn, write=False) as found:
        assert found is not None  # the store answers
    said_new = _every_operation(conn)
    conn.close()

    assert json.dumps(said_new, default=str) == json.dumps(said_old, default=str)
    assert _rows(home.db_path) == _rows(old)
    library.forget(old)


def test_a_request_joining_the_mix_lands_whole_or_not_at_all(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    before = _rows(home.db_path)
    with pytest.raises(RuntimeError):
        with mix.editing(conn) as mixes:
            mix.remember(mixes, "adding Song 4")
            mix.add_song(mixes, 4, None)
            song_requests.mark_added(mixes, 1, 4)
            raise RuntimeError("cut off part way")
    assert _rows(home.db_path) == before
    # a placement that no longer fits writes nothing either
    with pytest.raises(song_requests.PlacementChanged):
        song_requests.insert_ready(
            conn, 1, song_requests.Slot(2, (4,)), [(1, None, 0)], 0, [AUTO, AUTO]
        )
    assert _rows(home.db_path) == before
    conn.close()


def test_a_caller_with_pending_writes_stays_on_its_own_connection(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    conn.execute("UPDATE songs SET title='Pending' WHERE id=4")
    with song_requests._opened(conn, write=False) as found:
        assert found is None
    assert song_requests.read_requests(conn)[0]["title"] == "Pending"
    conn.commit()
    conn.close()


def test_backup_and_restore_carry_the_requests(home, tmp_path):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    song_requests.add_request(conn, 10)
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    conn.close()
    restored = tmp_path / "restored"
    restored.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        zipped.extract("selecta.sqlite", restored)
    assert _rows(restored / "selecta.sqlite") == kept
