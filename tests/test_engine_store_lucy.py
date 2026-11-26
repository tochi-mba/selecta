"""Lucy's Desktop tables on the engine store (`core.engine_store`, ADR-0479, Phase 7).

Flag off: Lucy's operations leave the file's schema as before, with no engine stamp. Flag on: a
library made by today's code holding conversations in several states, memories, proposals,
commits (saved, failed and left pending), permissions (pending, allowed, denied) and listening
history keeps every row through `lib0011lucy`; every Lucy operation gives the same answers and
rows through the store as the old path gives on a copy (one clock, counted ids); a reply cut
off midway is closed the same way; saving a revision is all or nothing; backup carries the
tables. Temporary homes and made-up text only; no model is called.
"""

from __future__ import annotations

import copy
import io
import json
import shutil
import sqlite3
import zipfile
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

from selecta import backup, db, flags, mix
from selecta.config import Settings
from selecta.engine_store import library
from selecta.engine_store import mixes as store_mixes
from selecta.engine_store.library_migrations.versions import lib0011lucy
from selecta.lucy import (
    backing,
    commit,
    commit_store,
    conversations,
    events,
    ids,
    memory,
    permissions,
    proposals,
    runs,
    schema,
)
from selecta.lucy import settings as lucy_settings
from selecta.seam_kinds import request_from

FLAG_ON = "+core.engine_store"
CLOCKED = {"listening_events": ("created_at",), "preferences": ("updated_at",)}
TABLES = lib0011lucy.TABLES
NOW = 1_795_000_000.0
NOW_ISO_USERS = ("conversations", "events", "memory", "permissions", "proposals", "commit",
                 "agent", "runs", "commit_store")
NEW_ID_USERS = ("conversations", "memory", "permissions", "proposals", "agent")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


@pytest.fixture(autouse=True)
def one_clock(monkeypatch):
    """One clock and counted ids for both paths, and Lucy turned on with every phase."""
    import importlib

    state = {"n": 0, "token": 0, "tick": 0}

    def now_iso() -> str:
        state["tick"] += 1
        tick = state["tick"]
        return f"2026-11-26T{10 + tick // 3600:02d}:{tick // 60 % 60:02d}:{tick % 60:02d}.000+00:00"

    def new_id(kind: str) -> str:
        state["n"] += 1
        return f"{ids.PREFIXES[kind]}_{state['n']:06d}"

    def token(_size: int) -> str:
        state["token"] += 1
        return f"token-{state['token']}"

    monkeypatch.setattr(ids, "now_iso", now_iso)
    monkeypatch.setattr(ids, "new_id", new_id)
    for name in NOW_ISO_USERS:
        module = importlib.import_module(f"selecta.lucy.{name}")
        if hasattr(module, "now_iso"):
            monkeypatch.setattr(module, "now_iso", now_iso)
        if name in NEW_ID_USERS:
            monkeypatch.setattr(module, "new_id", new_id)
    monkeypatch.setattr(store_mixes, "now", lambda: "2026-11-26 10:00:00")
    monkeypatch.setattr(commit.secrets, "token_urlsafe", token)
    frozen = SimpleNamespace(time=lambda: NOW)
    monkeypatch.setattr(commit, "time", frozen)
    monkeypatch.setattr(commit_store, "time", frozen)
    real_get = lucy_settings.get

    def config(conn):
        chosen = copy.deepcopy(real_get(conn))
        chosen["enabled"] = True
        chosen["phases"].update(chat=True, commit=True, memory=True, proposals=True)
        return chosen

    monkeypatch.setattr(lucy_settings, "get", config)
    # the checks a save makes against the library and its clips: their own tests cover them
    monkeypatch.setattr(commit, "preflight", lambda conn, app, revision: {"problems": []})
    monkeypatch.setattr("selecta.lucy.catalog.load", lambda conn, app: SimpleNamespace(songs=[]))
    monkeypatch.setattr("selecta.lucy.readiness.revalidate", lambda *args: [])
    return state


def _reset(state) -> None:
    state["n"], state["token"], state["tick"] = 500, 500, 1000
    events.LATEST._ids.clear()


APP = SimpleNamespace(store=None, wake_the_worker=lambda: None)


def _snap(songs: list[int], title: str = "Made up") -> dict:
    occurrences = [f"occ{index}" for index in range(len(songs))]
    return {
        "title": title,
        "ready_only": False,
        "songs": [{"occurrence": occ, "song_id": song, "locked": False}
                  for occ, song in zip(occurrences, songs, strict=True)],
        "seams": [{"a_occ": occurrences[i], "b_occ": occurrences[i + 1],
                   "key": request_from(songs[i], songs[i + 1], {}).key, "settings": {}}
                  for i in range(len(songs) - 1)],
        "constraints": [],
    }


def _ctx(conn, conversation: str, run: str | None):
    def emit(kind: str, payload: dict, step: str | None = None) -> None:
        events.append(conn, conversation, kind, payload, run=run, step=step)

    return SimpleNamespace(conn=conn, conversation=conversation, run=run, permissions=[],
                           emit=emit)


def _synthetic(path: Path) -> None:
    """Today's library holding Lucy's tables in several states, made by the old path."""
    flags.use("")
    conn = schema.ensure(db.connect(path))
    for song in range(1, 7):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,title,artist,genre,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (song, f"/music/{song}.flac", "/music", 1, 1.0, 200.0, f"Song {song}",
             f"Artist {song}", "House" if song < 4 else "Disco", 1),
        )
    conn.commit()
    kept = conversations.create(conn, "Kept chat", {"kind": "current"})
    conversations.accept_turn(conn, kept["id"], "c-1", "a made-up request")
    conversations.add_message(conn, kept["id"], "assistant", "a made-up reply")
    archived = conversations.create(conn, "Old chat")
    conversations.set_archived(conn, archived["id"], True)
    proposal = proposals.ensure_proposal(conn, kept["id"])
    first = proposals.add_revision(conn, proposal, _snap([1, 2, 3]), kind="plan",
                                   expected_current=None)
    saved = commit.issue(conn, APP, first["id"], first["hash"], "draft")
    commit.commit(conn, APP, saved["token"], "saved-key")
    late = commit.issue(conn, APP, first["id"], first["hash"], "draft")
    proposals.add_revision(conn, proposal, _snap([3, 2]), kind="revise",
                           expected_current=first["id"])
    commit.commit(conn, APP, late["token"], "failed-key")
    conn.execute(
        "INSERT INTO lucy_commits(idempotency_key,revision_id,hash,action,status,result,"
        "created_at,updated_at) VALUES('crashed-key',?,?,'draft','pending','{}',?,?)",
        (first["id"], first["hash"], "2026-01-01T00:00:00.000+00:00",
         "2026-01-01T00:00:00.000+00:00"))
    conn.commit()
    ctx = _ctx(conn, kept["id"], None)
    for answer in ("allow", "deny", None):
        asked = permissions.request(ctx, "compute", "analysis.request", {"song_ids": [1, 2]},
                                    "Analyse two made-up songs?")
        if answer:
            permissions.decide(conn, asked["id"], answer)
    memory.add_fact(conn, "Tempo", "made-up preference")
    memory.add_fact(conn, "Note", "made-up note", kind="session", conversation=kept["id"])
    memory.record_listening(conn, 1, "s", "player", "complete", 200.0, 200.0)
    conn.close()


def _plain(row) -> dict:
    """A row without the workspace it belongs to, which only the store's tables carry."""
    return {key: row[key] for key in row.keys() if key != "workspace_id"}


def _rows(path: Path) -> dict[str, list]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        found = {}
        for table in (*TABLES, "drafts", "queue", "preferences"):
            rows = conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()  # noqa: S608
            # the clock SQLite writes for these, never Lucy's: compared by form below
            drop = {"workspace_id", *CLOCKED.get(table, ())}
            found[table] = [{k: row[k] for k in row.keys() if k not in drop} for row in rows]
        return found
    finally:
        conn.close()


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _every_operation(conn) -> list:
    """Every Lucy operation once, on the synthetic library, with what each answered."""
    said: list = [conversations.listing(conn), conversations.listing(conn, "made-up"),
                  conversations.listing(conn, archived=True)]
    kept = said[0][0]["id"]
    cv = conversations.create(conn, "", {"kind": "draft", "draft": 1})["id"]
    first, new = conversations.accept_turn(conn, cv, "c-a", "first made-up ask")
    again, repeat = conversations.accept_turn(conn, cv, "c-a", "first made-up ask")
    second, _ = conversations.accept_turn(conn, cv, "c-b", "second made-up ask")
    said += [first, new, again, repeat, second, conversations.turn_by_id(conn, first["id"])]
    said.append(conversations.is_superseded(conn, first["id"]))
    run = "run_fixed"
    runs.add(conn, run, second["id"], cv, 1, "builtin", {"max_steps": 3})
    events.append(conn, cv, "run.state", {"state": "queued"}, turn=second["id"], run=run)
    reply = conversations.add_message(conn, cv, "assistant", "", status="streaming",
                                      turn=second["id"], run=run)
    conversations.set_turn_status(conn, second["id"], "running")
    for step in ("s1", "s2"):
        events.append(conn, cv, "step.started", {"status": "running"}, run=run, step=step)
        events.append(conn, cv, "step.completed", {"status": "completed"}, run=run, step=step)
    runs.set_state(conn, run, "streaming", 1, 2, None, None)
    runs.save_text(conn, reply["id"], "half a made-up repl")
    runs.set_usage(conn, run, {"tokens_in": 3, "tokens_out": 4, "cost_usd": 0.0})
    for _ in range(6):
        events.append(conn, cv, "message.delta", {"text": "x"}, run=run)
    said.append(events.prune(conn, cv, keep=2))
    said += [events.since(conn, cv, 0), events.since(conn, cv, 1), events.latest_id(conn, cv)]
    said.append(runs.recover(conn))  # the reply was cut off midway: the restart closes it
    said += [conversations.messages(conn, cv), conversations.get(conn, cv)]
    said += [_plain(runs.latest_of_conversation(conn, cv)),
             runs.latest_of_turn(conn, second["id"])]
    said += [runs.latest_turn(conn, cv), runs.requeue(conn, second["id"])]
    said += [[_plain(row) for row in runs.step_events(conn, cv)]]
    traces, problems = runs.diagnostics(conn, 10)
    said += [[_plain(row) for row in traces], sorted((row["type"], row["n"]) for row in problems)]
    message = conversations.add_message(conn, cv, "assistant", "made-up answer")
    conversations.finish_message(conn, message["id"], "made-up answer, done", meta={"a": 1})
    conversations.rename(conn, cv, "  A   made-up   title ")
    conversations.set_archived(conn, cv, True)
    said += [conversations.message_by_id(conn, message["id"]),
             conversations.branch(conn, cv, message["id"])]
    said += [conversations.column(conn, cv, "scope"), conversations.column(conn, "no", "scope")]
    proposal = proposals.ensure_proposal(conn, cv)
    said.append(proposals.ensure_proposal(conn, cv) == proposal)
    plan = proposals.add_revision(conn, proposal, _snap([4, 5]), kind="plan",
                                  expected_current=None, turn=second["id"])
    with pytest.raises(proposals.StaleRevision):
        proposals.add_revision(conn, proposal, _snap([5]), kind="revise", expected_current=None)
    revised = proposals.add_revision(conn, proposal, _snap([5, 4, 6]), kind="revise",
                                     expected_current=plan["id"], summary="made-up change")
    proposals.set_current(conn, proposal, plan["id"], revised["id"])
    said += [plan, revised, proposals.history(conn, proposal), proposals.current(conn, proposal),
             runs.current_revision(conn, cv), proposals.conversation_of(conn, proposal)]
    play = commit.issue(conn, APP, plan["id"], plan["hash"], "draft_and_play")
    said.append(commit.commit(conn, APP, play["token"], "play-key", confirm_play=True))
    said.append(commit.commit(conn, APP, play["token"], "play-key"))
    with pytest.raises(commit.CommitError) as used:
        commit.commit(conn, APP, play["token"], "another-key")
    said += [used.value.code, commit.status_of(conn, "crashed-key"),
             commit.status_of(conn, "saved-key"), commit.status_of(conn, "missing")]
    ctx = _ctx(conn, cv, run)
    asked = permissions.request(ctx, "compute", "analysis.request", {"song_ids": [5, 6]},
                                "Analyse two more made-up songs?")
    said += [permissions.pending(conn, cv), permissions.decide(conn, asked["id"], "allow"),
             permissions.decide(conn, asked["id"], "deny")]
    fact = memory.add_fact(conn, "Energy", "made-up energy note")
    said += [memory.update_fact(conn, fact["id"], " changed made-up note "),
             memory.facts(conn, cv), memory.facts(conn, every_conversation=True)]
    memory.forget_fact(conn, fact["id"])
    for song, event, heard in ((2, "start", 0.0), (2, "complete", 190.0), (3, "skip", 5.0)):
        said.append(memory.record_listening(conn, song, "s2", "player", event, heard, heard))
    said.append(memory.record_listening(conn, 2, "s2", "preview", "start", 0.0, 0.0))
    seam_memory = SimpleNamespace(good_moves=Counter(blend=3), bad_moves=Counter(blend=1))
    said += [memory.play_counts(conn, 30), memory.most_played(conn, 30),
             memory.infer(conn, seam_memory), memory.clear(conn, "inferred")]
    said += [memory.clear(conn, "history"), memory.facts(conn, every_conversation=True)]
    said.append(conversations.delete(conn, kept))
    said.append(conversations.listing(conn, archived=True))
    return said


def test_the_migration_makes_the_tables_as_ensure_does(tmp_path):
    flags.use("")
    one, two = sqlite3.connect(tmp_path / "a.sqlite"), sqlite3.connect(tmp_path / "b.sqlite")
    schema.ensure(one)
    for statement in lib0011lucy.SCHEMA.split(";"):
        if statement.strip():
            two.execute(statement)
    tables = "SELECT name,sql FROM sqlite_master ORDER BY name"
    assert one.execute(tables).fetchall() == two.execute(tables).fetchall()
    assert lib0011lucy.SCHEMA == schema.SCHEMA
    one.close()
    two.close()


def test_flag_off_lucy_leaves_the_schema_as_it_was(home, one_clock):
    _synthetic(home.db_path)
    before = _schema(home.db_path)
    flags.use("")
    _reset(one_clock)
    conn = schema.ensure(db.connect(home.db_path))
    assert backing.store_of(conn) is None
    _every_operation(conn)
    conn.close()
    assert _schema(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) is None
    finally:
        conn.close()


def test_the_migration_keeps_every_row(home):
    _synthetic(home.db_path)
    before = _rows(home.db_path)
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    db.connect(home.db_path).close()
    assert _rows(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.includes(library.stamp_of(conn), "lib0011lucy")
        for table in TABLES:
            found = {row[0] for row in conn.execute(f"SELECT DISTINCT workspace_id FROM {table}")}  # noqa: S608
            assert found <= {"local"}
    finally:
        conn.close()


def test_every_lucy_operation_through_the_store_matches_the_old_path(home, tmp_path, one_clock):
    _synthetic(home.db_path)
    old = tmp_path / "old.sqlite"
    shutil.copy(home.db_path, old)
    flags.use("")
    _reset(one_clock)
    conn = schema.ensure(db.connect(old))
    said_old = _every_operation(conn)
    conn.close()

    flags.use(FLAG_ON)
    _reset(one_clock)
    conn = schema.ensure(db.connect(home.db_path))
    assert backing.store_of(conn) is not None
    said_new = _every_operation(conn)
    conn.close()

    assert json.dumps(said_new, default=str) == json.dumps(said_old, default=str)
    assert _rows(home.db_path) == _rows(old)
    conn = sqlite3.connect(home.db_path)
    stamps = [row[0] for row in conn.execute("SELECT created_at FROM listening_events")]
    conn.close()
    assert all(len(stamp) == 19 for stamp in stamps)  # the form SQLite's clock writes
    library.forget(old)


def test_a_reply_cut_off_midway_is_closed_whole(home, one_clock):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = schema.ensure(db.connect(home.db_path))
    cv = conversations.create(conn, "Cut off")["id"]
    turn, _ = conversations.accept_turn(conn, cv, "c-x", "a made-up ask")
    runs.add(conn, "run_cut", turn["id"], cv, 1, "builtin", {})
    reply = conversations.add_message(conn, cv, "assistant", "", status="streaming",
                                      turn=turn["id"], run="run_cut")
    runs.save_text(conn, reply["id"], "the first half")
    assert runs.recover(conn) == 1
    closed = conversations.message_by_id(conn, reply["id"])
    assert (closed["status"], closed["content"]) == ("interrupted", "the first half")
    assert conversations.turn_by_id(conn, turn["id"])["status"] == "interrupted"
    assert runs.latest_of_conversation(conn, cv)["state"] == "interrupted"
    assert events.since(conn, cv, 0)["events"][-1]["payload"]["state"] == "interrupted"
    assert runs.recover(conn) == 0
    conn.close()


def test_saving_a_revision_is_all_or_nothing(home, one_clock, monkeypatch):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = schema.ensure(db.connect(home.db_path))
    cv = conversations.create(conn, "Save")["id"]
    proposal = proposals.ensure_proposal(conn, cv)
    revision = proposals.add_revision(conn, proposal, _snap([1, 2]), kind="plan",
                                      expected_current=None)
    approval = commit.issue(conn, APP, revision["id"], revision["hash"], "draft_and_play")
    before = _rows(home.db_path)

    def broken(*_args, **_kwargs):
        raise RuntimeError("the made-up disk is full")

    played = mix.play_draft
    monkeypatch.setattr(mix, "play_draft", broken)
    with pytest.raises(RuntimeError):
        commit.commit(conn, APP, approval["token"], "all-or-nothing", confirm_play=True)
    assert _rows(home.db_path) == before  # no draft, no queue, approval unused, no record
    monkeypatch.setattr(mix, "play_draft", played)
    saved = commit.commit(conn, APP, approval["token"], "all-or-nothing", confirm_play=True)
    assert saved["status"] == "committed" and saved["played"]
    after = _rows(home.db_path)
    # played: the new draft became the current mix, with Undo, and the save was recorded
    assert [row["song_id"] for row in after["queue"]] == [1, 2]
    assert [row["key"] for row in after["preferences"]] == ["mix_name", "mix_undo"]
    used = {row["token"]: row["used"] for row in after["lucy_approvals"]}
    assert used[approval["token"]] == 1
    saved_rows = {row["idempotency_key"]: row for row in after["lucy_commits"]}
    assert saved_rows["all-or-nothing"]["status"] == "committed"
    conn.close()


def test_backup_carries_lucys_tables(home, tmp_path):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    conn.close()
    restored = tmp_path / "restored"
    restored.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        zipped.extract("selecta.sqlite", restored)
    assert _rows(restored / "selecta.sqlite") == kept
