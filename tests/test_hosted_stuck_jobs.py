"""Songs whose analysis job can never finish get a fresh one, and the card is told plainly.

Found on staging, 2026-11-25 (to-do T-20261125-4528): two `analyse.song` jobs queued before jobs
declared their output namespace sat in `retry_scheduled` for good, the idempotency key stopped a
fresh job, and the card said "About 1 minute left" for ever.
"""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media

from selecta import hosted_render, hosted_status
from selecta.admin.state import DbWorkControls
from selecta.business.weight import business_policy
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now, make_engine, migrate, new_id, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.work.cloud_ports import CloudJobEntitlements
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs, workers
from selecta.work.store import JobStore


@pytest.fixture
def hosted(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'stuck.sqlite'}")
    migrate.upgrade(engine)
    workspace, user = new_id(), new_id()
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id=workspace, name="Mine", kind="personal", owner_user_id=user, created_at=0.0))
    grant_hosted_media(engine)
    work = hosted_render.Work(JobStore(engine, business_policy(),
                                       entitlements=CloudJobEntitlements(engine),
                                       controls=DbWorkControls()))
    yield engine, work, workspace
    engine.dispose()


def song(engine, workspace: str, body: bytes) -> dict:
    asset_id = new_id()
    with transaction(engine, workspace) as conn:
        conn.execute(assets.insert().values(
            id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
            size=len(body), sha256=hashlib.sha256(body).hexdigest(), format="mp3",
            duration_s=180.0, sample_rate=44_100, channels=2, created_at=db_now(conn)))
    return {"id": asset_id, "sha256": hashlib.sha256(body).hexdigest()}


def old_style_job(work, workspace: str, found: dict, state: str = "retry_scheduled") -> str:
    """A job as staging queued it before 31b88a2d: no `output`, then stuck in `state`."""
    spec = hosted_render._analysis_spec(workspace, found, None)
    ref = {k: v for k, v in spec.input_ref.items() if k != "output"}
    job = work.store.enqueue(JobSpec(**{**spec.__dict__, "input_ref": ref})).job
    with transaction(work.store.engine) as conn:
        conn.execute(jobs.update().where(jobs.c.id == job.id).values(
            state=state, not_before=db_now(conn) + 3600 if state == "retry_scheduled" else None,
            error_class="engine_bug" if state == "retry_scheduled" else None))
    return job.id


def live(engine, workspace: str) -> list:
    with engine.connect() as conn:
        return conn.execute(sa.select(jobs.c.id, jobs.c.state, jobs.c.input_ref).where(
            jobs.c.workspace_id == workspace,
            jobs.c.state.notin_(("succeeded", "failed", "cancelled", "quarantined")))).all()


def finish(engine, job_id: str, state: str, error_class: str | None = None, detail: str = ""):
    with transaction(engine) as conn:
        conn.execute(jobs.update().where(jobs.c.id == job_id).values(
            state=state, error_class=error_class, error_detail=detail,
            finished_at=db_now(conn)))


def test_a_job_with_no_declared_output_is_replaced_once_however_often_prepare_runs(hosted):
    engine, work, workspace = hosted
    one = song(engine, workspace, b"one")
    old = old_style_job(work, workspace, one)
    for _ in range(3):  # three tabs, or one tab polling
        hosted_render.prepare_songs(engine, work, workspace)
    now_live = live(engine, workspace)
    assert len(now_live) == 1
    assert now_live[0].id != old
    assert now_live[0].input_ref["output"]["kind"] == "analysis"
    with engine.connect() as conn:
        assert conn.execute(sa.select(jobs.c.state).where(jobs.c.id == old)).scalar() == (
            "cancelled")


def test_a_replacement_that_lost_the_race_returns_the_winners_job(hosted):
    engine, work, workspace = hosted
    one = song(engine, workspace, b"one")
    old = old_style_job(work, workspace, one, state="queued")
    spec = hosted_render._analysis_spec(workspace, one, None)
    first, _ = work.renew(spec, old)
    second, _ = work.renew(spec, old)  # the second tab, holding the same stale row
    assert first == second
    assert [row.id for row in live(engine, workspace)] == [first]


def test_a_job_a_worker_holds_is_asked_to_stop_and_replaced_after(hosted):
    engine, work, workspace = hosted
    one = song(engine, workspace, b"one")
    old = old_style_job(work, workspace, one, state="running")
    made = hosted_render.prepare_songs(engine, work, workspace)
    assert made["replaced"] == 0
    assert [(row.id, row.state) for row in live(engine, workspace)] == [(old,
                                                                          "cancel_requested")]
    status = hosted_render.songs_status(engine, workspace)["songs"][0]["status"]
    assert status["state"] == "waiting" and status["reason"] == hosted_status.STARTING_AGAIN
    finish(engine, old, "cancelled")
    hosted_render.prepare_songs(engine, work, workspace)
    assert len(live(engine, workspace)) == 1


def test_a_song_with_no_job_gets_one_and_a_good_job_is_left_alone(hosted):
    engine, work, workspace = hosted
    song(engine, workspace, b"one")
    assert hosted_render.prepare_songs(engine, work, workspace)["queued"] == 1
    first = live(engine, workspace)
    made = hosted_render.prepare_songs(engine, work, workspace)
    assert (made["queued"], made["replaced"]) == (0, 0)
    assert live(engine, workspace) == first


def test_failures_on_our_side_renew_a_few_times_and_a_songs_own_failure_waits_for_try_again(
        hosted):
    engine, work, workspace = hosted
    ours = song(engine, workspace, b"ours")
    theirs = song(engine, workspace, b"theirs")
    hosted_render.prepare_songs(engine, work, workspace)
    by_sha = {row.input_ref["source_sha256"]: row.id for row in live(engine, workspace)}
    finish(engine, by_sha[theirs["sha256"]], "failed", "input_invalid",
           "No steady beat was found in this song.")
    for _ in range(hosted_status.AUTO_RENEW_LIMIT + 2):
        for row in live(engine, workspace):
            if row.input_ref["source_sha256"] == ours["sha256"]:
                finish(engine, row.id, "failed", "engine_bug",
                       'Traceback (most recent call last):\n  File "x.py", line 1\nValueError')
        hosted_render.prepare_songs(engine, work, workspace)
    with engine.connect() as conn:
        made = conn.execute(sa.select(sa.func.count()).where(
            jobs.c.input_ref.is_not(None))).scalar()
    # theirs once; ours until AUTO_RENEW_LIMIT of its jobs have failed
    assert made == 1 + hosted_status.AUTO_RENEW_LIMIT
    status = {s["asset_id"]: s for s in hosted_render.songs_status(engine, workspace)["songs"]}
    assert status[theirs["id"]]["status"] == {
        "state": "failed", "reason": "No steady beat was found in this song.",
        "job_id": status[theirs["id"]]["status"]["job_id"], "can_retry": True}
    words = status[ours["id"]]["status"]["reason"]
    assert status[ours["id"]]["status"]["state"] == "failed"
    assert "Traceback" not in words and "File" not in words
    assert "Traceback" not in status[ours["id"]]["analysis"]["why"]
    hosted_render.prepare_songs(engine, work, workspace, [theirs["id"]], retry=True)
    assert hosted_render.song_status(engine, workspace, theirs["id"])["status"]["state"] == (
        "waiting")


def test_the_status_never_estimates_when_nothing_moves(hosted):
    engine, work, workspace = hosted
    for body in (b"a", b"b"):
        song(engine, workspace, body)
    hosted_render.prepare_songs(engine, work, workspace)
    found = hosted_render.songs_status(engine, workspace)
    assert (found["estimate_s"], found["moving"], found["waiting_for"]) == (None, False, "worker")
    assert found["totals"] == {"waiting": 2, "running": 0, "done": 0, "failed": 0, "total": 2}
    assert {s["status"]["reason"] for s in found["songs"]} == {hosted_status.WAITING_FOR_WORKER}
    assert found["counts"]["queued"] == 2  # the first shape, still there
    with transaction(engine) as conn:
        conn.execute(workers.insert().values(
            id="w1", pool="cpu-heavy", slots=1, worker_class=0, capabilities={},
            draining=False, registered_at=db_now(conn), last_seen_at=db_now(conn)))
    found = hosted_render.songs_status(engine, workspace)
    assert found["moving"] is True and found["estimate_s"] > 0
    with transaction(engine) as conn:
        conn.execute(jobs.update().values(state="retry_scheduled",
                                          not_before=db_now(conn) + 600))
    found = hosted_render.songs_status(engine, workspace)
    assert (found["estimate_s"], found["waiting_for"]) == (None, "retry")


def test_songs_with_the_same_bytes_share_one_job_and_say_so(hosted):
    engine, work, workspace = hosted
    first = song(engine, workspace, b"same")
    second = song(engine, workspace, b"same")
    hosted_render.prepare_songs(engine, work, workspace)
    assert len(live(engine, workspace)) == 1
    found = {s["asset_id"]: s for s in hosted_render.songs_status(engine, workspace)["songs"]}
    assert found[first["id"]]["same_file_as"] == [second["id"]]
    assert found[first["id"]]["status"]["job_id"] == found[second["id"]]["status"]["job_id"]


@pytest.mark.parametrize(("job", "expected"), [
    (None, "no_job"),
    ({"state": "queued", "input_ref": {}}, "no_output"),
    ({"state": "queued", "input_ref": {"output": {"kind": "analysis", "input_hash": "x"}}},
     None),
    ({"state": "blocked", "error_class": "staff_hold", "input_ref": {}}, None),
    ({"state": "cancel_requested", "input_ref": {}}, None),
    ({"state": "succeeded", "input_ref": {}}, "evicted"),
    ({"state": "cancelled", "input_ref": {}}, "cancelled"),
    ({"state": "failed", "error_class": "transient", "input_ref": {}}, "failed_ours"),
    ({"state": "failed", "error_class": "input_invalid", "input_ref": {}}, None),
    ({"state": "quarantined", "error_class": "poison", "input_ref": {}}, None),
])
def test_needs_new(job, expected):
    output = {"kind": "analysis", "input_hash": "x"}
    assert hosted_status.needs_new(False, job, output, renew_failed=True) == expected
    assert hosted_status.needs_new(True, job, output, renew_failed=True) is None
