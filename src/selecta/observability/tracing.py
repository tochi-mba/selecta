"""One OpenTelemetry trace per job, from the API through the gateway and worker to storage.

ADR-0410 asks for traces across API, gateway and workers with the job id as a span attribute
(never a metric label). A job outlives the request that made it and crosses processes that share
nothing but the database, so its trace id is derived from the job id itself: every process that
touches a job opens its spans under the same synthetic parent, and the spans meet in one trace
without a column, a header or a lookup. The HTTP request that caused a job span is kept as a
span link, and worker calls to the gateway carry the W3C `traceparent` header as usual.

The code needs only `opentelemetry-api`, which FastAPI already depends on, so with nothing
configured every span is a no-op. A process exports spans when the optional `observability`
extra is installed and `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`configure_from_environment`).
The `cloud.tracing` flag turns the spans off entirely.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from opentelemetry import propagate, trace
from opentelemetry.trace import (
    Link,
    NonRecordingSpan,
    SpanContext,
    SpanKind,
    TraceFlags,
)

from selecta import flags

FLAG = "cloud.tracing"
TRACER = "selecta"
JOB_ID = "selecta.job_id"
"""The span attribute every job span carries. Never use it as a metric label."""

log = logging.getLogger(__name__)
_provider: trace.TracerProvider | None = None


def use_provider(provider: trace.TracerProvider | None) -> None:
    """Send this process's spans to `provider` (tests pass one with an in-memory exporter);
    None goes back to the global provider."""
    global _provider
    _provider = provider


def enabled() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def tracer() -> trace.Tracer:
    provider = _provider or trace.get_tracer_provider()
    return provider.get_tracer(TRACER)


def _digest(job_id: str) -> bytes:
    return hashlib.sha256(f"selecta-job:{job_id}".encode()).digest()


def job_trace_id(job_id: str) -> int:
    """The trace id every span about this job shares (128 bits, never zero)."""
    return int.from_bytes(_digest(job_id)[:16], "big") or 1


def _job_root(job_id: str) -> SpanContext:
    span_id = int.from_bytes(_digest(job_id)[16:24], "big") or 1
    return SpanContext(
        trace_id=job_trace_id(job_id),
        span_id=span_id,
        is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )


def _parent_and_links(job_id: str):
    """Parent: the current span when it's already in this job's trace, else the job's root.
    The current span from another trace (an HTTP request) becomes a link instead."""
    current = trace.get_current_span().get_span_context()
    if current.is_valid and current.trace_id == job_trace_id(job_id):
        return None, []
    parent = trace.set_span_in_context(NonRecordingSpan(_job_root(job_id)))
    return parent, ([Link(current)] if current.is_valid else [])


def _attributes(job_id: str, service: str, extra: Mapping[str, Any]) -> dict[str, Any]:
    values = {JOB_ID: job_id, "selecta.service": service}
    values.update({key: value for key, value in extra.items() if value is not None})
    return values


@contextmanager
def job_span(
    name: str, job_id: str, *, service: str, kind: SpanKind = SpanKind.INTERNAL, **attributes: Any
) -> Iterator[trace.Span]:
    """A span about one job, in that job's trace, current for the block."""
    if not enabled():
        yield trace.INVALID_SPAN
        return
    parent, links = _parent_and_links(job_id)
    with tracer().start_as_current_span(
        name, context=parent, kind=kind, links=links,
        attributes=_attributes(job_id, service, attributes),
    ) as span:
        yield span


def record_job_span(
    name: str, job_id: str, started_ns: int, *, service: str, **attributes: Any
) -> None:
    """A finished span for work whose job id was only known at the end (enqueue, claim)."""
    if not job_id or not enabled():
        return
    parent, links = _parent_and_links(job_id)
    span = tracer().start_span(
        name, context=parent, links=links, start_time=started_ns,
        attributes=_attributes(job_id, service, attributes),
    )
    span.end()


def now_ns() -> int:
    return time.time_ns()


def inject_headers(headers: dict[str, str] | None = None) -> dict[str, str]:
    """The W3C trace headers for an outgoing request from the current span."""
    carrier = headers if headers is not None else {}
    if enabled():
        propagate.inject(carrier)
    return carrier


class TracingMiddleware:
    """A server span per HTTP request, named by route template (low cardinality), continuing
    any `traceparent` the caller sent. Pure ASGI, so event streams are not buffered."""

    def __init__(self, app, service: str) -> None:
        self.app = app
        self.service = service

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not enabled():
            await self.app(scope, receive, send)
            return
        carrier = {
            key.decode("latin-1"): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        method = scope.get("method", "GET")
        with tracer().start_as_current_span(
            method, context=propagate.extract(carrier), kind=SpanKind.SERVER,
            attributes={"http.request.method": method, "selecta.service": self.service},
        ) as span:

            async def send_traced(message):
                if message["type"] == "http.response.start":
                    span.set_attribute("http.response.status_code", message["status"])
                await send(message)

            try:
                await self.app(scope, receive, send_traced)
            finally:
                route = getattr(scope.get("route"), "path", None)
                if route:
                    span.set_attribute("http.route", route)
                    span.update_name(f"{method} {route}")


def install(app, service: str) -> None:
    """Trace every request `app` serves."""
    app.add_middleware(TracingMiddleware, service=service)


def configure_from_environment(service: str) -> bool:
    """Export spans over OTLP when the deployment asks for it and the extra is installed.
    Returns whether an exporter was set up. Never fails a service start."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint or not enabled():
        return False
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        log.warning("Tracing asked for but the 'observability' extra isn't installed.")
        return False
    provider = TracerProvider(resource=Resource.create({"service.name": f"selecta-{service}"}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    return True


__all__ = [
    "FLAG",
    "JOB_ID",
    "TracingMiddleware",
    "configure_from_environment",
    "enabled",
    "inject_headers",
    "install",
    "job_span",
    "job_trace_id",
    "now_ns",
    "record_job_span",
    "tracer",
    "use_provider",
]
