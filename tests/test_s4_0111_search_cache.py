"""S4-0111-05: a search asked again over unchanged names is answered from memory, and any change to
a name, a new song, a removal or a duplicate marking (from any connection) is searched afresh."""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.library import search_cache
from selecta.library.relevance import rank_songs
from selecta.library.search_cache import RankedSearches


def _library(path, count=300):
    conn = db.connect(path)
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        [
            (n, f"song-{n}.flac", f"Artist {n % 30}", f"{'Golden' if n % 4 == 0 else 'Quiet'} {n}")
            for n in range(1, count + 1)
        ],
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) SELECT id,?,120.0,'8A' FROM songs",
        (ANALYSIS_VERSION,),
    )
    conn.commit()
    return conn


def _expected(conn, query):
    rows = conn.execute("SELECT id,artist,title FROM songs WHERE duplicate_of IS NULL").fetchall()
    return rank_songs(query, [tuple(row) for row in rows])


@pytest.fixture
def conn(tmp_path):
    connection = _library(tmp_path / "library.sqlite")
    yield connection
    connection.close()


def test_the_same_search_over_the_same_names_is_ranked_once(conn):
    searches = RankedSearches()
    first = searches.rank(conn, "golden")
    again = searches.rank(conn, "golden")
    assert first == again == _expected(conn, "golden")
    assert searches.ranked_afresh == 1
    # another search is ranked, and the first is still remembered
    assert searches.rank(conn, "quiet") == _expected(conn, "quiet")
    searches.rank(conn, "golden")
    assert searches.ranked_afresh == 2


@pytest.mark.parametrize(
    "change",
    [
        "UPDATE songs SET title='Golden Hour' WHERE id=1",
        "UPDATE songs SET artist='Goldenvoice' WHERE id=2",
        "UPDATE songs SET title=NULL WHERE id=4",
        "UPDATE songs SET duplicate_of=4 WHERE id=8",
        "DELETE FROM songs WHERE id=12",
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(9999,'new.flac','f',1,1.0,200.0,'Someone','Golden New',1)",
    ],
)
def test_a_change_from_another_connection_is_searched_afresh(tmp_path, conn, change):
    searches = RankedSearches()
    before = searches.rank(conn, "golden")
    other = sqlite3.connect(tmp_path / "library.sqlite")
    other.execute("PRAGMA foreign_keys=ON")
    other.execute(change)
    other.commit()
    other.close()
    after = searches.rank(conn, "golden")
    assert searches.ranked_afresh == 2
    assert after == _expected(conn, "golden")
    assert after != before


def test_names_that_could_run_together_still_read_differently(conn):
    # an artist and title moved across the boundary between them must not look unchanged
    conn.execute("UPDATE songs SET artist='Gold', title='en 1' WHERE id=1")
    conn.commit()
    searches = RankedSearches()
    searches.rank(conn, "golden")
    conn.execute("UPDATE songs SET artist='Golden', title=' 1' WHERE id=1")
    conn.commit()
    assert searches.rank(conn, "golden") == _expected(conn, "golden")
    assert searches.ranked_afresh == 2


def test_only_the_last_few_searches_are_kept(conn):
    searches = RankedSearches(keep=2)
    for query in ["golden", "quiet", "artist"]:
        searches.rank(conn, query)
    searches.rank(conn, "golden")
    assert searches.ranked_afresh == 4


def test_the_library_page_uses_one_ranking_for_its_count_page_and_refresh(tmp_path, monkeypatch):
    _library(Settings(tmp_path).db_path).close()
    calls = []
    real = search_cache.rank_songs

    def counted(query, songs):
        calls.append(query)
        return real(query, songs)

    monkeypatch.setattr(search_cache, "rank_songs", counted)
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    first = client.get("/api/library", params={"q": "golden", "limit": 20}).json()
    assert first["total"] == 75
    following = client.get(
        "/api/library", params={"q": "golden", "limit": 20, "after": first["next"]}
    )
    ready = client.get("/api/library", params={"q": "golden", "state": "ready", "limit": 20})
    again = client.get("/api/library", params={"q": "golden", "limit": 20}).json()
    assert following.status_code == ready.status_code == 200
    assert again == first
    assert calls == ["golden"]
    # a rename is seen by the very next search
    conn = db.connect(Settings(tmp_path).db_path)
    conn.execute("UPDATE songs SET title='Quiet 4' WHERE id=4")
    conn.commit()
    conn.close()
    renamed = client.get("/api/library", params={"q": "golden", "limit": 200}).json()
    assert renamed["total"] == 74
    assert 4 not in {song["id"] for song in renamed["songs"]}
    assert calls == ["golden", "golden"]


class _NamesReadBeforeAWrite:
    """The route's connection, with its names read just before another connection's write lands
    (the request is between its two reads when the write commits)."""

    def __init__(self, conn, names):
        self._conn, self._names = conn, names

    def execute(self, sql, *args):
        if sql == search_cache.NAMES and self._names is not None:
            names, self._names = self._names, None  # only the first read is from before
            return type("Row", (), {"fetchone": lambda _self: (names,)})()
        return self._conn.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def test_names_and_songs_read_either_side_of_a_write_are_never_kept_together(tmp_path, conn):
    # rv2-a: a ranking must never be kept under names that differ from the songs it ranked.
    # Here the names are read, a rename commits, then the songs are read: the ranking of the
    # renamed songs was kept under the old names, so renaming back served the stale ranking.
    searches = RankedSearches()
    old_names = conn.execute(search_cache.NAMES).fetchone()[0]
    conn.execute("UPDATE songs SET title='Golden Hour' WHERE id=1")
    conn.commit()
    searches.rank(_NamesReadBeforeAWrite(conn, old_names), "golden")
    conn.execute("UPDATE songs SET title='Quiet 1' WHERE id=1")  # renamed back
    conn.commit()
    assert searches.rank(conn, "golden") == _expected(conn, "golden")
