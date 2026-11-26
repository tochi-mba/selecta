"""Seams on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: no table and no column, the library byte for byte as before, and nothing reads a
table. Flag on: the library chain makes the seam tables; a synthetic home of a few dozen seam
folders, history files and verdicts (with older-shaped records, a corrupt file and a half-written
folder) imports without losing a record or a verdict, skips and counts what it can't read,
changes no file, and gives the same tables on a second run. `SeamStore` then writes both its
files and the tables, and the memory, calibration and the ready inventory read the tables and
answer what the files answer. Temporary homes and synthetic records only; no audio is decoded
except two tiny generated clips.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from selecta import db, flags
from selecta.calibration import rated_seams
from selecta.config import SAMPLE_RATE, Settings
from selecta.engine_store import library, seam_import
from selecta.engine_store import seams as stored
from selecta.planner_core.memory import RULES_VERSION, SeamMemory
from selecta.seam_records import forget_all

FLAG_ON = "+core.engine_store"
SEAM_TABLES = {"seams", "seam_attestations", "seam_history", "seam_verdicts"}


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    forget_all()
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _library(settings: Settings, songs: int = 12) -> None:
    flags.use("")
    conn = db.connect(settings.db_path)
    for song_id in range(1, songs + 1):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song_id, f"/music/{song_id}.flac", "/music", 1, 1.0, 200.0),
        )
    conn.commit()
    conn.close()


def _flag_on(settings: Settings) -> None:
    flags.use(FLAG_ON)
    db.connect(settings.db_path).close()


def _tables(path: Path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def _ready(
    key: str,
    a: int,
    b: int,
    *,
    rating: str | None = None,
    rated_at: float = 0.0,
    style: str = "bass_swap_blend",
    passed: bool = True,
) -> dict:
    state = {
        "status": "ready",
        "key": key,
        "request": {"a": a, "b": b, "move": "auto"},
        "style": style,
        "label": "Blend",
        "why": "fits",
        "fell_back": False,
        "tried": [],
        "rules": RULES_VERSION,
        "exit_bar": 64,
        "entry_bar": 8,
        "placed_bars": 8,
        "a_source_start": 100.0,
        "b_source_end": 12.0,
        "duration": 1.0,
        "switch_at": 0.5,
        "preview_seam": 12.0,
        "bars": 8,
        "passed": passed,
        "near_miss": False,
        "checks": [],
        "pair": {"gap": 0.01, "keys": 1, "grid": 0.9},
    }
    if rating is not None:
        state.update(rating=rating, rated_at=rated_at, note="")
    return state


def _write(path: Path, state) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state), "utf-8")


def _clip(folder: Path, seconds: float = 1.0) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    frames = int(SAMPLE_RATE * seconds)
    audio = np.zeros((frames, 2), dtype=np.float32)
    audio[:, 0] = 0.1
    sf.write(folder / "clip.flac", audio, SAMPLE_RATE)


def _synthetic_home(settings: Settings) -> dict:
    """A few dozen seams the way a long-used home holds them. Returns what must survive."""
    seams_root = settings.renders_dir / "seams"
    history = settings.home / "seam-history"
    expected: dict[str, dict] = {}
    verdicts: set[tuple[str, str, float]] = set()
    for n in range(30):
        key = f"k{n:019d}"
        a, b = n % 12 + 1, (n + 5) % 12 + 1
        rating = ("good", "bad", "none", None)[n % 4]
        state = _ready(key, a, b, rating=rating, rated_at=1_700_000_000.0 + n)
        if n % 3 == 0:  # in the render folder and the history, the same record
            _write(seams_root / key / "seam.json", state)
            _write(history / f"{key}.json", state)
        elif n % 3 == 1:  # the render cache cleared it: history only
            _write(history / f"{key}.json", state)
        else:  # the history file missed a later rating: the folder's copy wins
            _write(history / f"{key}.json", _ready(key, a, b))
            _write(seams_root / key / "seam.json", state)
        expected[key] = state
        if rating is not None:
            verdicts.add((key, rating, state["rated_at"]))
    for n in range(5):  # failures, kept so spare time isn't spent on them again
        key = f"f{n:019d}"
        state = {
            "status": "failed",
            "key": key,
            "request": {"a": 1, "b": n + 2, "move": "echo_out"},
            "error": "It clashes.",
            "untimed_song": None,
            "rules": RULES_VERSION,
        }
        _write(history / f"{key}.json", state)
        expected[key] = state
    # older shapes: no pair facts, no rules, no request (an unknown pair is kept as 0 > 0)
    old = {
        "status": "ready",
        "key": "old0000000000000000a",
        "request": {"a": 2, "b": 3},
        "style": "phrase_roll",
        "passed": True,
        "rating": "good",
        "rated_at": 1_600_000_000,
    }
    _write(history / f"{old['key']}.json", old)
    expected[old["key"]] = old
    verdicts.add((old["key"], "good", 1_600_000_000.0))
    bare = {"status": "ready", "style": "echo_out", "rating": "bad", "rated_at": 1_600_000_001}
    _write(history / "bare000000000000000b.json", bare)
    expected["bare000000000000000b"] = bare
    verdicts.add(("bare000000000000000b", "bad", 1_600_000_001.0))
    # unreadable: corrupt JSON, not an object, a half-written folder
    (history / "corrupt0000000000000.json").write_text('{"status": "ready", "ke', "utf-8")
    (history / "list00000000000000000.json").write_text("[1, 2]", "utf-8")
    (seams_root / "half0000000000000000").mkdir(parents=True)
    (seams_root / "half0000000000000000" / "seam.json").write_text("", "utf-8")
    # in flight: not a record
    _write(
        seams_root / "busy0000000000000000" / "seam.json",
        {"status": "rendering", "key": "busy0000000000000000", "request": {"a": 1, "b": 2}},
    )
    # a clip for two ready seams in the render folder
    _clip(seams_root / "k0000000000000000000")
    _clip(seams_root / "k0000000000000000002")
    return {"records": expected, "verdicts": verdicts}


def _hash_tree(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
        and path.name != "selecta.sqlite"
        and not path.name.startswith("selecta.sqlite")
        and "backups" not in path.parts
    }


def _dump(store) -> dict:
    with store.read() as connection:
        out = {}
        for table in ("seams", "seam_history", "seam_verdicts", "seam_attestations"):
            rows = connection.exec_driver_sql(f"SELECT * FROM {table}").fetchall()  # noqa: S608
            # times of writing aside, the rows themselves
            out[table] = sorted(
                repr(
                    tuple(
                        value for value in row if not (isinstance(value, str) and value[:2] == "20")
                    )
                )
                for row in rows
            )
        return out


def test_flag_off_leaves_the_library_exactly_as_it_was(home):
    _library(home)
    before = home.db_path.read_bytes()
    flags.use("")
    db.connect(home.db_path).close()
    _write(home.home / "seam-history" / "k1.json", _ready("k1", 1, 2))
    assert seam_import  # imported, never run with the flag off
    from selecta import seam_mirror

    assert seam_mirror.states(home) is None and seam_mirror.ready(home) is None
    assert home.db_path.read_bytes() == before
    assert not SEAM_TABLES & _tables(home.db_path)


def test_the_library_chain_makes_the_seam_tables_and_a_grade_can_name_its_seam(home):
    _library(home)
    _flag_on(home)
    assert SEAM_TABLES <= _tables(home.db_path)
    conn = sqlite3.connect(home.db_path)
    assert "seam_key" in {row[1] for row in conn.execute("PRAGMA table_info(ratings)")}
    conn.close()
    from selecta.eval.ratings import save_rating

    conn = db.connect(home.db_path)
    save_rating(conn, 1, 2, "blend", 4, [], seam_key="k1")
    conn.close()
    from selecta.engine_store import ratings

    assert [row["seam_key"] for row in ratings.every(library.store_for(home.db_path))] == ["k1"]
    # a second start changes nothing
    stamp = library.stamp_of(sqlite3.connect(home.db_path))
    assert stamp == library.head()
    db.connect(home.db_path).close()
    assert SEAM_TABLES <= _tables(home.db_path)


def test_the_import_loses_nothing_changes_no_file_and_runs_again_the_same(home):
    _library(home)
    wanted = _synthetic_home(home)
    _flag_on(home)
    files_before = _hash_tree(home.home)
    store = library.store_for(home.db_path)

    first = seam_import.import_home(store, home.home)

    assert _hash_tree(home.home) == files_before
    assert first.unreadable == 3 and first.under_way == 1
    assert first.kept == len(wanted["records"]) and first.attested == 2
    kept = {record.get("key") or "bare000000000000000b": record for record in stored.records(store)}
    assert kept == wanted["records"]
    given = {(row["key"], row["verdict"], row["rated_at"]) for row in stored.verdicts(store)}
    assert given == wanted["verdicts"]
    # the history holds both versions where the folder's copy had a later rating
    with store.read() as connection:
        versions = connection.exec_driver_sql(
            "SELECT count(*) FROM seam_history WHERE key='k0000000000000000002'"
        ).scalar_one()
    assert versions == 2
    tables = _dump(store)

    second = seam_import.import_home(store, home.home)

    assert second.kept == 0 and second.unchanged == len(wanted["records"])
    assert second.attested == 0 and second.dropped == 0
    assert _dump(store) == tables
    assert _hash_tree(home.home) == files_before


def test_a_pass_cut_off_part_way_is_finished_by_the_next(home):
    _library(home)
    wanted = _synthetic_home(home)
    _flag_on(home)
    store = library.store_for(home.db_path)
    calls = iter(range(10_000))
    seam_import.import_home(store, home.home, stop=lambda: next(calls) >= 7)
    assert len(stored.records(store)) == 7
    seam_import.import_home(store, home.home)
    assert len(stored.records(store)) == len(wanted["records"])


def test_files_win_and_a_record_whose_files_are_gone_leaves_the_current_table(home):
    _library(home)
    _synthetic_home(home)
    _flag_on(home)
    store = library.store_for(home.db_path)
    seam_import.import_home(store, home.home)
    # while the flag was off: one record re-rated in its file, one removed with its folder
    key = "k0000000000000000004"  # history only, so its file is the one that counts
    path = home.home / "seam-history" / f"{key}.json"
    changed = {**json.loads(path.read_text("utf-8")), "rating": "bad", "rated_at": 1_800_000_000.0}
    path.write_text(json.dumps(changed), "utf-8")
    (home.home / "seam-history" / "k0000000000000000001.json").unlink()
    import time as clock

    clock.sleep(1.1)  # the row must be older than the pass that drops it
    again = seam_import.import_home(store, home.home)
    assert again.dropped == 1
    assert stored.record_of(store, key)["rating"] == "bad"
    assert stored.record_of(store, "k0000000000000000001") is None
    # its history and verdicts stay
    with store.read() as connection:
        left = connection.exec_driver_sql(
            "SELECT count(*) FROM seam_history WHERE key='k0000000000000000001'"
        ).scalar_one()
    assert left == 1


def test_the_seam_store_writes_both_and_every_reader_answers_the_same(home):
    from selecta.planner.ready import ready_inventory
    from selecta.seams import SeamStore

    _library(home)
    _synthetic_home(home)
    flags.use("")
    files_store = SeamStore(home)
    files_memory = files_store.remembered(fresh=True).summary()
    files_rated = rated_seams(home.home)
    _flag_on(home)
    store = library.store_for(home.db_path)
    seam_import.import_home(store, home.home)
    seams = SeamStore(home)
    assert seams.remembered(fresh=True).summary() == files_memory
    table_rated = rated_seams(home.home)
    assert sorted(str(r["key"]) for r in table_rated.records) == sorted(
        str(r["key"]) for r in files_rated.records
    )
    # the files also count the seam still rendering, which is in flight and never a record
    assert table_rated.unrated == files_rated.unrated - 1

    # a new render, then a rating, through the store: files and tables both
    from selecta.seam_kinds import SeamRequest

    key = SeamRequest(3, 4).key  # a real key, which the ready inventory checks
    _clip(seams.folder(key))
    fresh = _ready(key, 3, 4)
    (seams.folder(key) / "seam.json").write_text(json.dumps(fresh), "utf-8")
    seams._remember(fresh)
    assert stored.attested(store, key, "desktop")["clip_sha256"]
    rated = seams.rate(key, "good", "lovely")
    assert stored.record_of(store, key) == rated
    on_file = json.loads((home.home / "seam-history" / f"{key}.json").read_text("utf-8"))
    assert on_file == rated
    assert [v["verdict"] for v in stored.verdicts(store) if v["key"] == key] == ["good"]

    # the ready inventory reads the table and still checks the clip on disk
    songs = {
        song_id: type("Song", (), {"id": song_id, "duration": 200.0})() for song_id in range(1, 13)
    }
    edges, counts = ready_inventory(seams, songs)
    keys = {edge.key for found in edges.values() for edge in found}
    assert keys == {key}  # the synthetic records' made-up keys never match their requests
    flags.use("")
    file_edges, _ = ready_inventory(SeamStore(home), songs)
    assert {edge.key for found in file_edges.values() for edge in found} == keys
    flags.use(FLAG_ON)

    # a corrected song's seams go from the files and the tables, its verdicts stay in the log
    seams.forget_song(3)
    assert stored.record_of(store, key) is None
    assert any(v["key"] == key for v in stored.verdicts(store))


def test_memory_from_the_table_learns_what_the_files_teach(home):
    states = [_ready("a1", 1, 2, rating="good", rated_at=1.0), _ready("a2", 2, 3, passed=False)]
    _library(home)
    _flag_on(home)
    store = library.store_for(home.db_path)
    for state in states:
        stored.keep(store, state)
    from_table = SeamMemory.from_states(stored.records(store))
    from_files = SeamMemory.from_states(states)
    assert from_table.summary() == from_files.summary()
    assert from_table.liked == from_files.liked == {(1, 2, "bass_swap_blend")}


def test_a_backup_carries_the_seam_tables_and_a_restore_brings_them_back(home):
    from selecta.backup import activate_pending_restore, export_backup, stage_restore

    _library(home)
    _flag_on(home)
    store = library.store_for(home.db_path)
    stored.keep(store, _ready("b1", 1, 2, rating="good", rated_at=5.0))
    _write(home.home / "seam-history" / "b1.json", _ready("b1", 1, 2, rating="good", rated_at=5.0))
    conn = db.connect(home.db_path)
    try:
        data = export_backup(conn, home)
    finally:
        conn.close()
    staged = stage_restore(home, data, hashlib.sha256(data).hexdigest())
    assert staged["counts"]["seams"] == 1 and staged["counts"]["seam_verdicts"] == 1
    stored.keep(store, _ready("b2", 2, 3))  # made after the backup
    library.forget(home.db_path)
    assert activate_pending_restore(home)
    db.connect(home.db_path).close()
    store = library.store_for(home.db_path)
    assert [r["key"] for r in stored.records(store)] == ["b1"]
    seam_import.import_home(store, home.home)
    assert [r["key"] for r in stored.records(store)] == ["b1"]
