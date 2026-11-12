"""r8a: My Mixes stays quick with 500 drafts, each with a full history of revisions.

The list is read with a fixed number of queries however many drafts there are (no query per draft),
never loads the revisions it doesn't show, walks an index in its own order instead of sorting, and
looks at the seams on disk once. Opening, renaming, copying, deleting and playing a draft each touch
that draft alone. The fixture is tests/mix_scale.py."""

from __future__ import annotations

import statistics
import time

import pytest
from fastapi.testclient import TestClient
from mix_scale import MIXES, REVISIONS, make_mixes

from selecta import db, mix
from selecta.api import create_app
from selecta.config import Settings
from selecta.eta import JobClock, time_ahead
from selecta.seams import SeamStore

# Whole requests on a loaded, shared 4-core laptop. Before r8a the list took about 52 s for 500
# drafts (5,006 queries and a disk read per seam per draft) and opening one draft about 0.9 s; the
# query-count and plan tests below are what catch a regression, the budgets only a gross one.
LIST_BUDGET_S = 6.0
OPEN_BUDGET_S = 1.5
# One query for the drafts, a couple for their songs, and the render line's own few: not per draft.
LIST_MOST_QUERIES = 40


@pytest.fixture(scope="module")
def home(tmp_path_factory):
    path = tmp_path_factory.mktemp("r8a-mixes")
    ids = make_mixes(Settings(path))
    return path, ids


@pytest.fixture(scope="module")
def client(home):
    path, _ids = home
    app = TestClient(create_app(Settings(path), path / "no-web"))
    # the first look settles each draft's seams once, which writes;
    # what's measured comes after
    assert app.get("/api/drafts").status_code == 200
    return app


@pytest.fixture
def statements(monkeypatch):
    """Every SQL statement the app's connections run, from here on."""
    seen: list[str] = []
    real = db.connect

    def traced(path):
        conn = real(path)
        conn.set_trace_callback(seen.append)
        return conn

    monkeypatch.setattr(db, "connect", traced)
    return seen


def _plan(conn, sql, params=()):
    return " | ".join(row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + sql, params))


def test_the_list_walks_its_index_and_the_line_reads_only_drafts_in_it(home):
    path, ids = home
    conn = db.connect(Settings(path).db_path)
    listed = _plan(conn, f"SELECT {mix.LISTED} FROM drafts {mix.LISTED_ORDER}")  # noqa: S608
    assert "SCAN drafts USING INDEX drafts_listed" in listed, listed
    assert "TEMP B-TREE" not in listed, listed
    names = _plan(conn, f"SELECT id, name FROM drafts {mix.LISTED_ORDER}")  # noqa: S608
    assert "drafts_listed" in names and "TEMP B-TREE" not in names, names
    line = _plan(conn, "SELECT id FROM drafts WHERE line IS NOT NULL ORDER BY line, id")
    assert "drafts_in_line" in line and "TEMP B-TREE" not in line, line
    cleared = _plan(conn, "UPDATE drafts SET line=NULL WHERE line IS NOT NULL")
    assert "drafts_in_line" in cleared, cleared
    # opening one draft is a primary-key lookup, never a scan
    opened = _plan(conn, "SELECT items FROM drafts WHERE id=?", (ids[250],))
    assert "SEARCH drafts USING INTEGER PRIMARY KEY" in opened, opened
    conn.close()


def test_the_list_never_reads_revisions_and_its_queries_do_not_grow_with_drafts(client, statements):
    started = time.perf_counter()
    answer = client.get("/api/drafts")
    took = time.perf_counter() - started
    assert answer.status_code == 200
    assert len(answer.json()["drafts"]) == MIXES
    print(f"[r8a] GET /api/drafts, {MIXES} drafts: {took * 1000:.0f} ms, {len(statements)} queries")
    assert len(statements) <= LIST_MOST_QUERIES, statements
    whole = [sql for sql in statements if "history" in sql or "SELECT * FROM drafts" in sql]
    assert not whole, statements


def test_the_list_says_what_each_draft_really_holds(home, client):
    """Read all at once, each draft is listed exactly as reading it on its own would list it."""
    path, ids = home
    listed = {draft["id"]: draft for draft in client.get("/api/drafts").json()["drafts"]}
    conn = db.connect(Settings(path).db_path)
    store = SeamStore(Settings(path))
    for draft in ids[::50]:
        alone = mix.read_mix(conn, store, draft)
        assert listed[draft]["song_ids"] == [item["song_id"] for item in alone]
        states = [item["seam"]["state"]["status"] for item in alone[1:]]
        assert listed[draft]["ready"] == states.count("ready")
        assert listed[draft]["seams"] == len(states)
    conn.close()


def test_the_list_and_opening_a_draft_are_quick(home, client):
    _path, ids = home
    times = []
    for _ in range(3):
        started = time.perf_counter()
        assert client.get("/api/drafts").status_code == 200
        times.append(time.perf_counter() - started)
    opens = []
    for draft in ids[200:205]:
        started = time.perf_counter()
        answer = client.get(f"/api/mix?draft={draft}")
        opens.append(time.perf_counter() - started)
        assert answer.status_code == 200 and len(answer.json()["mix"]) > 0
    print(
        f"[r8a] list median {statistics.median(times) * 1000:.0f} ms, "
        f"open median {statistics.median(opens) * 1000:.0f} ms"
    )
    assert statistics.median(times) < LIST_BUDGET_S, times
    assert statistics.median(opens) < OPEN_BUDGET_S, opens


def test_opening_and_changing_one_draft_reads_that_draft_alone(home, client, statements):
    _path, ids = home
    draft = ids[260]
    for request in (
        lambda: client.get(f"/api/mix?draft={draft}"),
        lambda: client.post(f"/api/drafts/{draft}/name", json={"name": "Renamed r8a"}),
        lambda: client.post(f"/api/drafts/{draft}/duplicate"),
    ):
        statements.clear()
        assert request().status_code == 200
        # no draft is read whole (revisions and all), and no statement walks every draft's songs
        assert not [sql for sql in statements if "SELECT *" in sql and "drafts" in sql], statements
        assert len(statements) < 80, statements


def test_deleting_or_playing_a_draft_leaves_the_other_drafts_rows_alone(home, client, statements):
    """Clearing the render line used to rewrite every draft, revisions and all."""
    _path, ids = home
    assert client.delete(f"/api/drafts/{ids[270]}").status_code == 200
    assert "UPDATE drafts SET line=NULL" not in statements
    assert any("SET line=NULL WHERE line IS NOT NULL" in sql for sql in statements)
    assert client.post(f"/api/drafts/restore?id={ids[270]}").status_code == 200
    assert client.post(f"/api/drafts/{ids[271]}/play").status_code == 200
    assert "UPDATE drafts SET line=NULL" not in statements


def test_the_lean_list_has_the_same_drafts_in_the_same_order(client, statements):
    full = client.get("/api/drafts").json()
    statements.clear()
    lean = client.get("/api/drafts/names").json()
    assert [(d["id"], d["name"]) for d in lean["drafts"]] == [
        (d["id"], d["name"]) for d in full["drafts"]
    ]
    assert lean["current"]["name"] == full["current"]["name"]
    assert all(set(draft) == {"id", "name"} for draft in lean["drafts"])
    # no songs, items or revisions are read for it
    assert not [sql for sql in statements if "items" in sql or "history" in sql], statements
    # the full list keeps its contract for everything that already reads it
    assert set(full["drafts"][0]) >= {
        "id",
        "name",
        "songs",
        "seconds",
        "seams",
        "ready",
        "failed",
        "waiting",
        "rendering",
        "place",
        "eta",
        "to_render",
        "missing",
        "song_ids",
    }


def test_a_line_added_up_one_mix_at_a_time_counts_the_same_as_all_at_once(tmp_path):
    clock = JobClock(tmp_path)

    def seam(key, status="none"):
        return {"seam": {"settings": {}, "state": {"status": status, "key": key}}}

    mixes = [[{"seam": None}, seam("a"), seam("b")], [{"seam": None}, seam("b"), seam("c")]]
    whole, seen_whole = time_ahead(mixes, clock, now=0.0)
    first, seen = time_ahead(mixes[:1], clock, now=0.0)
    more, seen = time_ahead(mixes[1:], clock, now=0.0, seen=seen)
    assert [e.seconds for e in whole] == [e.seconds for e in [*first, *more]]
    assert seen == seen_whole == {"a", "b", "c"}


def test_the_job_clock_reads_its_file_again_only_once_it_has_changed(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("cut_on_one", 4.0)
    assert clock.times()["cut_on_one"] == [4.0]
    clock.record("cut_on_one", 6.0)
    assert clock.times()["cut_on_one"] == [4.0, 6.0]
    # another process writing the file is seen too
    JobClock(tmp_path).record("cut_on_one", 8.0)
    assert clock.times()["cut_on_one"] == [4.0, 6.0, 8.0]


def test_the_fixture_is_the_size_it_says(home):
    path, ids = home
    conn = db.connect(Settings(path).db_path)
    assert len(ids) == MIXES
    deepest = conn.execute("SELECT MAX(json_array_length(history)) FROM drafts").fetchone()[0]
    assert deepest == REVISIONS
    conn.close()
