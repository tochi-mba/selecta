"""Regression: a guest request asks the local catalogue about a song while Rooms holds the SQLite
write lock. The catalogue must read alongside it, never queue behind it (which used to hang for
the 30 s busy timeout and then fail), and `rooms.requesting` stays exactly as production has it.
"""

from __future__ import annotations

import inspect
import time

from selecta.devstack import rooms as dev_rooms
from selecta.persistence import db_now, new_id, transaction
from selecta.rooms import requesting
from selecta.storage.keys import original_key
from selecta.storage.schema import assets


def _add_song(engine, workspace_id: str) -> None:
    asset_id = new_id()
    with transaction(engine, workspace_id) as conn:
        conn.execute(
            assets.insert().values(
                id=asset_id, workspace_id=workspace_id,
                original_key=original_key(workspace_id, asset_id), size=10, sha256="0" * 64,
                format="wav", duration_s=4.0, sample_rate=44_100, channels=2,
                created_at=db_now(conn),
            )
        )


def test_catalogue_reads_while_the_rooms_transaction_holds_the_write_lock(sqlite_engine):
    from selecta.identity import accounts
    from selecta.identity.tokens import Claims

    claims = Claims(subject="user_dev_rooms", issued_at=0, expires_at=4e9)
    with transaction(sqlite_engine) as conn:
        made = accounts.provision(conn, claims, age_confirmed=True)
    workspace_id = made.workspace.id
    _add_song(sqlite_engine, workspace_id)
    catalog = dev_rooms.LibraryCatalog(sqlite_engine)
    started = time.monotonic()
    with transaction(sqlite_engine, workspace_id):  # BEGIN IMMEDIATE: the write lock is held
        assert catalog.is_requestable(workspace_id, 1)
        assert not catalog.is_requestable(workspace_id, 2)
    assert time.monotonic() - started < 5


def test_production_request_check_has_no_dev_only_hook():
    source = inspect.getsource(requesting)
    assert "is_requestable_in_transaction" not in source
    assert "ctx.catalog.is_requestable(room.workspace_id, song_id)" in source
