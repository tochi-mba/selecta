"""The maintenance service (§4.3, `selecta maintain`): every recurring cloud task on its own
interval, one leader with a standby, failures contained, and a clean stop on SIGTERM.
"""

from __future__ import annotations

import signal
import threading
import time

import pytest
import sqlalchemy as sa
from typer.testing import CliRunner

from selecta import maintain
from selecta.cli import app
from selecta.maintain import Plan, Service, cloud_plan
from selecta.work.maintenance import Schedule, Task

FAST = dict(reap_s=1.0, reconcile_s=1.0, rebase_s=1.0, prune_s=1.0, actions_s=1.0)


class Counter:
    def __init__(self, fail: bool = False) -> None:
        self.calls = 0
        self.fail = fail

    def __call__(self, _fence) -> int:
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return self.calls


def service(engine, lock=None, *tasks: Task, holder: str | None = None) -> Service:
    return Service(
        engine, lock, Plan(list(tasks)), schedule=Schedule(**FAST), tick_s=0.05, holder=holder
    )


def test_each_task_runs_on_its_own_interval(sqlite_engine):
    often, rarely = Counter(), Counter()
    copy = service(sqlite_engine, None, Task("often", 10.0, often), Task("rarely", 60.0, rarely))
    for moment in (0.0, 5.0, 10.0, 20.0, 59.0, 60.0):
        copy.loop.run_once(moment=moment)
    assert (often.calls, rarely.calls) == (4, 2)
    done = copy.loop.run_once(moment=120.0)
    assert {"reaped", "retried", "reconciled", "rebased", "pruned", "often", "rarely"} <= set(done)


def test_every_core_cloud_task_runs_cleanly_and_missing_secrets_are_named(sqlite_engine):
    plan = cloud_plan(sqlite_engine, env={})
    names = {task.name for task in plan.tasks}
    assert names == {
        "business.zone_clock",
        "actions",
        "reservations",
        "lucy_runs",
        "flag_previews",
        "admin_metrics",
        "usage_reconcile",
        "export_expiry",
        "queue_metrics",
        "lost_jobs",
    }
    assert set(plan.disabled) == {
        "stripe_events",
        "stripe_reconcile",
        "storage_deletions",
        "account_deletions",
        "rooms",
        "derived_eviction",
        "autoscale",
        "backup_freshness",
        "dmca_renewal",
        "emails",
    }
    assert "SELECTA_EMAIL_PROVIDER" in plan.disabled["emails"]
    assert "SELECTA_DMCA_AGENT_REGISTERED_ON" in plan.disabled["dmca_renewal"]
    assert "SELECTA_MODAL_APP" in plan.disabled["autoscale"]
    assert "SELECTA_STRIPE_SECRET_KEY" in plan.disabled["stripe_events"]
    copy = Service(sqlite_engine, None, plan, schedule=Schedule(**FAST))
    done = copy.loop.run_once(moment=0.0)
    assert "failed" not in done, done.get("failed")
    assert names <= set(done)


def test_secrets_switch_the_external_tasks_on(sqlite_engine, monkeypatch):
    monkeypatch.setattr("selecta.billing.stripe_sync.load_price_map", lambda: {"price": "x"})
    env = {
        "SELECTA_STRIPE_SECRET_KEY": "sk_test_x",
        "SELECTA_WORKOS_API_KEY": "workos_x",
        "SELECTA_R2_BUCKET_DELETION_LEDGER": "ledger",
        "SELECTA_ROOMS_PEPPER": "p" * 32,
        "SELECTA_R2_ACCOUNT_ID": "acct",
        "SELECTA_R2_ACCESS_KEY_ID": "key",
        "SELECTA_R2_SECRET_ACCESS_KEY": "secret",
        "SELECTA_MODAL_APP": "selecta-workers",
        "SELECTA_MODAL_TOKEN_ID": "ak-x",
        "SELECTA_MODAL_TOKEN_SECRET": "as-x",
        "SELECTA_BACKUP_S3_ENDPOINT": "https://backup.test",
        "SELECTA_BACKUP_BUCKET": "dumps",
        "SELECTA_BACKUP_ACCESS_KEY_ID": "rk",
        "SELECTA_BACKUP_SECRET_ACCESS_KEY": "rs",
        "SELECTA_DMCA_AGENT_REGISTERED_ON": "2026-11-12",
        "SELECTA_EMAIL_PROVIDER": "resend",
        "SELECTA_EMAIL_API_KEY": "re_test_x",
        "SELECTA_EMAIL_FROM": "hello@example.com",
    }
    plan = cloud_plan(sqlite_engine, env=env)
    assert plan.disabled == {}
    assert {
        "stripe_events",
        "stripe_reconcile",
        "storage_deletions",
        "account_deletions",
        "rooms",
        "derived_eviction",
        "export_expiry",
        "autoscale",
        "dmca_renewal",
    } <= {task.name for task in plan.tasks}


def test_a_task_that_raises_does_not_stop_the_others(sqlite_engine, caplog):
    broken, after = Counter(fail=True), Counter()
    copy = service(sqlite_engine, None, Task("broken", 1.0, broken), Task("after", 1.0, after))
    done = copy.loop.run_once(moment=0.0)
    assert done["failed"] == {"broken": "RuntimeError"}
    assert after.calls == 1 and "reaped" in done
    assert "Maintenance task broken failed" in caplog.text
    copy.loop.run_once(moment=1.0)
    assert (broken.calls, after.calls) == (2, 2), "it keeps trying on the next interval"


def test_two_copies_on_postgres_run_tasks_once_and_the_standby_takes_over(postgres_engine):
    first_lock, second_lock = postgres_engine.connect(), postgres_engine.connect()
    a_runs, b_runs = Counter(), Counter()
    try:
        a = service(postgres_engine, first_lock, Task("work", 1.0, a_runs), holder="a")
        b = service(postgres_engine, second_lock, Task("work", 1.0, b_runs), holder="b")
        for moment in (0.0, 1.0, 2.0):
            assert a.loop.run_once(moment=moment)
            assert b.loop.run_once(moment=moment) == {}, "the standby runs nothing"
        assert (a_runs.calls, b_runs.calls) == (3, 0)

        pid = first_lock.execute(sa.text("SELECT pg_backend_pid()")).scalar()
        first_lock.commit()
        with postgres_engine.connect() as admin:
            admin.execute(sa.text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
            admin.commit()
        assert "work" in b.loop.run_once(moment=3.0), "the standby took over on its next tick"
        assert a.loop.run_once(moment=3.0) == {}, "the old leader has stopped"
        assert a.loop.run_once(moment=4.0) == {}, "and stands by on a fresh connection"
        assert b_runs.calls == 1
        b.loop.leadership.release()
        assert "work" in a.loop.run_once(moment=5.0), "so it can lead again later"
    finally:
        for lock in (first_lock, second_lock):
            try:
                lock.close()
            except Exception:  # noqa: BLE001 - the first one was killed on purpose
                pass


def test_sigterm_stops_the_service_within_a_tick_and_releases_leadership(sqlite_engine):
    runs = Counter()
    copy = service(sqlite_engine, None, Task("work", 0.0, runs))
    before = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    copy.install_signal_handlers()
    try:
        worker = threading.Thread(target=copy.run)
        worker.start()
        deadline = time.monotonic() + 5
        while runs.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert runs.calls > 0
        signal.raise_signal(signal.SIGTERM)
        stopped_at = time.monotonic()
        while worker.is_alive() and time.monotonic() - stopped_at < 2:
            worker.join(0.01)
        assert not worker.is_alive()
        assert time.monotonic() - stopped_at < 2 * copy.loop.tick_s + 0.5
        assert copy.loop.leadership.term is None
    finally:
        for sig, handler in before.items():
            signal.signal(sig, handler)


def test_a_failing_tick_is_logged_and_the_service_keeps_going(sqlite_engine, monkeypatch, caplog):
    copy = service(sqlite_engine)
    calls = []

    def flaky(moment=None):
        calls.append(1)
        if len(calls) == 1:
            raise sa.exc.OperationalError("SELECT 1", {}, Exception("database blip"))
        return {}

    monkeypatch.setattr(copy.loop, "run_once", flaky)
    copy.run(ticks=3)
    assert len(calls) == 3 and "A maintenance tick failed" in caplog.text


def test_the_command_needs_the_cloud_database(monkeypatch):
    monkeypatch.delenv("SELECTA_DATABASE_URL", raising=False)
    monkeypatch.delenv("SELECTA_MAINTENANCE_DATABASE_URL", raising=False)
    result = CliRunner().invoke(app, ["maintain"])
    assert result.exit_code == 2 and "SELECTA_DATABASE_URL" in result.output


def test_a_direct_maintenance_url_wins_over_the_pooled_one():
    env = {
        "SELECTA_DATABASE_URL": "postgresql://pooled/db",
        "SELECTA_MAINTENANCE_DATABASE_URL": "postgresql://direct/db",
    }
    assert maintain.database_url(env) == "postgresql://direct/db"
    with pytest.raises(ValueError):
        maintain.database_url({"SELECTA_DATABASE_URL": "sqlite:///x"})


def test_usage_drift_becomes_one_alert_and_nothing_is_fixed(sqlite_engine):
    from selecta.admin.schema import platform_alerts
    from selecta.persistence import db_now, new_id, transaction
    from selecta.usage.schema import quota_state

    with transaction(sqlite_engine) as conn:
        conn.execute(
            quota_state.insert().values(
                workspace_id=new_id(),
                plan_id="free",
                plan_version=1,
                limit_bytes=10**10,
                committed_bytes=999,
                reserved_bytes=0,
                state="ok",
                updated_at=db_now(conn),
            )
        )
    with transaction(sqlite_engine) as conn:
        assert maintain.usage_reconciliation(conn) >= 1
    with sqlite_engine.connect() as conn:
        kinds = conn.execute(sa.select(platform_alerts.c.kind)).scalars().all()
        committed = conn.execute(sa.select(quota_state.c.committed_bytes)).scalar_one()
    assert kinds == ["usage.reconciliation_drift"] and committed == 999
