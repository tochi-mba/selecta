"""Request tables fail closed on PostgreSQL (ADR-0479, migration `es0479req01`).

A transaction that names no workspace sees and writes no request row, one workspace never reads
or writes another's, a request or mark can't name another workspace's song, an answer can't name
another workspace's request, and a request joins the mix in one transaction. Runs only where
`SELECTA_TEST_POSTGRES_URL` is set (the Linux CI job); `postgres_engine` skips otherwise, since
SQLite has no row-level security.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta import mix
from selecta import requests as song_requests
from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import StoreMixes
from selecta.engine_store.schema import (
    REQUEST_TABLES,
    request_bridge_approvals,
    request_marks,
)
from selecta.engine_store.schema import (
    song_requests as request_rows,
)
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction


def _songs(engine, workspace_id: str) -> tuple[int, int, int]:
    with transaction(engine, workspace_id) as conn:
        ids = [
            conn.execute(
                sa.insert(local_songs)
                .values(
                    workspace_id=workspace_id,
                    content_sha256=new_id().replace("-", "").ljust(64, "0")[:64],
                    title=f"Song {n}",
                    artist="Artist",
                    duration_s=200.0,
                    created_at=1.0,
                    updated_at=1.0,
                )
                .returning(local_songs.c.id)
            ).scalar_one()
            for n in (1, 2, 3)
        ]
    return ids[0], ids[1], ids[2]


def _requests(engine, workspace_id: str, songs: tuple[int, int, int]) -> int:
    store = EngineStore(engine, workspace_id)
    with store.write() as connection:
        mixes = StoreMixes(connection, store)
        mix.write_order(mixes, [(songs[0], None, 0)])
        asked = song_requests.add_request(mixes, songs[1])
        song_requests.choose_bridge(mixes, asked, False)
        later = song_requests.add_request(mixes, songs[2])
        mix.add_song(mixes, songs[2], None)
        song_requests.mark_added(mixes, later, songs[2])
    return asked


@pytest.fixture
def two_workspaces(postgres_engine):
    a, b = new_id(), new_id()
    songs_a, songs_b = _songs(postgres_engine, a), _songs(postgres_engine, b)
    asked_a = _requests(postgres_engine, a, songs_a)
    asked_b = _requests(postgres_engine, b, songs_b)
    return postgres_engine, a, b, songs_a, songs_b, asked_a, asked_b


def test_no_workspace_sees_and_writes_no_request_rows(two_workspaces):
    engine, a, _b, songs_a, _songs_b, _asked_a, _asked_b = two_workspaces
    with transaction(engine) as conn:
        for table in REQUEST_TABLES:
            assert conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one() == 0
    with pytest.raises(sa.exc.DBAPIError), transaction(engine) as conn:
        conn.execute(
            sa.insert(request_rows).values(workspace_id=a, song_id=songs_a[0], created_at="x")
        )


def test_one_workspace_never_reads_or_writes_anothers_requests(two_workspaces):
    engine, a, b, songs_a, songs_b, asked_a, asked_b = two_workspaces
    store = EngineStore(engine, b)
    assert [row["song_id"] for row in song_requests.read_requests(store)] == [songs_b[1]]
    assert song_requests.bridge_choice(store, asked_a) is None  # Alice's isn't there for Bob
    assert song_requests.cancel_request(store, asked_a) is False
    assert song_requests.read_requests(EngineStore(engine, a))[0]["song_id"] == songs_a[1]
    with transaction(engine, a) as conn:
        marks = list(conn.execute(sa.select(request_marks.c.song_id)).scalars())
    assert marks == [songs_a[2]]
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(request_rows).values(workspace_id=b, song_id=songs_b[0], created_at="x")
        )
    # a request and a mark name only this workspace's songs, an answer only its requests
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(request_rows).values(workspace_id=a, song_id=songs_b[0], created_at="x")
        )
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(sa.insert(request_marks).values(workspace_id=a, song_id=songs_b[0], kind="r"))
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(request_bridge_approvals).values(
                workspace_id=a, request_id=asked_b, signature="yes"
            )
        )


def test_a_request_joining_the_mix_lands_whole_or_not_at_all(two_workspaces):
    engine, a, _b, songs_a, _songs_b, asked_a, _asked_b = two_workspaces
    store = EngineStore(engine, a)
    with pytest.raises(RuntimeError), store.write() as connection:
        mixes = StoreMixes(connection, store)
        mix.add_song(mixes, songs_a[1], None)
        song_requests.mark_added(mixes, asked_a, songs_a[1])
        raise RuntimeError("cut off part way")
    assert [row["id"] for row in song_requests.read_requests(store)] == [asked_a]
    with store.read() as connection:
        assert len(mix._items(StoreMixes(connection, store))) == 2


def test_every_request_table_has_the_policy_without_an_empty_scope(postgres_engine):
    with postgres_engine.connect() as conn:
        for table in REQUEST_TABLES:
            qual = conn.execute(
                sa.text(
                    "SELECT qual FROM pg_policies WHERE schemaname = current_schema() "
                    "AND tablename = :name AND policyname = 'workspace_isolation'"
                ),
                {"name": table.name},
            ).scalar_one()
            assert "app.workspace_id" in qual
            assert "''" not in qual and "coalesce" not in qual.lower()
