"""Discovery tables fail closed on PostgreSQL (ADR-0479, migration `es0479disc01`).

A transaction that names no workspace sees and writes no link or compared mark, one workspace
never reads or writes another's, a row can't name another workspace's song, the same link is kept
once per workspace, and a pair's links and mark land together. Runs only where
`SELECTA_TEST_POSTGRES_URL` is set (the Linux CI job); `postgres_engine` skips otherwise, since
SQLite has no row-level security.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.engine_store import EngineStore
from selecta.engine_store import discovery as stored
from selecta.engine_store.schema import DISCOVERY_TABLES, discovery_comparisons, seam_book
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
                    artist=f"Artist {n}",
                    duration_s=200.0,
                    created_at=1.0,
                    updated_at=1.0,
                )
                .returning(local_songs.c.id)
            ).scalar_one()
            for n in (1, 2)
        ]
    return ids[0], ids[1]


def _found(songs: tuple[int, int]) -> list:
    return [stored.link(*songs, stored.HARMONIC, {"bars": 8}, 0.95)]


@pytest.fixture
def two_workspaces(postgres_engine):
    a, b = new_id(), new_id()
    songs_a, songs_b = _songs(postgres_engine, a), _songs(postgres_engine, b)
    for workspace, songs in ((a, songs_a), (b, songs_b)):
        store = EngineStore(postgres_engine, workspace)
        stored.record_pair(store, *songs, ("fa", "fb"), _found(songs))
    return postgres_engine, a, b, songs_a, songs_b


def test_no_workspace_sees_and_writes_no_discovery_rows(two_workspaces):
    engine, a, _b, songs_a, _songs_b = two_workspaces
    with transaction(engine) as conn:
        for table in DISCOVERY_TABLES:
            assert conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one() == 0
    with pytest.raises(sa.exc.DBAPIError), transaction(engine) as conn:
        conn.execute(
            sa.insert(seam_book).values(
                workspace_id=a, song_a=songs_a[0], song_b=songs_a[1], kind="k", payload="{}",
                score=1.0,
            )
        )


def test_one_workspace_never_reads_or_writes_anothers_discoveries(two_workspaces):
    engine, a, b, songs_a, songs_b = two_workspaces
    alice, bob = EngineStore(engine, a), EngineStore(engine, b)
    assert [row["song_a"] for row in stored.listed(bob)] == [songs_b[0]]
    (alice_link,) = stored.listed(alice)
    assert stored.review(bob, alice_link["id"], "approved") is False
    assert stored.harmonic_link(bob, alice_link["id"]) is None
    assert stored.compared(bob) == {songs_b: ("fa", "fb")}
    # the same link again is kept once; another workspace's identical link is its own
    assert stored.record_pair(alice, *songs_a, ("fa", "fb"), _found(songs_a)) == 0
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(discovery_comparisons).values(
                workspace_id=b, song_a=songs_b[0], song_b=songs_b[1], fingerprint_a="x",
                fingerprint_b="y",
            )
        )
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(seam_book).values(
                workspace_id=a, song_a=songs_b[0], song_b=songs_a[1], kind="k", payload="{}",
                score=1.0,
            )
        )


def test_a_pairs_links_and_mark_land_together(two_workspaces, monkeypatch):
    engine, a, _b, songs_a, _songs_b = two_workspaces
    store = EngineStore(engine, a)
    with transaction(engine, a) as conn:
        conn.execute(sa.delete(discovery_comparisons))
        conn.execute(sa.delete(seam_book))

    real = stored._insert_new

    def links_then_crash(connection, store_, links):
        real(connection, store_, links)
        raise RuntimeError("cut off part way")

    monkeypatch.setattr(stored, "_insert_new", links_then_crash)
    with pytest.raises(RuntimeError):
        stored.record_pair(store, *songs_a, ("fa", "fb"), _found(songs_a))
    assert stored.listed(store) == [] and stored.compared(store) == {}


def test_every_discovery_table_has_the_policy_without_an_empty_scope(postgres_engine):
    with postgres_engine.connect() as conn:
        for table in DISCOVERY_TABLES:
            qual = conn.execute(
                sa.text(
                    "SELECT qual FROM pg_policies WHERE schemaname = current_schema() "
                    "AND tablename = :name AND policyname = 'workspace_isolation'"
                ),
                {"name": table.name},
            ).scalar_one()
            assert "app.workspace_id" in qual
            assert "''" not in qual and "coalesce" not in qual.lower()
