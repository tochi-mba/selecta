"""The listening study on a Desktop library through the engine store (`core.engine_store`).

Flag off: the study leaves the file's schema exactly as before, with no engine stamp. Flag on: a
library made by today's code holding trials, labels, answers and grades keeps every row through
`lib0010listening` (trials keep their order), and every study operation gives the same answers
and rows through the store as the old path gives on a copy. A grade given to a rendered seam is
joined to that seam's key, and the calibration report counts it. Temporary homes, synthetic
trials and a synthetic tone only.
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
import soundfile as sf

from selecta import backup, calibration, db, flags, listening
from selecta.config import Settings
from selecta.engine_store import library
from selecta.engine_store import listening as stored
from selecta.engine_store.library_migrations.versions import lib0010listening

FLAG_ON = "+core.engine_store"
TABLES = ("listening_methods", "listening_quality", "listening_trials", "listening_responses")
GOOD = {"grade": 4, "tags": []}
BAD = {"grade": 2, "tags": ["beat", "key"]}


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


@pytest.fixture(autouse=True)
def counted_ids(monkeypatch):
    """Trial and condition ids from a counter, so both paths make the same ones."""
    state = {"n": 0}

    def uuid4():
        state["n"] += 1
        return SimpleNamespace(hex=f"{state['n']:032x}")

    monkeypatch.setattr(listening.uuid, "uuid4", uuid4)
    return state


def _tone(path: Path, pitch: float) -> None:
    seconds = np.arange(44100 * 2) / 44100
    wave = 0.2 * np.sin(2 * np.pi * pitch * seconds)
    sf.write(path, np.stack([wave, wave], axis=1), 44100)


def _synthetic(path: Path) -> None:
    """Today's library with a study in every state, made by the old path."""
    flags.use("")
    conn = db.connect(path)
    first, second = listening.create_trials(
        conn, "old", [{"pair": "1-2", "conditions": ["seamkeyaa", "seamkeybb"]},
                      {"pair": "3-4", "conditions": ["seamkeycc", "study-x"]}], 3)
    listening.respond(conn, first, "me", "a", "headphones", {"a": GOOD, "b": BAD})
    listening.respond(conn, second, "me", "tie", "speakers", {"a": BAD})
    conn.execute("INSERT INTO listening_methods(condition,method,renderer) "
                 "VALUES('study-x','blend','render-1')")
    conn.commit()
    conn.close()


def _rows(path: Path) -> dict[str, list]:
    conn = sqlite3.connect(path)
    try:
        return {
            "trials": conn.execute(
                "SELECT id,study,pair,mapping,seed FROM listening_trials ORDER BY rowid"
            ).fetchall(),
            "methods": conn.execute(
                "SELECT condition,method,renderer FROM listening_methods ORDER BY 1").fetchall(),
            "responses": conn.execute(
                "SELECT trial,listener,choice,setup FROM listening_responses ORDER BY 1,2"
            ).fetchall(),
            "quality": conn.execute(
                "SELECT trial,listener,option,grade,tags FROM listening_quality ORDER BY 1,2,3"
            ).fetchall(),
        }
    finally:
        conn.close()


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _every_operation(conn, settings, tmp: Path, counted) -> list:
    counted["n"] = 100
    said: list = [listening.public_trials(conn, "old")]
    made = listening.create_trials(
        conn, "new", [{"pair": "5-6", "conditions": ["seamkeydd", "seamkeyee"]}], 9)
    said.append(made)
    first, second = tmp / "first.wav", tmp / "second.wav"
    _tone(first, 220.0)
    _tone(second, 330.0)
    conditions = [
        {"path": str(first), "context": "same", "renderer": "r1", "method": "loop",
         "seam_key": "seamkeyff"},
        {"path": str(second), "context": "same", "renderer": "r1", "method": "blend"},
    ]
    said.append(listening.register_comparison(conn, settings, "new", "7-8", conditions))
    said.append(listening.public_trials(conn, "new"))
    old = [trial["id"] for trial in said[0]]
    said.append(listening.trial_mapping(conn, old[0]))
    said.append(listening.trial_mapping(conn, "missing"))
    listening.respond(conn, old[0], "me", "b", "headphones", {"a": BAD})  # an answer changed
    listening.respond(conn, made[0], "you", "a", "phone", {"a": GOOD, "b": GOOD})
    with pytest.raises(ValueError) as problem:
        listening.respond(conn, "missing", "me", "a", "phone", {})
    said.append(str(problem.value))
    said.append(listening.study_summary(conn, "old"))
    said.append(listening.study_summary(conn, "new"))
    return said


def test_the_migration_makes_the_tables_as_initialise_does(tmp_path):
    one, two = sqlite3.connect(tmp_path / "a.sqlite"), sqlite3.connect(tmp_path / "b.sqlite")
    flags.use("")
    listening.initialise(one)
    for statement in lib0010listening.DDL:
        two.execute(statement)
    tables = "SELECT name,sql FROM sqlite_master ORDER BY name"
    assert one.execute(tables).fetchall() == two.execute(tables).fetchall()
    one.close()
    two.close()


def test_flag_off_the_study_leaves_the_schema_as_it_was(home, tmp_path, counted_ids):
    _synthetic(home.db_path)
    before = _schema(home.db_path)
    flags.use("")
    conn = db.connect(home.db_path)
    _every_operation(conn, home, tmp_path, counted_ids)
    conn.close()
    assert _schema(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) is None
    finally:
        conn.close()


def test_the_migration_keeps_every_row_and_the_trial_order(home):
    _synthetic(home.db_path)
    before = _rows(home.db_path)
    flags.use(FLAG_ON)
    db.connect(home.db_path).close()
    db.connect(home.db_path).close()
    assert _rows(home.db_path) == before
    conn = sqlite3.connect(home.db_path)
    try:
        for table in TABLES:
            values = {row[0] for row in conn.execute(f"SELECT DISTINCT workspace_id FROM {table}")}
            assert values == {"local"}
        order = conn.execute("SELECT id FROM listening_trials ORDER BY rowid").fetchall()
        assert conn.execute("SELECT id FROM listening_trials ORDER BY ordinal").fetchall() == order
    finally:
        conn.close()


def test_every_study_operation_through_the_store_matches_the_old_path(
    home, tmp_path, counted_ids
):
    _synthetic(home.db_path)
    old = tmp_path / "old.sqlite"
    shutil.copy(home.db_path, old)
    old_home = Settings(tmp_path / "old-home")
    old_home.home.mkdir()
    flags.use("")
    conn = db.connect(old)
    said_old = _every_operation(conn, old_home, tmp_path, counted_ids)
    conn.close()

    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    assert listening.store_of(conn) is not None
    said_new = _every_operation(conn, home, tmp_path, counted_ids)
    conn.close()

    assert json.dumps(said_new) == json.dumps(said_old)
    assert _rows(home.db_path) == _rows(old)
    conn = sqlite3.connect(home.db_path)
    stamps = [row[0] for row in conn.execute("SELECT updated_at FROM listening_responses")]
    conn.close()
    assert all(len(stamp) == 19 for stamp in stamps)  # the format SQLite's clock writes
    library.forget(old)


def test_a_grade_on_a_rendered_seam_is_joined_and_counted(home, tmp_path, counted_ids):
    _synthetic(home.db_path)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    _every_operation(conn, home, tmp_path, counted_ids)
    for key in ("seamkeyaa", "seamkeybb", "seamkeyff"):
        conn.execute(
            "INSERT INTO seams(workspace_id,key,song_a,song_b,status,source,record,record_hash,"
            "updated_at) VALUES('local',?,1,2,'ready','desktop','{}','h','t')", (key,))
    conn.commit()
    store = library.store_of(conn)
    first = listening.public_trials(conn, "old")[0]["id"]
    graded_first = json.loads(listening.trial_mapping(conn, first))["a"]
    trial = listening.public_trials(conn, "new")[-1]["id"]
    mapping = json.loads(listening.trial_mapping(conn, trial))
    labelled = "a" if mapping["a"] == "study-" + f"{102:032x}" else "b"
    listening.respond(conn, trial, "me", "a", "headphones", {labelled: {"grade": 5, "tags": []}})
    conn.close()
    grades = stored.seam_grades(store)
    assert {(grade["key"], grade["grade"]) for grade in grades} == {
        (graded_first, 2),  # the old trial's answer was changed to grade A only
        ("seamkeyff", 5),  # a manifest condition that named its seam
    }
    collected = calibration.rated_seams(home.home)
    assert {grade["key"] for grade in collected.grades} == {graded_first, "seamkeyff"}


def test_backup_and_restore_carry_the_study(home, tmp_path):
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
