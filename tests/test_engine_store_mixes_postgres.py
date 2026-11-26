"""Mix tables fail closed on PostgreSQL (ADR-0479, migration `es0479mix01`).

A transaction that names no workspace sees and writes no mix row, one workspace never reads or
writes another's, and the current mix can't name another workspace's song. Runs only where
`SELECTA_TEST_POSTGRES_URL` is set (the Linux CI job); `postgres_engine` skips otherwise, since
SQLite has no row-level security.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta import mix
from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import StoreMixes
from selecta.engine_store.schema import MIX_TABLES, drafts, queue
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction


def _songs(engine, workspace_id: str) -> tuple[int, int]:
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
            for n in (1, 2)
        ]
    return ids[0], ids[1]


def _mix(engine, workspace_id: str, songs: tuple[int, int], name: str) -> None:
    store = EngineStore(engine, workspace_id)
    with store.write() as connection:
        mixes = StoreMixes(connection, store)
        mix.remember(mixes, "start")
        mix.write_order(mixes, [(songs[0], None, 0), (songs[1], None, 0)])
        mix.create_draft(mixes, name, [(songs[1], None, 0)])


@pytest.fixture
def two_workspaces(postgres_engine):
    a, b = new_id(), new_id()
    songs_a = _songs(postgres_engine, a)
    _mix(postgres_engine, a, songs_a, "Alice")
    songs_b = _songs(postgres_engine, b)
    _mix(postgres_engine, b, songs_b, "Bob")
    return postgres_engine, a, b, songs_a, songs_b


def test_no_workspace_sees_and_writes_no_mix_rows(two_workspaces):
    engine, a, _b, songs_a, _songs_b = two_workspaces
    with transaction(engine) as conn:
        for table in MIX_TABLES:
            assert conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one() == 0
    with pytest.raises(sa.exc.DBAPIError), transaction(engine) as conn:
        conn.execute(sa.insert(drafts).values(workspace_id=a, name="x", items="[]", history="[]"))


def test_one_workspace_never_reads_or_writes_anothers_mixes(two_workspaces):
    engine, a, b, _songs_a, songs_b = two_workspaces
    with transaction(engine, a) as conn:
        assert list(conn.execute(sa.select(drafts.c.name)).scalars()) == ["Alice"]
    store = EngineStore(engine, b)
    with store.read() as connection:
        assert [row["name"] for row in mix.all_drafts(StoreMixes(connection, store))] == ["Bob"]
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(sa.insert(drafts).values(workspace_id=b, name="y", items="[]", history="[]"))
    # the current mix names only this workspace's songs, by foreign key
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(sa.insert(queue).values(workspace_id=a, position=9, song_id=songs_b[0]))


def test_every_mix_table_has_the_policy_without_an_empty_scope(postgres_engine):
    with postgres_engine.connect() as conn:
        for table in MIX_TABLES:
            qual = conn.execute(
                sa.text(
                    "SELECT qual FROM pg_policies WHERE schemaname = current_schema() "
                    "AND tablename = :name AND policyname = 'workspace_isolation'"
                ),
                {"name": table.name},
            ).scalar_one()
            assert "app.workspace_id" in qual
            assert "''" not in qual and "coalesce" not in qual.lower()
