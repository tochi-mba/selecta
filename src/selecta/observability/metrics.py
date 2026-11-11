"""Selecta's own metric series, the ones the SLOs and alerts read (ADR-0410, SC-0410-02).

`infra/observability/slos.yaml` and `alerts.yaml` read span metrics (`traces_spanmetrics_*`, made
from the traces) and the `selecta_*` series listed in `SERIES`. Each series is emitted from the
code path it describes:

| Series | Kind | Where |
|---|---|---|
| `selecta_invariant_violations_total{invariant}` | counter | `maintain` task `lost_jobs` |
| `selecta_webhook_to_entitlement_seconds` | histogram | `billing.webhooks.process_event` |
| `selecta_oldest_queued_seconds{lane}` | gauge | `maintain` task `queue_metrics` |
| `selecta_jobs_quarantined_total` | counter | `work.lifecycle` (a job quarantined) |
| `selecta_spend_ceiling_hits_total{ceiling}` | counter | `ai.gateway.plan_turn`, autoscaling |
| `selecta_audit_writes_total` | counter | `authz.audit.record` |
| `selecta_reconciliation_drift{check}` | gauge | usage and Stripe reconciliation |
| `selecta_backup_last_success_timestamp_seconds` | gauge | `maintain` task `backup_freshness` |
| `selecta_maintenance_leader_renewed_timestamp_seconds` | gauge | `work.maintenance.Leadership` |

Instruments go through the OpenTelemetry metrics API, a no-op until `configure_from_environment`
sets an OTLP exporter (the `observability` extra and `OTEL_EXPORTER_OTLP_ENDPOINT`) under the
`cloud.metrics` flag. Instrument names are the Prometheus names, minus `_total` for counters,
which the OTLP-to-Prometheus translation adds back. Labels never carry ids (no job, workspace or
user ids). `tests/test_cloud_metrics.py` checks every series the rules read is listed here and
emitted from code.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Mapping
from dataclasses import dataclass

from opentelemetry import metrics as otel

from selecta import flags

FLAG = "cloud.metrics"
METER = "selecta"
LATENCY_BUCKETS_S = (1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1_800.0, 3_600.0)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Series:
    name: str
    kind: str
    """counter, histogram or gauge."""
    description: str
    labels: tuple[str, ...] = ()
    unit: str = ""

    @property
    def instrument(self) -> str:
        return self.name.removesuffix("_total") if self.kind == "counter" else self.name


SERIES: Mapping[str, Series] = {
    series.name: series
    for series in (
        Series("selecta_invariant_violations_total", "counter",
               "Invariant violations the maintenance leader found, by invariant.", ("invariant",)),
        Series("selecta_webhook_to_entitlement_seconds", "histogram",
               "From a Stripe webhook arriving to the entitlement it changed.", unit="s"),
        Series("selecta_oldest_queued_seconds", "gauge",
               "Age of the oldest queued job, by lane.", ("lane",), unit="s"),
        Series("selecta_jobs_quarantined_total", "counter", "Jobs quarantined as poison."),
        Series("selecta_spend_ceiling_hits_total", "counter",
               "Work an AI or compute spend ceiling refused, by ceiling.", ("ceiling",)),
        Series("selecta_audit_writes_total", "counter", "Audit rows written."),
        Series("selecta_reconciliation_drift", "gauge",
               "Differences the last reconciliation found, by check.", ("check",)),
        Series("selecta_backup_last_success_timestamp_seconds", "gauge",
               "When the newest nightly database dump finished.", unit="s"),
        Series("selecta_maintenance_leader_renewed_timestamp_seconds", "gauge",
               "When the maintenance leader last renewed its term.", unit="s"),
    )
}

_provider: otel.MeterProvider | None = None
_instruments: dict[str, object] = {}
_lock = threading.Lock()


def use_provider(provider: otel.MeterProvider | None) -> None:
    """Send this process's metrics to `provider` (tests pass an in-memory one); None goes back to
    the global provider."""
    global _provider
    with _lock:
        _provider = provider
        _instruments.clear()


def enabled() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def _instrument(name: str, labels: Mapping[str, str], kind: str):
    series = SERIES.get(name)
    if series is None:
        raise KeyError(f"{name} isn't a Selecta series; add it to metrics.SERIES first.")
    if series.kind != kind:
        raise TypeError(f"{name} is a {series.kind}, not a {kind}.")
    if set(labels) != set(series.labels):
        raise ValueError(f"{name} takes the labels {series.labels}, not {tuple(labels)}.")
    with _lock:
        made = _instruments.get(name)
        if made is None:
            meter = (_provider or otel.get_meter_provider()).get_meter(METER)
            if kind == "counter":
                made = meter.create_counter(series.instrument, series.unit, series.description)
            elif kind == "histogram":
                made = meter.create_histogram(
                    series.instrument, series.unit, series.description,
                    explicit_bucket_boundaries_advisory=list(LATENCY_BUCKETS_S),
                )
            else:
                made = meter.create_gauge(series.instrument, series.unit, series.description)
            _instruments[name] = made
    return made


def _emit(name: str, kind: str, value: float, labels: Mapping[str, str]) -> None:
    if not enabled():
        return
    instrument = _instrument(name, labels, kind)  # a wrong name or label is a bug: raise
    try:
        method = {"counter": "add", "histogram": "record", "gauge": "set"}[kind]
        getattr(instrument, method)(value, attributes=dict(labels) or None)
    except Exception:  # noqa: BLE001 - a metric must never fail the work it describes
        log.debug("Couldn't record %s", name, exc_info=True)


def add(name: str, amount: float = 1, **labels: str) -> None:
    """Count `amount` more on a counter series."""
    _emit(name, "counter", amount, labels)


def observe(name: str, value: float, **labels: str) -> None:
    """Record one value on a histogram series."""
    _emit(name, "histogram", value, labels)


def set_gauge(name: str, value: float, **labels: str) -> None:
    """Set a gauge series to `value`."""
    _emit(name, "gauge", value, labels)


def configure_from_environment(service: str) -> bool:
    """Export metrics over OTLP when the deployment asks for it and the extra is installed.
    Returns whether an exporter was set up. Never fails a service start."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint or not enabled():
        return False
    try:
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
    except ImportError:
        log.warning("Metrics asked for but the 'observability' extra isn't installed.")
        return False
    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=15_000)
    provider = MeterProvider(
        metric_readers=[reader],
        resource=Resource.create({"service.name": f"selecta-{service}"}),
    )
    otel.set_meter_provider(provider)
    use_provider(None)
    return True


__all__ = [
    "FLAG", "LATENCY_BUCKETS_S", "SERIES", "Series", "add", "configure_from_environment",
    "enabled", "observe", "set_gauge", "use_provider",
]
