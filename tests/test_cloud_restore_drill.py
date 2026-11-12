"""The restore drill's post-restore steps, timed, in order (SC-0409-04, ADR-0409 §13.5).

A database "restored" from before some deletions comes back hiding the deleted songs again
from the off-site deletions ledger, with storage reconciled and expired leases reclaimed, and
the report judges the whole recovery against the 60-minute target.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import replace
from pathlib import Path

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import make_store, worker
from test_cloud_storage_fakes import FakeS3
from test_cloud_storage_offsite import BUCKET, OTHER, WS, _commit_bytes, add_asset

from selecta.ops import restore_drill
from selecta.persistence import transaction
from selecta.storage.deletion import tombstone
from selecta.storage.offsite_ledger import drain_deletion_mirror
from selecta.storage.schema import assets, deletions
from selecta.work.enqueue import JobSpec

ROOT = Path(__file__).resolve().parents[1]
STEPS = [
    "Replay storage tombstones",
    "Replay account deletions",
    "Storage reconciliation",
    "Stripe reconciliation",
    "Expire leases",
]


class Clock:
    def __init__(self, start: float = 1_000.0, tick: float = 5.0) -> None:
        self.now, self.tick = start, tick

    def __call__(self) -> float:
        self.now += self.tick
        return self.now


@pytest.fixture
def restored(cloud_engine):
    """A library whose deletions were mirrored off-site, then a restore from before them."""
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-1", 100)
        add_asset(conn, WS, "song-2", 200)
        add_asset(conn, OTHER, "song-9", 900)
    _commit_bytes(cloud_engine, WS, 300, "s1")
    _commit_bytes(cloud_engine, OTHER, 900, "s9")
    with transaction(cloud_engine, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
    fake = FakeS3()
    assert drain_deletion_mirror(cloud_engine, fake, BUCKET).delivered == 1
    with transaction(cloud_engine) as conn:
        conn.execute(sa.delete(deletions))
        conn.execute(sa.update(assets).values(deleted_at=None, physical_delete_after=None))
    return cloud_engine, fake


def hidden(engine) -> dict[str, bool]:
    with transaction(engine) as conn:
        rows = conn.execute(sa.select(assets.c.id, assets.c.deleted_at)).all()
    return {asset_id: deleted is not None for asset_id, deleted in rows}


def test_the_drill_replays_the_ledger_reconciles_and_reports_every_step_in_order(restored):
    engine, fake = restored
    assert hidden(engine)["song-1"] is False  # the restore brought the deleted song back
    clock = Clock()
    report = restore_drill.after_restore(engine, fake, BUCKET, restore_started=900.0, clock=clock)
    assert [step.name for step in report.steps] == STEPS
    assert all(step.ok for step in report.steps), report.steps
    assert hidden(engine) == {"song-1": True, "song-2": False, "song-9": False}
    assert report.steps[0].detail.startswith("1 tombstones")
    assert report.steps[2].detail == "ledger, quota and inventory agree"
    assert all(step.seconds == 5.0 for step in report.steps)
    assert report.total_s == clock.now - 900.0
    assert report.passed
    text = report.markdown()
    assert text.startswith("# Restore drill: PASSED") and "under 60 min" in text
    assert report.as_dict()["passed"] is True


def test_the_drill_reclaims_leases_that_expired_while_the_database_was_down(restored):
    engine, fake = restored
    store = make_store(engine)
    store.config = replace(store.config, heartbeat_s=0.01, lease_s=0.02)
    store.enqueue(JobSpec(WS, "analyse.song"))
    assert store.claim("cpu-heavy", worker()) is not None
    time.sleep(0.2)
    report = restore_drill.after_restore(
        engine, fake, BUCKET, restore_started=0.0, store=store, clock=Clock()
    )
    assert report.steps[-1].detail == "1 expired leases reclaimed"


def test_a_failed_step_stops_the_drill_and_keeps_traffic_closed(restored, monkeypatch):
    engine, fake = restored
    fake.fail_next("list_objects_v2", RuntimeError("R2 down"), times=50)
    report = restore_drill.after_restore(engine, fake, BUCKET, restore_started=0.0, clock=Clock())
    assert [step.ok for step in report.steps] == [False]
    assert not report.completed and not report.passed
    assert "Keep customer traffic closed" in report.markdown()


def test_a_recovery_slower_than_an_hour_fails_the_drill(restored):
    engine, fake = restored
    report = restore_drill.after_restore(
        engine, fake, BUCKET, restore_started=0.0, clock=Clock(start=3_600.0)
    )
    assert report.completed and not report.passed
    assert report.markdown().startswith("# Restore drill: FAILED")


def _bash() -> str | None:
    """A working bash: Git's on Windows (System32's bash is WSL, often with no distro)."""
    git = shutil.which("git")
    if git:
        for candidate in (
            Path(git).parents[1] / "bin" / "bash.exe",
            Path(git).parents[1] / "usr" / "bin" / "bash.exe",
        ):
            if candidate.is_file():
                return str(candidate)
    found = shutil.which("bash")
    return found if found and "system32" not in found.lower() else None


@pytest.mark.skipif(_bash() is None, reason="needs bash")
@pytest.mark.parametrize("script", sorted((ROOT / "infra").rglob("*.sh")), ids=lambda p: p.name)
def test_every_infra_shell_script_parses_and_stops_on_errors(script):
    subprocess.run([_bash(), "-n", str(script)], check=True)
    assert "set -euo pipefail" in script.read_text("utf-8")


def test_the_drill_script_restores_first_then_runs_the_steps_timed_from_the_start():
    text = (ROOT / "infra" / "backup" / "restore_drill.sh").read_text("utf-8")
    text = text.split("set -euo pipefail", 1)[1]  # the steps, not the header comment
    order = [
        text.index(part)
        for part in (
            'started="$(date -u +%s)"',
            "sha256sum --check",
            "pg_restore",
            "selecta db upgrade",
            'python -m selecta.ops.restore_drill --restore-started "${started}"',
        )
    ]
    assert order == sorted(order)
    copy = (ROOT / "infra" / "backup" / "copy_originals.sh").read_text("utf-8")
    assert "rclone copy" in copy and "rclone sync" not in copy


def test_the_drill_command_runs_stripe_reconciliation_when_stripe_is_configured(
    monkeypatch, tmp_path
):
    """With the Stripe settings in the environment, `main` hands after_restore a Stripe client
    and the price map, so the drill re-runs billing reconciliation instead of skipping it."""
    from selecta import flags, persistence
    from selecta.storage import api as storage_api

    class Closeable:
        def close(self) -> None: ...

        def dispose(self) -> None: ...

    seen: dict = {}

    def fake_after_restore(engine, objects, bucket, **kwargs):
        seen.update(kwargs)
        report = restore_drill.DrillReport(restore_started=kwargs["restore_started"])
        report.finished = kwargs["restore_started"]
        return report

    monkeypatch.setattr(flags, "require", lambda _flag: None)
    monkeypatch.setattr(persistence, "make_engine", lambda _url: Closeable())
    monkeypatch.setattr(storage_api, "r2_client", Closeable)
    monkeypatch.setattr(restore_drill, "after_restore", fake_after_restore)
    monkeypatch.setenv("SELECTA_DATABASE_URL", "postgresql://drill")
    monkeypatch.setenv("SELECTA_R2_BUCKET_DELETION_LEDGER", "ledger")
    monkeypatch.setenv("SELECTA_STRIPE_SECRET_KEY", "sk_test_drill")
    monkeypatch.setenv(
        "SELECTA_STRIPE_PRICES", '{"price_standard_month":{"plan":"standard","interval":"month"}}'
    )
    restore_drill.main(["--restore-started", "0", "--report", str(tmp_path / "drill.md")])
    assert seen["stripe"] is not None
    assert set(seen["price_map"]) == {"price_standard_month"}
