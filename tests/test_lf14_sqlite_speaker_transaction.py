"""Speaker readiness inside a Rooms write transaction cannot acquire a second writer."""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import make_engine, migrate, transaction
from selecta.rooms.cloud_ports import CloudSpeakers


def test_cloud_speaker_readiness_does_not_nest_sqlite_transactions(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'rooms.sqlite').as_posix()}")
    try:
        migrate.upgrade(engine)
        with transaction(engine) as conn:
            # Ensure the outer connection really holds SQLite's writer slot.
            conn.execute(sa.text("CREATE TEMP TABLE in_tx_lease_probe (id INTEGER)"))
            assert not CloudSpeakers(engine).speaker_online_in_tx(
                conn, "test_workspace", now=10.0
            )
            conn.execute(sa.text("INSERT INTO in_tx_lease_probe VALUES (1)"))
    finally:
        engine.dispose()
