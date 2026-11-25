"""Engine tables fail closed on PostgreSQL (ADR-0479, migration `es0479rate01`).

Unlike the older tenant tables, whose policy lets a transaction that names no workspace through, an
engine table shows such a transaction nothing, and one workspace never reads another's rows. Runs
only where `SELECTA_TEST_POSTGRES_URL` is set (the Linux CI job); `postgres_engine` skips
otherwise, since SQLite has no row-level security.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.engine_store import EngineStore
from selecta.engine_store import ratings as stored
from selecta.engine_store.schema import ratings
from selecta.persistence import new_id, transaction


@pytest.fixture
def two_workspaces(postgres_engine):
    a, b = new_id(), new_id()
    stored.save(EngineStore(postgres_engine, a), 1, 2, "blend", 4, ["smooth"])
    stored.save(EngineStore(postgres_engine, a), 2, 1, "cut", 2, [])
    stored.save(EngineStore(postgres_engine, b), 3, 4, "echo", 5, [])
    return postgres_engine, a, b


def test_a_transaction_that_names_no_workspace_reads_no_engine_rows(two_workspaces):
    engine, _a, _b = two_workspaces
    with transaction(engine) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(ratings)).scalar_one() == 0
        assert conn.execute(sa.text("SELECT count(*) FROM ratings")).scalar_one() == 0


def test_a_transaction_that_names_no_workspace_cannot_write_an_engine_row(postgres_engine):
    with pytest.raises(sa.exc.DBAPIError), transaction(postgres_engine) as conn:
        conn.execute(
            sa.insert(ratings).values(
                workspace_id=new_id(), song_a=1, song_b=2, method="cut", rating=3
            )
        )


def test_one_workspace_cannot_read_another_workspaces_ratings(two_workspaces):
    engine, a, b = two_workspaces
    with transaction(engine, a) as conn:
        # no WHERE: the policy alone keeps b's row out
        methods = sorted(conn.execute(sa.select(ratings.c.method)).scalars())
    assert methods == ["blend", "cut"]
    assert stored.count(EngineStore(engine, b)) == 1
    assert set(stored.results(EngineStore(engine, b))) == {"echo"}


def test_a_workspace_cannot_write_a_rating_for_another(two_workspaces):
    engine, a, b = two_workspaces
    with pytest.raises(sa.exc.DBAPIError), transaction(engine, a) as conn:
        conn.execute(
            sa.insert(ratings).values(workspace_id=b, song_a=1, song_b=2, method="cut", rating=3)
        )


def test_the_engine_policy_has_no_empty_scope_branch(postgres_engine):
    with postgres_engine.connect() as conn:
        qual = conn.execute(
            sa.text(
                "SELECT qual FROM pg_policies WHERE schemaname = current_schema() "
                "AND tablename = 'ratings' AND policyname = 'workspace_isolation'"
            )
        ).scalar_one()
    assert "app.workspace_id" in qual
    assert "''" not in qual and "coalesce" not in qual.lower()
