"""One trace follows a job from the API to the gateway, the worker and storage (SC-0410-01).

The API and the gateway are real FastAPI apps with the tracing middleware; the worker is the
remote runner over an in-process bridge; storage is a fake transport. Spans go to the
OpenTelemetry SDK's in-memory exporter.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from test_cloud_jobs_support import Outputs, made_provenance, make_store
from test_cloud_runner_remote import BOOTSTRAP, HASH, STORAGE, TOKEN_SECRET, bridge, enroll

from selecta import flags
from selecta.observability import tracing
from selecta.work.enqueue import JobSpec
from selecta.work.gateway_api import install_routes
from selecta.workers import remote
from selecta.workers.runner import WorkerRunner


@pytest.fixture
def spans():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracing.use_provider(provider)
    flags.use(None)
    yield exporter
    tracing.use_provider(None)
    flags.use(None)


@pytest.fixture
def stack(cloud_engine):
    """An API that enqueues, a gateway workers talk to, and fake signed storage."""
    api_store = make_store(cloud_engine)
    api = FastAPI()
    tracing.install(api, "api")

    @api.post("/api/songs/{song_id}/analyse")
    def analyse(song_id: str):
        made = api_store.enqueue(JobSpec("w1", "analyse.song", input_ref={"song": song_id}))
        return {"job_id": made.job.id}

    outputs = Outputs()
    gateway_store = make_store(cloud_engine, verifier=outputs)
    gateway_store.trace_service = "gateway"
    gateway = FastAPI()
    tracing.install(gateway, "gateway")
    install_routes(
        gateway, store=gateway_store, token_secret=TOKEN_SECRET, bootstrap_token=BOOTSTRAP,
        allowed_pools=frozenset({"cpu-heavy"}),
        sign_inputs=lambda job: [{"name": "song.flac", "key": "w/x/song.flac",
                                  "url": f"{STORAGE}/song.flac?sig=1"}],
        output_prefix_for=lambda job, attempt_id: f"prefix/{attempt_id}/",
        sign_outputs=lambda attempt, names: [
            {"key": f"w/w1/analysis/{HASH}/attempts/{attempt.id}/{name}",
             "url": f"{STORAGE}/{name}?sig=2", "headers": {}}
            for name in names
        ],
    )
    return SimpleNamespace(api=TestClient(api), store=gateway_store,
                           transport=bridge(gateway))


def fake_storage(monkeypatch):
    real = httpx.Client
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, content=b"RIFF-audio")
        if request.method == "GET" else httpx.Response(200)
    )
    monkeypatch.setattr(remote.httpx, "Client",
                        lambda **kwargs: real(transport=transport, **kwargs))


def analyse(job, ctx):
    ctx.download_input("song.flac")
    made = ctx.scratch / "features.npz"
    made.write_bytes(b"features")
    ctx.publish_artifact("analysis", HASH, made, "features.npz", provenance=made_provenance())
    return {"bpm": 120}


def run_one_job(stack, monkeypatch) -> str:
    job_id = stack.api.post("/api/songs/s1/analyse").json()["job_id"]
    client = enroll(stack)
    fake_storage(monkeypatch)
    result = WorkerRunner(client, client.caps, {"analyse.song": analyse},
                          heartbeat_s=0.01).run_once()
    client.close()
    assert result.outcome == "succeeded"
    return job_id


def test_one_trace_follows_a_job_from_api_to_worker_to_storage(spans, stack, monkeypatch):
    job_id = run_one_job(stack, monkeypatch)
    finished = spans.get_finished_spans()
    trace_id = tracing.job_trace_id(job_id)
    in_trace = [span for span in finished if span.context.trace_id == trace_id]
    names = {(span.name, span.attributes.get("selecta.service")) for span in in_trace}
    assert {
        ("job.enqueue", "api"),
        ("job.wait", "gateway"),
        ("job.claim", "gateway"),
        ("worker.run", "worker"),
        ("storage.get", "worker"),
        ("storage.put", "worker"),
        ("job.complete", "gateway"),
    } <= names
    job_spans = [span for span in in_trace if span.name.startswith(("job.", "worker.", "storage."))]
    assert all(span.attributes[tracing.JOB_ID] == job_id for span in job_spans)

    wait = next(span for span in in_trace if span.name == "job.wait")
    assert wait.attributes["selecta.lane"] and wait.end_time >= wait.start_time

    by_id = {span.context.span_id: span for span in in_trace}
    run = next(span for span in in_trace if span.name == "worker.run")
    assert run.attributes["selecta.outcome"] == "succeeded"
    for name in ("storage.get", "storage.put"):
        child = next(span for span in in_trace if span.name == name)
        assert child.parent.span_id == run.context.span_id
    # The worker's completion call carries `traceparent`, so the gateway's server span for it
    # joins the job's trace under the worker's span, and the store's span nests inside that.
    complete = next(span for span in in_trace if span.name == "job.complete")
    server = by_id[complete.parent.span_id]
    assert server.attributes["selecta.service"] == "gateway"
    assert server.name == "POST /internal/workers/attempts/{attempt_id}/complete"
    assert server.parent.span_id == run.context.span_id


def test_the_api_request_that_made_a_job_is_linked_from_its_enqueue_span(spans, stack):
    job_id = stack.api.post("/api/songs/s2/analyse").json()["job_id"]
    finished = spans.get_finished_spans()
    request = next(span for span in finished if span.name == "POST /api/songs/{song_id}/analyse")
    assert request.attributes["http.response.status_code"] == 200
    enqueue = next(span for span in finished if span.name == "job.enqueue")
    assert enqueue.context.trace_id == tracing.job_trace_id(job_id)
    assert [link.context.span_id for link in enqueue.links] == [request.context.span_id]


def test_job_ids_are_span_attributes_and_never_span_names(spans, stack, monkeypatch):
    job_id = run_one_job(stack, monkeypatch)
    assert all(job_id not in span.name for span in spans.get_finished_spans())


def test_a_server_error_marks_the_request_span_as_an_error(spans):
    app = FastAPI()
    tracing.install(app, "api")

    @app.get("/api/broken")
    def broken():
        from fastapi import HTTPException

        raise HTTPException(status_code=503)

    assert TestClient(app).get("/api/broken").status_code == 503
    (span,) = spans.get_finished_spans()
    assert span.name == "GET /api/broken" and not span.status.is_ok


def test_turning_the_tracing_flag_off_records_nothing(spans, stack, monkeypatch):
    flags.use(f"-{tracing.FLAG}")
    run_one_job(stack, monkeypatch)
    assert spans.get_finished_spans() == ()


def test_without_an_endpoint_no_exporter_is_configured(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    assert tracing.configure_from_environment("api") is False
