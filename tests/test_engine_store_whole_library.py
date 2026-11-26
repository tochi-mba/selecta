"""A whole Desktop library through `core.engine_store` on, off and on again, and a backup.

The slices each proved their own tables; this proves them together on one library made by the
flag-off code: songs with analysis and lyrics, ratings, a current mix with drafts, requests in
every state, discoveries, a listening study, Lucy's conversations, memory and permissions, and
seam files with history and verdicts. Each start must keep every row of every table (row counts
and a hash of each table's rows, over the columns the flag-off file had, so the added
`workspace_id` and new nullable columns are left out), and the app must answer the same.
Temporary homes, generated audio and made-up text only.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest
from e2e_server import build
from fastapi.testclient import TestClient
from test_engine_store_seams import _ready

from selecta import db, flags, listening, mix
from selecta import requests as song_requests
from selecta.api import create_app
from selecta.backup import export_backup, stage_restore
from selecta.config import Settings
from selecta.engine_store import library, seam_import
from selecta.engine_store import seams as stored_seams
from selecta.eval.ratings import save_rating
from selecta.lucy import conversations, memory, proposals
from selecta.lucy import schema as lucy_schema
from selecta.seam_kinds import SeamRequest, request_from
from selecta.seam_records import forget_all

FLAG_ON = "+core.engine_store"
# the pages that name no file, so a library restored into another home answers the same
WITHOUT_PATHS = (
    "/api/drafts",
    "/api/requests",
    "/api/listening?study=old",
    "/api/lucy/conversations",
)
# Lucy re-derives what she infers from the ratings on every read, on either path: a new id and
# time each time, the same facts
SEAM_PAIRS = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (2, 1), (7, 8)]
REDERIVED = {"lucy_memory": {"id", "created_at", "updated_at"}}
# what the app is asked, on and off: every page that reads a moved slice
PAGES = (
    "/api/library",
    "/api/songs",
    "/api/mix",
    "/api/drafts",
    "/api/requests",
    "/api/discoveries",
    "/api/listening?study=old",
    "/api/memory/ratings",
    "/api/lucy/conversations",
    "/api/lucy/memory",
)


@pytest.fixture
def homes(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))  # never the real home
    made: list[Settings] = []

    def make(name: str) -> Settings:
        settings = Settings(tmp_path / name)
        settings.home.mkdir(parents=True, exist_ok=True)
        made.append(settings)
        return settings

    yield make
    flags.use(None)
    for settings in made:
        library.forget(settings.db_path)
    db._CHECKED.clear()
    forget_all()


def _snap(songs: list[int]) -> dict:
    occurrences = [f"occ{index}" for index in range(len(songs))]
    return {
        "title": "Made up",
        "ready_only": False,
        "songs": [
            {"occurrence": occ, "song_id": song, "locked": False}
            for occ, song in zip(occurrences, songs, strict=True)
        ],
        "seams": [
            {
                "a_occ": occurrences[i],
                "b_occ": occurrences[i + 1],
                "key": request_from(songs[i], songs[i + 1], {}).key,
                "settings": {},
            }
            for i in range(len(songs) - 1)
        ],
        "constraints": [],
    }


def _make(settings: Settings) -> None:
    """A library made by the flag-off code with something in every slice."""
    flags.use("")
    build(settings.home)
    conn = lucy_schema.ensure(db.connect(settings.db_path))
    save_rating(conn, 1, 2, "blend", 4, ["smooth"])
    save_rating(conn, 2, 3, "cut", 2, [])
    mix.set_mix_name(conn, "Friday")
    mix.remember(conn, "a change")
    first = mix.create_draft(conn, "Warm up", [(5, None, 0), (6, None, 0)])
    mix.create_draft(conn, "Empty one")
    mix.join_line(conn, first)
    agreed = song_requests.add_request(conn, 5)
    song_requests.choose_bridge(conn, agreed, True, [6, 5])
    refused = song_requests.add_request(conn, 7)
    song_requests.choose_bridge(conn, refused, False)
    song_requests.cancel_request(conn, song_requests.add_request(conn, 8))
    song_requests.add_request(conn, 9)
    conn.executemany(
        "INSERT INTO seam_book(song_a,song_b,kind,payload,score,status) VALUES(?,?,?,?,?,?)",
        [
            (1, 2, "same_melody", json.dumps({"old": 1}), 0.9, "new"),
            (2, 3, "harmonic_cousin", json.dumps({"old": 2}), 0.8, "approved"),
            (4, 5, "exact_word", json.dumps({"phrase": "love"}), 0.7, "rejected"),
        ],
    )
    conn.commit()
    trials = listening.create_trials(
        conn, "old", [{"pair": "1-2", "conditions": ["seamkeyaa", "seamkeybb"]}], 3
    )
    listening.respond(conn, trials[0], "me", "a", "headphones", {"a": {"grade": 4, "tags": []}})
    kept = conversations.create(conn, "Kept chat", {"kind": "current"})
    conversations.accept_turn(conn, kept["id"], "c-1", "a made-up request")
    conversations.add_message(conn, kept["id"], "assistant", "a made-up reply")
    conversations.set_archived(conn, conversations.create(conn, "Old chat")["id"], True)
    proposal = proposals.ensure_proposal(conn, kept["id"])
    proposals.add_revision(conn, proposal, _snap([1, 2, 3]), kind="plan", expected_current=None)
    memory.add_fact(conn, "Tempo", "made-up preference")
    memory.record_listening(conn, 1, "s", "player", "complete", 200.0, 200.0)
    conn.close()
    _seam_files(settings)


def _seam_files(settings: Settings) -> None:
    """Seam records as a long-used home holds them: render folders, history files that are
    older versions, and Good and Bad verdicts."""
    for n, (a, b) in enumerate(SEAM_PAIRS):
        key = SeamRequest(a, b).key
        rating = ("good", "bad", None)[n % 3]
        state = _ready(key, a, b, rating=rating, rated_at=1_700_000_000.0 + n)
        history = settings.home / "seam-history" / f"{key}.json"
        history.parent.mkdir(parents=True, exist_ok=True)
        history.write_text(json.dumps(_ready(key, a, b) if n % 2 else state), "utf-8")
        if n % 4 != 3:  # the render cache cleared the last of each four: history only
            folder = settings.renders_dir / "seams" / key
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "seam.json").write_text(json.dumps(state), "utf-8")


def _columns(path: Path) -> dict[str, list[str]]:
    conn = sqlite3.connect(path)
    try:
        names = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            name: [
                row[1]
                for row in conn.execute(f'PRAGMA table_info("{name}")')
                if row[1] not in REDERIVED.get(name, ())
            ]
            for name in names
        }
    finally:
        conn.close()


def _hashes(path: Path, columns: dict[str, list[str]]) -> dict[str, tuple[int, str]]:
    """Each table's row count and a hash of its rows, over these columns only."""
    conn = sqlite3.connect(path)
    try:
        found = {}
        for table, names in columns.items():
            listed = ", ".join(f'"{name}"' for name in names)
            rows = sorted(
                repr(tuple(row)) for row in conn.execute(f'SELECT {listed} FROM "{table}"')
            )
            found[table] = (len(rows), hashlib.sha256("\n".join(rows).encode()).hexdigest())
        return found
    finally:
        conn.close()


def _start(settings: Settings, flag: str, *, restoring: bool = False) -> dict[str, object]:
    """Start the app with the flag as given, run the start-up seam import, read every page."""
    flags.use(flag)
    db._CHECKED.clear()
    forget_all()
    app = create_app(settings, settings.home / "no-web", prepare_links=False)
    if flags.on("core.engine_store"):
        seam_import.import_home(library.store_for(settings.db_path), settings.home)
    with TestClient(app) as client:
        if restoring:
            status = client.get("/api/backup/status").json()
            assert status["problem"] is None and not status["pending_restart"], status
        pages = {}
        for page in PAGES:
            response = client.get(page)
            assert response.status_code == 200, (page, response.text)
            pages[page] = response.json()
    for fact in pages["/api/lucy/memory"].get("facts", []):
        if fact.get("kind") == "inferred":
            for name in REDERIVED["lucy_memory"]:
                fact.pop(name, None)
    return pages


def _copy(source: Path, target: Path) -> None:
    """A consistent copy of a library file, whatever its journal holds."""
    conn, copy = sqlite3.connect(source), sqlite3.connect(target)
    try:
        conn.backup(copy)
    finally:
        copy.close()
        conn.close()


def _compare_tool():
    path = Path(__file__).resolve().parents[1] / "tools" / "library_compare.py"
    spec = importlib.util.spec_from_file_location("library_compare", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _stamp(path: Path) -> str | None:
    conn = sqlite3.connect(path)
    try:
        return library.stamp_of(conn)
    finally:
        conn.close()


def _restored(settings: Settings, data: bytes, flag: str) -> dict[str, object]:
    flags.use(flag)
    stage_restore(settings, data, hashlib.sha256(data).hexdigest())
    return _start(settings, flag, restoring=True)


def test_a_whole_library_on_off_on_and_its_backup_both_ways(homes):
    home = homes("home")
    _make(home)
    _start(home, "")  # the first start settles anything a start writes, and what the
    off_pages = _start(home, "")  # process still held from making the library
    columns = _columns(home.db_path)
    before = _hashes(home.db_path, columns)
    assert _stamp(home.db_path) is None

    reference = home.home.parent / "before.sqlite"
    _copy(home.db_path, reference)
    on_pages = _start(home, FLAG_ON)
    assert _stamp(home.db_path) == library.head()
    assert _hashes(home.db_path, columns) == before
    assert on_pages == off_pages
    adopted = _columns(home.db_path)
    assert all("workspace_id" in adopted[table] for table in ("ratings", "queue", "drafts"))
    store = library.store_for(home.db_path)
    assert len(stored_seams.records(store)) == len(SEAM_PAIRS)  # every seam record kept

    # the owner's tool for a copy of a real library says the same
    assert {verdict for *_, verdict in _compare_tool().compare(reference, home.db_path)} == {
        "same",
        "new",
    }

    assert _start(home, "") == off_pages  # off again on the same file
    assert _hashes(home.db_path, columns) == before
    assert _start(home, FLAG_ON) == off_pages  # and on again
    assert _hashes(home.db_path, columns) == before

    conn = db.connect(home.db_path)
    try:
        data = export_backup(conn, home)
    finally:
        conn.close()
    for name, flag in (("restored-off", ""), ("restored-on", FLAG_ON)):
        other = homes(name)
        # a library of its own, which the restore replaces; no app has run on it in this
        # process, as a real restore is applied when the app starts
        _make(other)
        pages = _restored(other, data, flag)
        assert _hashes(other.db_path, columns) == before, name
        assert _stamp(other.db_path) == library.head(), name
        for page in WITHOUT_PATHS:
            assert pages[page] == off_pages[page], (name, page)
