"""Seam tables fail closed on PostgreSQL (ADR-0479, migration `es0479seam01`).

A transaction that names no workspace sees and writes no seam row, and one workspace never
reads or writes another's. Runs only where `SELECTA_TEST_POSTGRES_URL` is set (the Linux CI
job); `postgres_engine` skips otherwise, since SQLite has no row-level security.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored
from selecta.engine_store.schema import SEAM_TABLES, seams
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction


def _songs(engine, workspace_id: str) -> tuple[int, int]:
    with transaction(engine, workspace_id) as conn:
        ids = []
        for n in (1, 2):
            ids.append(
                conn.execute(
                    sa.insert(local_songs)
                    .values(
                        workspace_id=workspace_id,
                        content_sha256=f"{n:064x}",
                        title=f"Song {n}",
                        artist="Artist",
                        duration_s=200.0,
                        created_at=1.0,
                        updated_at=1.0,
                    )
                    .returning(local_songs.c.id)
                ).scalar_one()
            )
    return ids[0], ids[1]


def _record(key: str, a: int, b: int) -> dict:
    return {
        "status": "ready",
        "key": key,
        "request": {"a": a, "b": b},
        "style": "echo_out",
        "passed": True,
        "rating": "good",
        "rated_at": 1.0,
    }


@pytest.fixture
def two_workspaces(postgres_engine):
    a, b = new_id(), new_id()
    one, two = _songs(postgres_engine, a)
    stored.keep(EngineStore(postgres_engine, a), _record("k" * 20, one, two))
    three, four = _songs(postgres_engine, b)
    stored.keep(EngineStore(postgres_engine, b), _record("j" * 20, three, four))
    return postgres_engine, a, b, (one, two)


def test_no_workspace_sees_and_writes_no_seam_rows(two_workspaces):
    engine, a, _b, (one, two) = two_workspaces
    with transaction(engine) as conn:
        for table in SEAM_TABLES:
            assert conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one() == 0
    with pytest.raises(sa.exc.DBAPIError), transaction(engine) as conn:
        conn.execute(sa.insert(seams).values(**stored.row_of(a, _record("x" * 20, one, two))))


def test_one_workspace_never_reads_or_writes_anothers_seams(two_workspaces):
    engine, a, b, (one, two) = two_workspaces
    with transaction(engine, a) as conn:
        assert list(conn.execute(sa.select(seams.c.key)).scalars()) == ["k" * 20]
    assert [r["key"] for r in stored.records(EngineStore(engine, b))] == ["j" * 20]
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(sa.insert(seams).values(**stored.row_of(b, _record("y" * 20, one, two))))


def test_every_seam_table_has_the_policy_without_an_empty_scope(postgres_engine):
    with postgres_engine.connect() as conn:
        for table in SEAM_TABLES:
            qual = conn.execute(
                sa.text(
                    "SELECT qual FROM pg_policies WHERE schemaname = current_schema() "
                    "AND tablename = :name AND policyname = 'workspace_isolation'"
                ),
                {"name": table.name},
            ).scalar_one()
            assert "app.workspace_id" in qual
            assert "''" not in qual and "coalesce" not in qual.lower()
