"""Exports expire per plan, released from the quota (ADR-0397, SC-0397-05).

R2 lifecycle can only expire exports at the longest plan's 90 days, so the maintenance leader
sweeps: Free keeps an export 7 days, Standard 30 and Premium 90. Runs on SQLite and PostgreSQL.
"""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa

from selecta import maintain
from selecta.billing.schema import entitlement_snapshots
from selecta.persistence import new_id, transaction
from selecta.storage import export_expiry
from selecta.storage.deletion import physical_targets
from selecta.storage.keys import Bucket, export_key
from selecta.storage.schema import deletions
from selecta.usage import quota
from selecta.work.provenance import build
from selecta.work.schema import artifacts, revision_artifacts

NOW = 1_800_000_000.0
DAY = export_expiry.DAY_S
MB = 1_000_000


def _plan(conn, workspace: str, plan_id: str | None) -> None:
    if plan_id is None:
        return
    conn.execute(
        entitlement_snapshots.insert().values(
            id=new_id(),
            workspace_id=workspace,
            version=1,
            plan_id=plan_id,
            plan_version=None,
            source="stripe",
            reason="active",
            computed_at=NOW,
            verified_at=NOW,
        )
    )


def _export(
    conn, workspace: str, age_days: float, size: int = 5 * MB, *, charged: bool = True
) -> str:
    artifact_id = new_id()
    input_hash = hashlib.sha256(artifact_id.encode()).hexdigest()
    conn.execute(
        artifacts.insert().values(
            id=artifact_id,
            workspace_id=workspace,
            kind="export",
            input_hash=input_hash,
            keys=[f"w/{workspace}/export/{input_hash}/attempts/{artifact_id}/mix.flac"],
            checksum="c" * 64,
            size_bytes=size,
            provenance=build({"songs": ["a" * 64]}, {"export": 1}),
            created_at=NOW - age_days * DAY,
            last_used_at=NOW,
        )
    )
    if charged:  # as publishing an export does: kept exports count against storage
        export_expiry.charge_export(conn, workspace, artifact_id, size)
    return artifact_id


@pytest.fixture
def world(cloud_engine):
    made = {}
    with transaction(cloud_engine) as conn:
        for workspace, plan_id in (
            ("ws-free", None),
            ("ws-std", "standard"),
            ("ws-prem", "premium"),
        ):
            _plan(conn, workspace, plan_id)
            made[workspace] = {age: _export(conn, workspace, age) for age in (6, 8, 29, 31, 89, 91)}
    with transaction(cloud_engine) as conn:
        for workspace in made:  # usage the exports account for, so a release is visible
            quota._locked(conn, workspace)
            conn.execute(
                sa.update(quota.quota_state)
                .where(quota.quota_state.c.workspace_id == workspace)
                .values(committed_bytes=100 * MB)
            )
    return cloud_engine, made


def _left(engine, workspace: str) -> set[str]:
    with transaction(engine) as conn:
        return set(
            conn.execute(
                sa.select(artifacts.c.id).where(artifacts.c.workspace_id == workspace)
            ).scalars()
        )


def test_each_plan_keeps_exports_for_its_own_retention(world):
    engine, made = world
    deleted = []
    expired = export_expiry.expire_exports(engine, deleted.append, now=NOW)
    kept = {
        "ws-free": {6},
        "ws-std": {6, 8, 29},
        "ws-prem": {6, 8, 29, 31, 89},
    }
    for workspace, ages in made.items():
        assert _left(engine, workspace) == {ages[age] for age in kept[workspace]}
    assert {(e.workspace_id, e.retention_days) for e in expired} == {
        ("ws-free", 7),
        ("ws-std", 30),
        ("ws-prem", 90),
    }
    assert len(expired) == 5 + 3 + 1 == len(deleted)
    assert all(key.endswith("/mix.flac") for key in deleted)


def test_expiry_gives_the_bytes_back_and_leaves_a_tombstone(world):
    engine, made = world
    export_expiry.expire_exports(engine, now=NOW)
    with transaction(engine) as conn:
        assert quota.usage(conn, "ws-free").committed_bytes == 100 * MB - 5 * 5 * MB
        assert quota.usage(conn, "ws-prem").committed_bytes == 100 * MB - 5 * MB
        rows = (
            conn.execute(sa.select(deletions).where(deletions.c.workspace_id == "ws-prem"))
            .mappings()
            .all()
        )
    [row] = rows
    assert row["kind"] == "export" and row["ref"] == made["ws-prem"][91]
    assert row["bytes_released"] == 5 * MB
    from selecta.storage.deletion import Deletion

    targets = physical_targets(Deletion.from_row(row))
    assert targets.keys == {Bucket.EXPORTS: [export_key("ws-prem", made["ws-prem"][91])]}


def test_a_second_sweep_finds_nothing_and_releases_nothing_twice(world):
    engine, _ = world
    assert export_expiry.expire_exports(engine, now=NOW)
    assert export_expiry.expire_exports(engine, now=NOW) == []
    with transaction(engine) as conn:
        assert quota.usage(conn, "ws-std").committed_bytes == 100 * MB - 3 * 5 * MB


def test_revision_links_to_an_expired_export_go_with_it(world):
    engine, made = world
    old = made["ws-free"][8]
    with transaction(engine) as conn:
        conn.execute(
            revision_artifacts.insert().values(
                workspace_id="ws-free",
                revision_id="rev-1",
                artifact_id=old,
                frozen=True,
                created_at=NOW,
            )
        )
    export_expiry.expire_exports(engine, now=NOW)
    with transaction(engine) as conn:
        assert conn.execute(sa.select(revision_artifacts)).first() is None


def test_an_unknown_plan_keeps_its_exports(cloud_engine):
    with transaction(cloud_engine) as conn:
        _plan(conn, "ws-odd", "enterprise")
        kept = _export(conn, "ws-odd", 400)
    assert export_expiry.expire_exports(cloud_engine, now=NOW) == []
    assert _left(cloud_engine, "ws-odd") == {kept}


def test_the_maintenance_leader_runs_the_sweep_behind_its_flag(world, monkeypatch):
    engine, made = world
    plan = maintain.cloud_plan(engine, env={})
    [task] = [task for task in plan.tasks if task.name == "export_expiry"]
    assert task.every_s == 3_600.0
    monkeypatch.setattr(maintain, "_flag_on", lambda flag: False)
    assert task.run(None) == 0
    assert _left(engine, "ws-free") == set(made["ws-free"].values())
    monkeypatch.setattr(maintain, "_flag_on", lambda flag: flag == export_expiry.FLAG)
    monkeypatch.setattr(export_expiry.persistence, "db_now", lambda conn: NOW)
    assert task.run(None) == 9


def test_publishing_an_export_charges_its_bytes_to_storage(cloud_engine):
    """docs/adr/adr-0402 (Decision): storage counts originals and kept exports. The job store's
    artifact write is where an export becomes kept, so that is where it is charged, once."""
    from selecta.usage.schema import usage_ledger
    from selecta.work import artifacts as manifest
    from selecta.work.ports import ArtifactOutput

    input_hash = "e" * 64
    output = ArtifactOutput(
        "export",
        input_hash,
        [f"w/ws-pay/export/{input_hash}/attempts/at-1/mix.flac"],
        "c" * 64,
        7 * MB,
        build({"songs": ["a" * 64]}, {"export": 1}),
        False,
    )
    with transaction(cloud_engine) as conn:
        manifest.write(conn, "ws-pay", "job-1", "at-1", [output], NOW)
        manifest.write(conn, "ws-pay", "job-1", "at-1", [output], NOW)  # a repeat charges nothing
        assert quota.usage(conn, "ws-pay").committed_bytes == 7 * MB
        [export_id] = conn.execute(sa.select(artifacts.c.id)).scalars().all()
        assert export_expiry.charged(conn, "ws-pay", export_id) == 7 * MB
        assert conn.execute(sa.select(sa.func.sum(usage_ledger.c.amount))).scalar() == 7 * MB


def test_expiry_never_takes_committed_bytes_below_what_is_really_stored(cloud_engine):
    """An export that was never charged (made before exports counted) releases nothing, so the
    songs' own bytes stay committed."""
    with transaction(cloud_engine) as conn:
        _export(conn, "ws-old", 400, charged=False)
        held = quota._locked(conn, "ws-old")
        quota._store(conn, held, committed=40 * MB)  # the songs it really stores
        charged = _export(conn, "ws-old", 400, size=3 * MB)
    expired = export_expiry.expire_exports(cloud_engine, now=NOW)
    assert {e.bytes_released for e in expired} == {0, 3 * MB}
    with transaction(cloud_engine) as conn:
        assert quota.usage(conn, "ws-old").committed_bytes == 40 * MB
        assert export_expiry.charged(conn, "ws-old", charged) == 3 * MB
