"""Every series the SLOs and alerts read is emitted from the code it describes (SC-0410-02).

The static test reads `infra/observability/slos.yaml`, `alerts.yaml` and the generated rules,
and checks each `selecta_*` series they use is declared in `observability.metrics.SERIES` and
emitted somewhere in `src/` by name. The rest drive the real code paths with an in-memory
OpenTelemetry reader and check what they emitted. Runs on SQLite and PostgreSQL.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription
from test_cloud_jobs_support import make_store, worker

from selecta import maintain
from selecta.authz import audit
from selecta.billing.schema import stripe_events
from selecta.billing.webhooks import process_event, store_event
from selecta.observability import leader_metrics, metrics
from selecta.persistence import transaction
from selecta.work.enqueue import JobSpec
from selecta.work.maintenance import Leadership
from selecta.work.model import ErrorClass, JobState
from selecta.work.schema import jobs

ROOT = Path(__file__).resolve().parents[1]
RULES = [ROOT / "infra" / "observability" / name for name in ("slos.yaml", "alerts.yaml")]
NAME = re.compile(r"\b(selecta_[a-z0-9_]+)\b(?!\s*(?:=|!=|=~|!~))")
SUFFIXES = ("_bucket", "_count", "_sum")


def _referenced() -> set[str]:
    files = RULES + sorted((ROOT / "infra" / "observability" / "generated").rglob("*"))
    found: set[str] = set()
    for path in files:
        if path.is_file():
            for name in NAME.findall(path.read_text("utf-8")):
                for suffix in SUFFIXES:
                    if name.endswith(suffix) and name.removesuffix(suffix) in metrics.SERIES:
                        name = name.removesuffix(suffix)
                found.add(name)
    return found


def test_every_series_the_rules_read_is_declared_and_emitted_from_code():
    referenced = _referenced()
    assert referenced, "the rules should read some selecta_* series"
    assert referenced <= set(metrics.SERIES), sorted(referenced - set(metrics.SERIES))
    source = "\n".join(
        path.read_text("utf-8") for path in (ROOT / "src" / "selecta").rglob("*.py")
        if path.name != "metrics.py"
    )
    for name, series in metrics.SERIES.items():
        call = {"counter": "add", "histogram": "observe", "gauge": "set_gauge"}[series.kind]
        assert re.search(rf'metrics\.{call}\(\s*"{name}"', source), f"nothing emits {name}"


@pytest.fixture
def reader(monkeypatch):
    found = InMemoryMetricReader()
    metrics.use_provider(MeterProvider(metric_readers=[found]))
    monkeypatch.setattr(metrics, "enabled", lambda: True)
    yield found
    metrics.use_provider(None)


def points(reader, name: str) -> list:
    data = reader.get_metrics_data()
    instrument = metrics.SERIES[name].instrument
    return [
        point
        for resource in (data.resource_metrics if data else [])
        for scope in resource.scope_metrics
        for metric in scope.metrics if metric.name == instrument
        for point in metric.data.data_points
    ]


def test_wrong_names_or_labels_are_refused(reader):
    with pytest.raises(KeyError):
        metrics.add("selecta_made_up_total")
    with pytest.raises(ValueError):
        metrics.set_gauge("selecta_oldest_queued_seconds", 1.0)
    with pytest.raises(TypeError):
        metrics.observe("selecta_audit_writes_total", 1.0)


def test_nothing_is_recorded_while_the_flag_is_off(reader, monkeypatch):
    monkeypatch.setattr(metrics, "enabled", lambda: False)
    metrics.add("selecta_audit_writes_total")
    assert points(reader, "selecta_audit_writes_total") == []


def test_a_quarantined_job_counts(cloud_engine, reader):
    store = make_store(cloud_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    job = store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.POISON, "boom", 1.0)
    assert job.state == JobState.QUARANTINED
    [point] = points(reader, "selecta_jobs_quarantined_total")
    assert point.value == 1


def test_audit_writes_count(cloud_engine, reader):
    with transaction(cloud_engine) as conn:
        for _ in range(2):
            audit.record(conn, action="test.metric", result=audit.AuditResult.SUCCESS)
    [point] = points(reader, "selecta_audit_writes_total")
    assert point.value == 2


def test_a_processed_webhook_records_its_time_to_the_entitlement(cloud_engine, reader):
    stripe = FakeStripe()
    stripe.put(subscription(status="active"))
    evt = event("evt_m", "customer.subscription.updated", subscription(status="active"))
    with transaction(cloud_engine) as conn:
        store_event(conn, evt)
        received = conn.execute(sa.select(stripe_events.c.received_at)).scalar_one()
    with transaction(cloud_engine) as conn:
        result = process_event(conn, "evt_m", stripe, PRICE_MAP, received + 42.0)
    assert result.status == "processed"
    [point] = points(reader, "selecta_webhook_to_entitlement_seconds")
    assert point.count == 1 and point.sum == pytest.approx(42.0)
    assert 60.0 in point.explicit_bounds


def test_the_leader_marks_each_renewal(cloud_engine, reader):
    lock = cloud_engine.connect() if cloud_engine.dialect.name == "postgresql" else None
    try:
        leader = Leadership(cloud_engine, lock_connection=lock)
        assert leader.acquire() is not None
        assert leader.acquire() is not None  # renews
        [point] = points(reader, "selecta_maintenance_leader_renewed_timestamp_seconds")
        assert point.value > 1_700_000_000
        leader.release()
    finally:
        if lock is not None:
            lock.close()


def test_queue_age_is_reported_per_lane_and_empty_lanes_read_zero(cloud_engine, reader):
    make_store(cloud_engine).enqueue(JobSpec("w1", "analyse.song"))
    with transaction(cloud_engine) as conn:
        conn.execute(sa.update(jobs).values(queued_at=jobs.c.queued_at - 300,
                                            created_at=jobs.c.created_at - 300))
    ages = leader_metrics.oldest_queued(cloud_engine)
    assert ages["standard"] >= 299 and ages["interactive"] == 0
    found = {p.attributes["lane"]: p.value for p in
             points(reader, "selecta_oldest_queued_seconds")}
    assert set(found) == {"interactive", "standard", "speculative"}


def test_lost_jobs_count_once_each(cloud_engine, reader):
    store = make_store(cloud_engine)
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    store.claim("cpu-heavy", worker())
    check = leader_metrics.LostJobs(cloud_engine)
    assert check() == 0
    with transaction(cloud_engine) as conn:  # a retry with no time to run can never move
        conn.execute(sa.update(jobs).where(jobs.c.id == job.id)
                     .values(state="retry_scheduled", not_before=None))
    try:
        assert check() >= 1
        assert check() == 0
        [point] = points(reader, "selecta_invariant_violations_total")
        assert point.attributes == {"invariant": "accepted_job_lost"} and point.value >= 1
    finally:
        with transaction(cloud_engine) as conn:
            conn.execute(sa.update(jobs).where(jobs.c.id == job.id).values(state="leased"))


def test_usage_reconciliation_reports_its_drift(cloud_engine, reader):
    with transaction(cloud_engine) as conn:
        assert maintain.usage_reconciliation(conn) == 0
    [point] = points(reader, "selecta_reconciliation_drift")
    assert point.attributes == {"check": "usage"} and point.value == 0


def test_the_backup_gauge_reads_when_latest_was_written(reader):
    head = SimpleNamespace(last_modified="Wed, 11 Nov 2026 03:00:00 GMT")
    stamp = leader_metrics.latest_backup(lambda bucket, key: head, "dumps")
    assert stamp == 1_794_366_000.0
    [point] = points(reader, "selecta_backup_last_success_timestamp_seconds")
    assert point.value == stamp


def test_a_compute_spend_ceiling_counts(cloud_engine, reader):
    from selecta.work import autoscale_leader
    from selecta.work.autoscale import Launch, PoolConfig

    cpu = Launch("modal", cpu=4, memory_mb=8192, cost_per_hour_usd=10.0)
    pools = {"cpu-heavy": PoolConfig("cpu-heavy", 0, 4, 1, 10.0, 600.0, 5.0, cpu)}
    make_store(cloud_engine).enqueue(JobSpec("w1", "analyse.song", est_cost_s=100.0))

    class Launcher:
        def has_capacity(self, pool, launch):
            return True

        def scale(self, pool, workers, launch, *, fallback):
            pass

    autoscale_leader.tick(cloud_engine, pools, Launcher(), autoscale_leader.SpendMeter())
    [point] = points(reader, "selecta_spend_ceiling_hits_total")
    assert point.attributes == {"ceiling": "compute"} and point.value == 1
