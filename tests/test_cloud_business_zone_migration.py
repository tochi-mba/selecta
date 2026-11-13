"""Regression coverage for expanding existing Cloud data to business/zone playback.

The migration must not reset an existing personal workspace's speaker or playhead.
The SQLite fixture keeps foreign keys enabled, as production cloud SQLite tests do.
"""

from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa

from selecta.persistence import make_engine
from selecta.persistence.migrate import downgrade, pending_changes, upgrade


def test_business_zone_upgrade_keeps_existing_personal_playback(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'business_upgrade.sqlite'}")
    try:
        upgrade(engine, "merge_0416_heads")
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO users "
                "(id, auth_subject, email_verified, timezone, age_confirmed, created_at) "
                "VALUES ('user-1', 'test|existing', 1, 'Europe/London', 1, 1)"
            )
            connection.exec_driver_sql(
                "INSERT INTO workspaces (id, name, kind, owner_user_id, created_at) "
                "VALUES ('workspace-1', 'Personal', 'personal', 'user-1', 2)"
            )
            connection.exec_driver_sql(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                "VALUES ('workspace-1', 'user-1', 'owner', 2)"
            )
            connection.exec_driver_sql(
                "INSERT INTO devices "
                "(id, workspace_id, user_id, name, kind, capabilities, "
                "created_at, last_seen_at) "
                "VALUES ('device-1', 'workspace-1', 'user-1', 'Original device', "
                "'laptop', '{}', 2, 3)"
            )
            connection.exec_driver_sql(
                "INSERT INTO playback_sessions "
                "(workspace_id, mix_revision_id, song_index, offset_ms, anchor_at, "
                "state, active_device_id, lease_expires_at, seq, updated_at) "
                "VALUES ('workspace-1', 'mix-1', 7, 12345, 8, 'paused', "
                "'device-1', 33, 5, 9)"
            )

        upgrade(engine)
        with engine.connect() as connection:
            session = connection.execute(
                sa.text(
                    "SELECT id, workspace_id, zone_id, mix_revision_id, song_index, "
                    "offset_ms, anchor_at, state, active_device_id, lease_expires_at, "
                    "seq, updated_at FROM playback_sessions"
                )
            ).mappings().one()
            assert str(UUID(session["id"])) == session["id"]
            assert dict(session) | {"id": None} == {
                "id": None, "workspace_id": "workspace-1", "zone_id": None,
                "mix_revision_id": "mix-1", "song_index": 7, "offset_ms": 12345,
                "anchor_at": 8.0, "state": "paused", "active_device_id": "device-1",
                "lease_expires_at": 33.0, "seq": 5, "updated_at": 9.0,
            }
            assert connection.exec_driver_sql(
                "SELECT principal FROM devices WHERE id = 'device-1'"
            ).scalar_one() == "person"
            assert connection.exec_driver_sql(
                "SELECT pilot_until, legal_name FROM workspaces WHERE id = 'workspace-1'"
            ).one() == (None, None)

        # New kinds and memberships must be possible after the expand.
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO workspaces (id, name, kind, owner_user_id, created_at) "
                "VALUES ('business-1', 'Venue', 'business', 'user-1', 10)"
            )
            connection.exec_driver_sql(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                "VALUES ('business-1', 'user-1', 'business_member', 10)"
            )
        assert pending_changes(engine) == []

        # Roll back business-only rows, then confirm a downgrade does not drop playback.
        with engine.begin() as connection:
            connection.exec_driver_sql(\n                "DELETE FROM workspace_members WHERE workspace_id = 'business-1'"\n            )
            connection.exec_driver_sql("DELETE FROM workspaces WHERE id = 'business-1'")
        downgrade(engine, "merge_0416_heads")
        with engine.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT workspace_id, song_index, offset_ms, state, active_device_id, seq "
                "FROM playback_sessions"
            ).one() == ("workspace-1", 7, 12345, "paused", "device-1", 5)
        columns = sa.inspect(engine).get_columns("playback_sessions")\n        assert "id" not in {column["name"] for column in columns}
    finally:
        engine.dispose()
