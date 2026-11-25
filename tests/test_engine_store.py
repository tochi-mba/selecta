"""The engine store's own rules (ADR-0479): it always names a workspace, its reads never take
SQLite's write lock, and its helpers work without dialect-specific SQL. Temporary files only."""

from __future__ import annotations

import threading
import time

import pytest
import sqlalchemy as sa

from selecta.engine_store import EngineStore, NoWorkspace, insert_returning_id, upsert
from selecta.persistence import LOCAL_WORKSPACE, make_engine

notes = sa.Table(
    "notes",
    sa.MetaData(),
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("body", sa.Text),
    sa.UniqueConstraint("workspace_id", "name"),
)


@pytest.fixture
def engine(tmp_path):
    made = make_engine(f"sqlite:///{(tmp_path / 'store.sqlite').as_posix()}")
    notes.create(made)
    yield made
    made.dispose()


@pytest.mark.parametrize("workspace", [None, "", "   "])
def test_the_store_refuses_to_run_without_a_workspace(engine, workspace):
    with pytest.raises(NoWorkspace):
        EngineStore(engine, workspace)


def test_desktop_names_the_local_workspace(engine):
    assert EngineStore(engine, LOCAL_WORKSPACE).workspace_id == "local"


def test_a_read_does_not_wait_behind_an_open_write_in_another_connection(engine):
    store = EngineStore(engine, LOCAL_WORKSPACE)
    with store.write() as connection:
        connection.execute(sa.insert(notes).values(workspace_id="local", name="kept", body="1"))
    writing, release = threading.Event(), threading.Event()

    def hold_the_write_lock() -> None:
        with store.write() as connection:
            connection.execute(
                sa.insert(notes).values(workspace_id="local", name="pending", body="2")
            )
            writing.set()
            release.wait(10)

    writer = threading.Thread(target=hold_the_write_lock)
    writer.start()
    try:
        assert writing.wait(10)
        started = time.monotonic()
        with store.read() as connection:
            names = sorted(connection.execute(sa.select(notes.c.name)).scalars())
        # an immediate BEGIN would have waited for the 30 s busy timeout
        assert time.monotonic() - started < 5
        assert names == ["kept"]  # the last commit, not the writer's pending row
    finally:
        release.set()
        writer.join(10)


def test_a_read_holds_no_write_lock_so_a_writer_can_start_during_it(engine):
    store = EngineStore(engine, LOCAL_WORKSPACE)
    with store.read() as reading:
        reading.execute(sa.select(notes.c.name)).all()
        done = threading.Event()

        def write() -> None:
            with store.write() as connection:
                connection.execute(sa.insert(notes).values(workspace_id="local", name="w"))
            done.set()

        writer = threading.Thread(target=write)
        writer.start()
        assert done.wait(5), "the write waited for a read"
        writer.join(5)


def test_upsert_inserts_then_updates_by_its_keys(engine):
    store = EngineStore(engine, LOCAL_WORKSPACE)
    with store.write() as connection:
        upsert(connection, notes, {"workspace_id": "local", "name": "a", "body": "1"},
               keys=["workspace_id", "name"])
        upsert(connection, notes, {"workspace_id": "local", "name": "a", "body": "2"},
               keys=["workspace_id", "name"])
    with store.read() as connection:
        rows = connection.execute(sa.select(notes.c.name, notes.c.body)).all()
    assert rows == [("a", "2")]


def test_upsert_with_nothing_to_update_keeps_the_first_row(engine):
    store = EngineStore(engine, LOCAL_WORKSPACE)
    with store.write() as connection:
        for body in ("1", "2"):
            upsert(connection, notes, {"workspace_id": "local", "name": "a", "body": body},
                   keys=["workspace_id", "name"], update=[])
    with store.read() as connection:
        assert connection.execute(sa.select(notes.c.body)).scalar_one() == "1"


def test_insert_returning_id_gives_each_new_row_its_own_id(engine):
    store = EngineStore(engine, LOCAL_WORKSPACE)
    with store.write() as connection:
        first = insert_returning_id(connection, notes, {"workspace_id": "local", "name": "x"})
        second = insert_returning_id(connection, notes, {"workspace_id": "local", "name": "y"})
    assert first != second
    with store.read() as connection:
        found = dict(connection.execute(sa.select(notes.c.id, notes.c.name)).all())
    assert found == {first: "x", second: "y"}


def test_mine_filters_to_the_store_workspace(engine):
    with EngineStore(engine, "a").write() as connection:
        connection.execute(sa.insert(notes).values(workspace_id="a", name="mine"))
        connection.execute(sa.insert(notes).values(workspace_id="b", name="theirs"))
    store = EngineStore(engine, "a")
    with store.read() as connection:
        names = connection.execute(sa.select(notes.c.name).where(store.mine(notes))).scalars()
        assert list(names) == ["mine"]
