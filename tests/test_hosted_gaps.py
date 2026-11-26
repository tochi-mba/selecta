"""Hosted mode's operational gaps (walkthrough section 11): per-account caps (T-20261125-ea6b),
operator alert mail (T-20261125-29a0), a customer's files with the grant off (T-20261125-d37b),
engine builds during a deploy (T-20261125-184c) and long tracks (T-20261125-4c09)."""

from __future__ import annotations

import hashlib

import httpx
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_hosted_stuck_jobs import hosted, song  # noqa: F401 - the shared hosted fixture

from selecta import flags, hosted_caps, hosted_limits, hosted_render
from selecta.admin import read_models
from selecta.admin.schema import platform_alerts
from selecta.notify import operator_alerts
from selecta.notify.mail import RecordingSender
from selecta.persistence import db_now, new_id, transaction
from selecta.scheduling.policy import Lane, WorkerCaps
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.usage import allowances
from selecta.usage.schema import allowance_counters
from selecta.work import gateway_api
from selecta.work.engine_build import engine_build
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs

# --- per-account caps (T-20261125-ea6b) ---------------------------------------------------------


@pytest.fixture
def small_caps(monkeypatch):
    """Two analyses and 100 transition seconds a day, so a test can reach both caps."""
    real = allowances.limit_for
    small = {hosted_caps.ANALYSIS: 2, hosted_caps.TRANSITIONS: 100.0}
    monkeypatch.setattr(allowances, "limit_for",
                        lambda plan, kind: small.get(kind, real(plan, kind)))


def used(engine, workspace: str, kind: str) -> float:
    with transaction(engine, workspace) as conn:
        return float(conn.execute(sa.select(sa.func.sum(allowance_counters.c.used)).where(
            allowance_counters.c.workspace_id == workspace,
            allowance_counters.c.kind == kind)).scalar() or 0.0)


def analysis_jobs(engine, workspace: str) -> list:
    with engine.connect() as conn:
        return conn.execute(sa.select(jobs.c.id, jobs.c.idempotency_key).where(
            jobs.c.workspace_id == workspace, jobs.c.type == "analyse.song")).all()


def test_each_song_pays_for_its_first_analysis_once_and_the_rest_wait(hosted, small_caps,  # noqa: F811
                                                                      monkeypatch):
    engine, work, workspace = hosted
    first, second, third = (song(engine, workspace, bytes([n]) * 64) for n in (1, 2, 3))
    made = hosted_render.prepare_songs(engine, work, workspace)
    assert (made["queued"], made["allowance"]) == (2, 1)
    assert used(engine, workspace, hosted_caps.ANALYSIS) == 2
    status = hosted_render.songs_status(engine, workspace)
    waiting = next(s for s in status["songs"] if s["asset_id"] == third["id"])
    words = hosted_caps.ANALYSIS_USED_UP.format(limit=2)
    assert waiting["status"] == {"state": "waiting", "reason": words, "job_id": None,
                                 "can_retry": False}
    assert status["allowance_used"]["why"] == words
    # asking again (a second tab, a retry of the request) takes nothing more
    hosted_render.prepare_songs(engine, work, workspace)
    assert used(engine, workspace, hosted_caps.ANALYSIS) == 2
    # our engine version bump re-analyses both songs and never charges for it
    monkeypatch.setattr(hosted_render, "ANALYSIS_VERSION", hosted_render.ANALYSIS_VERSION + 1)
    again = hosted_render.prepare_songs(engine, work, workspace, [first["id"], second["id"]])
    assert again["queued"] == 2 and used(engine, workspace, hosted_caps.ANALYSIS) == 2
    # a copy of the same bytes uploaded later shares the paid analysis
    copy_id = new_id()
    with transaction(engine, workspace) as conn:
        conn.execute(assets.insert().values(
            id=copy_id, workspace_id=workspace, original_key=original_key(workspace, copy_id),
            size=64, sha256=first["sha256"], format="mp3", duration_s=180.0,
            sample_rate=44_100, channels=2, created_at=db_now(conn)))
    hosted_render.prepare_songs(engine, work, workspace, [copy_id])
    assert used(engine, workspace, hosted_caps.ANALYSIS) == 2


def _seam_spec(workspace: str, a: dict, b: dict, move: str = "blend"):
    def side(found: dict) -> dict:
        return {**found, "display_name": "x - y.mp3", "analysis_key": None}

    return hosted_render._seam_spec(workspace, side(a), side(b), move, Lane.STANDARD, None)


def test_transitions_take_measured_seconds_once_and_stop_at_the_days_budget(hosted,  # noqa: F811
                                                                           small_caps):
    engine, work, workspace = hosted
    a, b, c = (song(engine, workspace, bytes([n]) * 64) for n in (4, 5, 6))
    spec = _seam_spec(workspace, a, b)
    why, by_allowance = hosted_render._make_paid(engine, work, spec, None,
                                                 hosted_caps.TRANSITIONS, 60.0)
    assert (why, by_allowance) == (None, False)
    assert used(engine, workspace, hosted_caps.TRANSITIONS) == 60.0
    # the same hand-off asked again (two tabs, a retried request): one job, paid once
    why, _ = hosted_render._make_paid(engine, work, spec, None, hosted_caps.TRANSITIONS, 60.0)
    assert why is None and used(engine, workspace, hosted_caps.TRANSITIONS) == 60.0
    # the next hand-off doesn't fit in what is left today: refused in plain words, no job
    why, by_allowance = hosted_render._make_paid(
        engine, work, _seam_spec(workspace, b, c), None, hosted_caps.TRANSITIONS, 60.0)
    assert by_allowance and why == hosted_caps.TRANSITIONS_USED_UP.format(minutes=2)
    with engine.connect() as conn:
        seams = conn.execute(sa.select(sa.func.count()).where(
            jobs.c.workspace_id == workspace, jobs.c.type == "seam.render")).scalar_one()
    assert seams == 1 and used(engine, workspace, hosted_caps.TRANSITIONS) == 60.0


def test_with_the_caps_flag_off_nothing_is_counted_or_refused(hosted, small_caps):  # noqa: F811
    engine, work, workspace = hosted
    for n in (7, 8, 9):
        song(engine, workspace, bytes([n]) * 64)
    with flags.bound({hosted_caps.FLAG: False}):
        made = hosted_render.prepare_songs(engine, work, workspace)
        assert made["queued"] == 3 and made["allowance"] == 0
    assert used(engine, workspace, hosted_caps.ANALYSIS) == 0


def test_each_plans_transition_budget_and_its_cost_are_in_one_place():
    assert dict(hosted_caps.TRANSITION_SECONDS_PER_DAY) == {
        "free": 1_200, "standard": 3_600, "premium": 10_800}
    assert [hosted_caps.daily_cost_usd(plan) for plan in ("free", "standard", "premium")] == [
        0.08, 0.24, 0.72]


# --- operator alert mail (T-20261125-29a0) ------------------------------------------------------

ENV = {operator_alerts.ADDRESS_ENV: "ops@example.com",
       operator_alerts.GATEWAY_ENV: "https://gateway.secret-host.test"}


def stuck_job(engine, workspace: str, waited: float) -> str:
    job_id = new_id()
    with transaction(engine) as conn:
        now = db_now(conn)
        conn.execute(jobs.insert().values(
            id=job_id, workspace_id=workspace, type="analyse.song", pool="cpu-heavy",
            lane="standard", base_lane="standard", urgency=2, base_urgency=2, est_cost_s=40.0,
            state="queued", max_attempts=6, max_run_s=1200.0, input_ref={},
            created_at=now - waited, updated_at=now - waited, queued_at=now - waited))
    return job_id


def test_each_condition_mails_once_an_hour_and_once_when_it_clears(hosted):  # noqa: F811
    engine, _work, workspace = hosted
    sender = RecordingSender()
    job_id = stuck_job(engine, workspace, 1_800)
    with transaction(engine) as conn:
        now = db_now(conn)
        conn.execute(platform_alerts.insert().values(
            id=new_id(), created_at=now, kind="autoscale.spend_ceiling", summary="held",
            metadata={"pool": "cpu-heavy"}))
        read_models.report(conn, "health.modal", 0.0, None, now)
    down = {"state": "unreachable"}

    def run(at: float, answer=down):
        return operator_alerts.run(engine, ENV, sender, now=at, check=lambda *_: answer,
                                   enabled=lambda: True)

    first = run(now)
    assert set(first["active"]) == {"queue_stuck:cpu-heavy", "gateway", "autoscaler",
                                    "spend_ceiling:cpu-heavy"}
    assert first["sent"] == 4 and len(sender.sent) == 4
    gateway = next(m for m in sender.sent if "gateway" in m.subject)
    assert "What to do: Open the worker-gateway service in Render" in gateway.text
    assert all("secret-host" not in m.text and "ops@" not in m.text for m in sender.sent)
    assert run(now + 60)["sent"] == 0, "at most one mail an hour per condition"
    # an hour later three are still wrong (one reminder each); the spend ceiling has cleared
    with transaction(engine) as conn:
        read_models.report(conn, "health.modal", 0.0, None, now + 3_600)
    later = run(now + 3_601)
    assert (later["sent"], later["resolved"]) == (3, 1)
    with transaction(engine) as conn:
        conn.execute(jobs.update().where(jobs.c.id == job_id).values(state="succeeded"))
        read_models.report(conn, "health.modal", 1.0, None, now + 3_700)
    cleared = run(now + 3_700, {"state": "ok"})
    assert cleared["resolved"] == 3 and cleared["sent"] == 0
    assert all(m.subject.startswith("Resolved: ") for m in sender.sent[-3:])
    assert run(now + 3_760, {"state": "ok"}) == {
        "active": [], "sent": 0, "resolved": 0, "configured": True}


def test_with_no_address_nothing_is_sent_and_the_console_is_told(hosted):  # noqa: F811
    engine, _work, workspace = hosted
    sender = RecordingSender()
    stuck_job(engine, workspace, 1_800)
    done = operator_alerts.run(engine, {}, sender, enabled=lambda: True)
    assert done["configured"] is False and done["active"] and sender.sent == []
    with transaction(engine) as conn:
        assert operator_alerts.configured(conn) is False
    operator_alerts.run(engine, ENV, sender, enabled=lambda: False, check=lambda *_: {})
    assert sender.sent == [], "the flag switches the mail off"


# --- the grant switched off (T-20261125-d37b) ---------------------------------------------------


def test_a_customers_exports_and_originals_belong_to_stored_media_not_the_grant():
    owners = flags.route_owners()
    for route in ("GET /api/stored/exports", "GET /api/assets/{asset_id}/playback-url"):
        assert owners[route] == "cloud.stored_media", route
    stored = flags.registry()["cloud.stored_media"]
    assert "cloud.hosted_media" not in stored.requires


def test_finished_exports_stay_listed_with_a_download_link(hosted):  # noqa: F811
    from selecta import hosted_export
    from selecta.storage.artifacts import DEFAULT_BUCKETS
    from selecta.storage.keys import derived_key
    from selecta.work.schema import artifacts

    engine, _work, workspace = hosted
    key = derived_key(workspace, "export", "c" * 64, new_id(), "mix.flac")
    with transaction(engine, workspace) as conn:
        now = db_now(conn)
        conn.execute(artifacts.insert().values(
            id=new_id(), workspace_id=workspace, kind="export", input_hash="c" * 64, keys=[key],
            checksum="d" * 64, size_bytes=99, provenance={"inputs": {}}, created_at=now,
            last_used_at=now))

    class Signer:
        def presign_get(self, bucket, signed, ttl, download_name=None):
            return f"https://r2.test/{bucket}/{signed}?ttl={ttl}"

    [found] = hosted_export.stored_exports(engine, workspace, client=Signer(),
                                           buckets=DEFAULT_BUCKETS)["exports"]
    assert found["url"].endswith(f"{key}?ttl=900") and found["size_bytes"] == 99
    assert found["expires_at"] == pytest.approx(now + 7 * 86_400, abs=5)  # Free keeps 7 days


# --- engine builds during a deploy (T-20261125-184c) --------------------------------------------

TOKEN_SECRET = "test-worker-token-secret-that-is-long-enough"
BOOTSTRAP = "test-worker-bootstrap-token-that-is-long-enough"


def gateway_app(store, monkeypatch=None, build: str | None = None) -> FastAPI:
    if build is not None:
        monkeypatch.setattr(gateway_api, "engine_build", lambda: build)
    app = FastAPI()
    gateway_api.install_routes(app, store=store, token_secret=TOKEN_SECRET,
                               bootstrap_token=BOOTSTRAP, allowed_pools=frozenset({"cpu-light"}))
    return app


def register(client: TestClient, build: str | None):
    body = {"pool": "cpu-light", "job_types": ["ingest.validate"]}
    if build is not None:
        body["engine_build"] = build
    return client.post("/internal/workers/register", json=body,
                       headers={"Authorization": f"Bearer {BOOTSTRAP}"})


def test_a_worker_on_another_engine_build_is_turned_away_and_jobs_wait(hosted, monkeypatch):  # noqa: F811
    from selecta.work.store import JobStore

    engine, _work, _workspace = hosted
    store = JobStore(engine)
    queued = store.enqueue(JobSpec("workspace-1", "ingest.validate", input_ref={"a": 1}))
    with TestClient(gateway_app(store)) as client:
        old = register(client, "a0.r0.p0.x0")
        assert old.status_code == 409
        assert old.json()["detail"]["code"] == "engine_build_mismatch"
        assert old.json()["detail"]["gateway_build"] == engine_build()
        ok = register(client, engine_build())
        assert ok.status_code == 201 and ok.json()["engine_build"] == engine_build()
        assert register(client, None).status_code == 201, "a worker built before the rule"
    token = ok.json()["token"]
    # the gateway is deployed with the next build; the worker registered before it is refused
    with TestClient(gateway_app(store, monkeypatch, "a99.r2.p2.x2")) as client:
        claim = client.post("/internal/workers/claim",
                            headers={"Authorization": f"Bearer {token}"})
    assert claim.status_code == 409 and claim.json()["detail"]["worker_build"] == engine_build()
    assert str(store.job(queued.job.id).state) == "queued", "its jobs wait, they don't fail"
    with transaction(engine) as conn:
        from selecta.admin import hosted_status

        refused = hosted_status.refused_builds(conn, db_now(conn))
    assert {r["worker_build"] for r in refused} >= {"a0.r0.p0.x0", engine_build()}


def test_the_worker_exits_when_its_build_is_turned_away():
    from selecta.workers.remote import RemoteWorkerClient, WorkerOutdated

    refusal = httpx.MockTransport(lambda request: httpx.Response(409, json={"detail": {
        "code": "engine_build_mismatch", "worker_build": "a1", "gateway_build": "a2"}}))
    with pytest.raises(WorkerOutdated) as caught:
        RemoteWorkerClient.register("https://gateway.test", WorkerCaps(pool="cpu-heavy"),
                                    bootstrap_token="t", api_transport=refusal)
    assert isinstance(caught.value, SystemExit) and "a2" in str(caught.value)
    newer = httpx.MockTransport(lambda request: httpx.Response(201, json={
        "worker_id": "w", "token": "t", "expires_in": 60, "engine_build": "a99"}))
    with pytest.raises(WorkerOutdated):
        RemoteWorkerClient.register("https://gateway.test", WorkerCaps(pool="cpu-heavy"),
                                    bootstrap_token="t", api_transport=newer)


# --- long tracks (T-20261125-4c09) ---------------------------------------------------------------


def test_a_song_over_the_limit_gets_no_job_and_says_why_at_once(hosted):  # noqa: F811
    engine, work, workspace = hosted
    long_song = song(engine, workspace, b"long" * 16)
    with transaction(engine, workspace) as conn:
        conn.execute(assets.update().where(assets.c.id == long_song["id"])
                     .values(duration_s=62 * 60.0))
    made = hosted_render.prepare_songs(engine, work, workspace)
    assert made["too_long"] == 1 and analysis_jobs(engine, workspace) == []
    [entry] = hosted_render.songs_status(engine, workspace)["songs"]
    assert entry["status"]["state"] == "failed" and entry["status"]["can_retry"] is False
    assert entry["status"]["reason"].startswith("This song is 1 hour 2 minutes long.")
    assert "up to 30 minutes" in entry["status"]["reason"]


def test_a_long_songs_jobs_get_limits_that_follow_its_length(hosted):  # noqa: F811
    engine, work, workspace = hosted
    found = song(engine, workspace, hashlib.sha256(b"x").digest() * 2)
    with transaction(engine, workspace) as conn:
        conn.execute(assets.update().where(assets.c.id == found["id"])
                     .values(duration_s=25 * 60.0))
    hosted_render.prepare_songs(engine, work, workspace)
    with engine.connect() as conn:
        limit = conn.execute(sa.select(jobs.c.max_run_s).where(
            jobs.c.type == "analyse.song")).scalar_one()
    assert limit == 1_800.0  # 1.2 x 25 minutes, over the catalogue's 1,200 s
    assert hosted_limits.analysis_run_s(180.0) == 1_200.0
    assert hosted_limits.proxy_run_s(30 * 60.0) == 540.0
    assert hosted_limits.export_too_long(4 * 3600.0) is None
    assert hosted_limits.export_too_long(5 * 3600.0 + 600).startswith(
        "This mix is 5 hours 10 minutes long; an export can be at most 4 hours.")
