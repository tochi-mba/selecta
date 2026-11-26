"""Mixes on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: mix edits leave the file's schema exactly as before, with no engine stamp. Flag on: a
library made by today's `db.connect` with a current mix, several drafts (one from the legacy
saved-mix step, an empty one, one whose song was since deleted) keeps every row through the
migration, and every mix operation gives the same rows through the store as the old path gives
on a copy of the same file. Backup and restore carry the tables, and an older backup is brought
forward. Temporary homes and synthetic rows only.
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
from selecta.config import Settings
from selecta.engine_store import library
from selecta.mix_backend import SqliteMixes, opened

FLAG_ON = "+core.engine_store"
MIX_TABLES = ("queue", "drafts", "preferences", "playback_skips")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _songs(conn: sqlite3.Connection, count: int = 8) -> None:
    for song_id in range(1, count + 1):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,title,artist) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (song_id, f"/music/{song_id}.flac", "/music", 1, 1.0, 200.0 + song_id,
             f"Song {song_id}", f"Artist {song_id}"),
        )
    conn.commit()


def _synthetic(path: Path) -> None:
    """Today's library: a current mix, drafts of every kind, and a legacy saved mix."""
    flags.use("")
    conn = db.connect(path)
    _songs(conn)
    mix.write_order(conn, [(1, None, 0), (2, json.dumps({"move": "echo_out"}), 1), (3, None, 0)])
    mix.set_mix_name(conn, "Friday")
    mix.remember(conn, "a change")
    first = mix.create_draft(conn, "Warm up", [(4, None, 0), (5, None, 0)])
    mix.create_draft(conn, "Empty one")
    mix.create_draft(conn, "Gone song", [(6, None, 0), (8, None, 0)])
    mix.join_line(conn, first)
    db.set_preference(conn, "saved_mixes", [{"name": "Old saved", "items": [[7, None, 0]]}])
    conn.close()
    conn = db.connect(path)  # the legacy step turns the saved mix into a draft
    conn.execute("DELETE FROM songs WHERE id=8")
    conn.commit()
    conn.close()


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _rows(path: Path) -> dict[str, list]:
    """Every mix row, without the columns a clock or the store writes."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        queue = [tuple(row) for row in conn.execute(
            "SELECT position,song_id,state,transition,reason,locked,seam FROM queue "
            "ORDER BY position")]
        drafts = [tuple(row) for row in conn.execute(
            "SELECT id,name,items,history,ready_only,line FROM drafts ORDER BY id")]
        values = [tuple(row) for row in conn.execute(
            "SELECT key,value FROM preferences WHERE key IN "
            "('mix_name','mix_undo','deleted_drafts','last_deleted_draft') ORDER BY key")]
        return {"queue": queue, "drafts": drafts, "values": values}
    finally:
        conn.close()


def _every_operation(conn) -> list:
    """Each kind of mix edit once, on the current mix and on drafts. Returns what they said."""
    said = []
    drafts = [row["id"] for row in mix.all_drafts(conn)]
    warm = next(row["id"] for row in mix.all_drafts(conn) if row["name"] == "Warm up")
    with mix.editing(conn) as mixes:
        mix.remember(mixes, "adding")
        mix.add_song(mixes, 4, 1)
    mix.move_song(conn, 0, 2)
    mix.set_seam(conn, 1, {"move": "filter_sweep", "bars": 8})
    mix.toggle_lock(conn, 0)
    mix.replace_at(conn, 2, 5)
    mix.remove_at(conn, 3)
    said.append(mix.locked_in_the_way(conn, 2, 0))
    said.append(mix.add_pair(conn, 6, 7, {"move": "echo_out"}))
    mix.merge_with_locks(conn, [3, 2, 1], {2: {"move": "cut_on_one"}})
    said.append(mix.undo(conn))
    mix.add_song(conn, 6, None, warm)
    mix.move_song(conn, 0, 1, warm)
    mix.set_seam(conn, 1, {"move": "echo_out"}, warm)
    mix.toggle_lock(conn, 0, warm)
    mix.remember(conn, "draft change", warm)
    mix.remove_at(conn, 0, warm)
    said.append(mix.undo(conn, warm))
    said.append(mix.rename_draft(conn, warm, "Warm up"))
    said.append(mix.rename_draft(conn, warm, "Gone song"))
    copy = mix.duplicate_draft(conn, warm)
    said.append(mix.mix_name(conn, copy))
    said.append(mix.copy_current(conn, "Kept"))
    said.append(mix.create_draft(conn))  # the empty draft is used again
    said.append(mix.delete_draft(conn, drafts[1]))
    said.append(mix.restore_draft(conn))
    mix.join_line(conn, copy)
    mix.move_in_line(conn, copy, -1)
    said.append(mix.line_order(conn))
    said.append(mix.play_draft(conn, warm))
    said.append(mix.undo(conn))  # the swap goes back
    mix.leave_line(conn, copy)
    said.append(mix.can_undo(conn))
    said.append(mix.can_undo(conn, copy))
    # the adopted table also has workspace_id, which the old file has not
    said.append([
        {k: v for k, v in dict(row).items() if k != "workspace_id"} for row in mix._rows(conn)
    ])
    said.append([(row["id"], row["name"]) for row in mix.draft_names(conn)])
    return said


def test_flag_off_mix_edits_leave_the_schema_as_it_was_and_no_stamp(home):
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
        for table in MIX_TABLES[:3]:
            names = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            assert "workspace_id" not in names
    finally:
        conn.close()


def test_flag_off_every_operation_is_the_old_path(home):
    _synthetic(home.db_path)
    flags.use("")
    conn = db.connect(home.db_path)
    with opened(conn, write=True) as mixes:
        assert isinstance(mixes, SqliteMixes)
    conn.close()


def test_the_migration_keeps_every_row_and_adopts_in_place(home):
    _synthetic(home.db_path)
    before = _rows(home.db_path)
    assert {row[1] for row in before["drafts"]} >= {"Warm up", "Empty one", "Gone song",
                                                     "Old saved"}
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    assert _rows(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) == library.head()
        for table in MIX_TABLES:
            values = {row[0] for row in conn.execute(f"SELECT DISTINCT workspace_id FROM {table}")}
            assert values <= {"local"}
        keys = {row[5] for row in conn.execute("PRAGMA table_info(queue)") if row[5]}
        assert keys == {1}  # queue.position stays the key: one workspace in a library
    finally:
        conn.close()
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()  # a second start changes nothing
    assert _rows(home.db_path) == before


def test_every_operation_through_the_store_matches_the_old_path(home, tmp_path, monkeypatch):
    _synthetic(home.db_path)
    # One still clock for both runs: drafts listed newest first tie on the same second and fall
    # back to the id, so a second ticking over mid-run in one run only can't reorder the lists.
    monkeypatch.setattr("selecta.engine_store.mixes.now", lambda: "2099-01-01 00:00:00")
    old = tmp_path / "old.sqlite"
    shutil.copy(home.db_path, old)
    flags.use("")
    conn = db.connect(old)
    said_old = _every_operation(conn)
    conn.close()

    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    with opened(conn, write=False) as mixes:
        assert not isinstance(mixes, SqliteMixes)
    said_new = _every_operation(conn)
    conn.close()

    assert json.dumps(said_new, default=str) == json.dumps(said_old, default=str)
    assert _rows(home.db_path) == _rows(old)


def test_a_caller_with_pending_writes_stays_on_its_own_connection(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    conn.execute("UPDATE songs SET title='Pending' WHERE id=1")
    assert conn.in_transaction
    with opened(conn, write=True) as mixes:
        assert isinstance(mixes, SqliteMixes)  # the store couldn't see, or would wait behind, it
    assert mix._rows(conn)[0]["title"] == "Pending"
    conn.commit()
    conn.close()


def test_one_edit_is_one_write_that_lands_whole_or_not_at_all(home):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    before = _rows(home.db_path)
    with pytest.raises(RuntimeError):
        with mix.editing(conn) as mixes:
            mix.remember(mixes, "half")
            mix.write_order(mixes, [])
            raise RuntimeError("cut off part way")
    assert _rows(home.db_path) == before
    conn.close()


def test_a_skip_is_written_by_the_store_and_the_route_makes_no_table(home):
    from selecta.engine_store.mixes import record_skip

    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    record_skip(library.store_of(conn), 2, 12.5, 30.0)
    row = conn.execute("SELECT song_id,heard_seconds,source_position,workspace_id "
                       "FROM playback_skips").fetchone()
    assert tuple(row) == (2, 12.5, 30.0, "local")
    conn.close()
    source = (Path(mix.__file__).parent / "routes" / "mixes.py").read_text(encoding="utf-8")
    assert source.index('flags.on("core.engine_store")') < source.index("CREATE TABLE")


def test_backup_and_restore_carry_the_mixes_and_bring_an_older_one_forward(home, tmp_path):
    _synthetic(home.db_path)
    older = tmp_path / "older.sqlite"
    shutil.copy(home.db_path, older)  # a backup made before the flag was ever on
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    mix.rename_draft(conn, mix.all_drafts(conn)[0]["id"], "After the flag")
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    conn.close()
    restored = tmp_path / "restored"
    restored.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        zipped.extract("selecta.sqlite", restored)
    assert _rows(restored / "selecta.sqlite") == kept
    # an older file brought forward keeps its rows and gains the stamp
    before = _rows(older)
    flags.use(FLAG_ON)
    db.connect(older).close()
    assert _rows(older) == before
    conn = sqlite3.connect(older)
    try:
        assert library.stamp_of(conn) == library.head()
    finally:
        conn.close()
    library.forget(older)


def test_request_tables_come_from_the_migration_and_no_ddl_runs_with_the_flag_on(home):
    from selecta import requests as song_requests
    from selecta.engine_store.library_migrations.versions import lib0008requests

    assert lib0008requests.DDL == song_requests.DDL  # the migration pins today's statements
    _synthetic(home.db_path)
    flags.use("")
    conn = db.connect(home.db_path)
    song_requests.add_request(conn, 1)  # the old path makes its tables on first use
    conn.close()
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    statements: list[str] = []
    conn.set_trace_callback(statements.append)
    song_requests.add_request(conn, 2)
    assert [row["song_id"] for row in song_requests.read_requests(conn)] == [1, 2]
    conn.set_trace_callback(None)
    assert not [text for text in statements if text.lstrip().upper().startswith("CREATE")]
    for table in lib0008requests.TABLES:
        names = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        assert "workspace_id" in names
    conn.close()
