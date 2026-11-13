"""Cloud scheduler eligibility must not start nested SQLite write transactions."""

from __future__ import annotations

from types import SimpleNamespace

import sqlalchemy as sa

from selecta.persistence import make_engine, transaction
from selecta.scheduling.policy import WorkerCaps
from selecta.work import cloud_ports
from selecta.work.claims import ClaimSession
from selecta.work.ports import AccountStanding


def _sqlite_with_account(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'claim.sqlite').as_posix()}")
    with transaction(engine) as conn:
        conn.exec_driver_sql(
            "CREATE TABLE users (id TEXT PRIMARY KEY, created_at REAL, deleted_at REAL)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE workspaces (id TEXT PRIMARY KEY, owner_user_id TEXT)"
        )
        conn.exec_driver_sql(
            "INSERT INTO users (id, created_at, deleted_at) VALUES ('owner', 100, NULL)"
        )
        conn.exec_driver_sql(
            "INSERT INTO workspaces (id, owner_user_id) VALUES ('workspace', 'owner')"
        )
    return engine


def test_cloud_claim_eligibility_reuses_the_active_sqlite_transaction(
    tmp_path, monkeypatch
):
    engine = _sqlite_with_account(tmp_path)
    reads = []

    def entitlement(conn, workspace_id):
        reads.append(("entitlement", conn, workspace_id))
        return SimpleNamespace(plan_id="premium", plan_version=2, snapshot_version=3)

    plan = SimpleNamespace(
        id="premium", version=2, concurrency={"standard": 4}, flags={"playback"}
    )
    monkeypatch.setattr(cloud_ports.stripe_sync, "effective_entitlement", entitlement)
    monkeypatch.setattr(cloud_ports.plans, "plan_for", lambda *_args: plan)
    monkeypatch.setattr(cloud_ports.plans, "plan_gated_flags", lambda: frozenset())
    monkeypatch.setattr(cloud_ports.flags, "effective", lambda: {})
    monkeypatch.setattr(cloud_ports, "user_preferences", lambda *_args: {})
    monkeypatch.setattr(
        cloud_ports.targeting, "decide", lambda *_args, **_kwargs: SimpleNamespace(on=True)
    )

    with transaction(engine) as connection:
        class Rules:
            def refresh_if_stale(self, *, connection=None):
                assert connection is expected

            def snapshot_for(self, connection):
                assert connection is expected
                return {}

        expected = connection
        store = SimpleNamespace(
            config=SimpleNamespace(),
            entitlements=cloud_ports.CloudJobEntitlements(engine),
            flags=cloud_ports.CloudJobFlags(engine, Rules()),
        )
        claim = ClaimSession(
            connection, store, "cpu-light", WorkerCaps(pool="cpu-light"), 200.0
        )
        standing = claim.standing("workspace")
        assert standing.tier == "premium"
        assert standing.caps == {"standard": 4, "speculative": 1}
        assert standing.entitlement_version == 3
        assert not standing.suspended
        assert claim._flag_on("workspace", "playback")
        assert claim.standing("workspace") is standing
        assert claim._flag_on("workspace", "playback")
        assert len(reads) == 2
        assert all(conn is connection and ws == "workspace" for _, conn, ws in reads)


def test_unknown_workspace_fails_closed_in_existing_sqlite_transaction(tmp_path):
    engine = _sqlite_with_account(tmp_path)

    class Rules:
        def refresh_if_stale(self, *, connection=None):
            assert connection is not None

        def snapshot_for(self, connection):
            raise AssertionError("Unknown workspace must not need rule resolution")

    with transaction(engine) as connection:
        store = SimpleNamespace(
            config=SimpleNamespace(),
            entitlements=cloud_ports.CloudJobEntitlements(engine),
            flags=cloud_ports.CloudJobFlags(engine, Rules()),
        )
        claim = ClaimSession(
            connection, store, "cpu-light", WorkerCaps(pool="cpu-light"), 200.0
        )
        assert claim.standing("missing").suspended
        assert not claim._flag_on("missing", "playback")


def test_claim_session_still_supports_existing_adapter_protocol():
    store = SimpleNamespace(
        config=SimpleNamespace(),
        entitlements=SimpleNamespace(standing=lambda _ws: AccountStanding(tier="free")),
        flags=SimpleNamespace(is_on=lambda _ws, _flag: False),
    )
    claim = ClaimSession(
        SimpleNamespace(), store, "cpu-light", WorkerCaps(pool="cpu-light"), 200.0
    )
    assert claim.standing("workspace").tier == "free"
    assert not claim._flag_on("workspace", "playback")
    assert claim._flag_on("workspace", None)
