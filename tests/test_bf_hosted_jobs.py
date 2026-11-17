"""Hosted-media job admission and local-first non-admission (BF-0456-03).

These are integration tests over the real queue claim path. They name the `cloud.hosted_media`
grant (ADR-0456) rather than the older core-flag examples, so a catalogue regression cannot leave
hosted processing running for an account whose grant was revoked. The first tests use the fake
flag port; the per-workspace tests at the end decide through the real rule store and
`CloudJobFlags`, with the grandfather rules (`hosted_coexistence.grandfather`) granting one
workspace and the catch-all ruling the other off.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import Flags, make_store, worker

from selecta.flags import rules as flag_rules
from selecta.flags.rules import RulesCache
from selecta.hosted_coexistence.grandfather import build_grandfather_rules
from selecta.identity.schema import users, workspaces
from selecta.local_media import store as local_media_store
from selecta.persistence import transaction
from selecta.work import catalogue
from selecta.work.cloud_ports import CloudJobFlags
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs

HOSTED = "cloud.hosted_media"


def _row(engine, job_id: str):
    with transaction(engine) as conn:
        return conn.execute(sa.select(jobs).where(jobs.c.id == job_id)).one()


@pytest.mark.parametrize(
    ("job_type", "pool"),
    (("analyse.song", "cpu-heavy"), ("seam.render", "cpu-heavy"), ("export.render", "export")),
)
def test_each_hosted_job_drains_on_revocation_and_resumes_when_granted(
    cloud_engine, job_type: str, pool: str
):
    gate = Flags()
    queue = make_store(cloud_engine, flags=gate)
    queue.flag_resume_s = 0.0
    queued = queue.enqueue(JobSpec("ws-hosted", job_type)).job
    assert queued.flag_id == HOSTED

    gate.off.add(("ws-hosted", HOSTED))
    assert queue.claim(pool, worker(pool)) is None
    held = _row(cloud_engine, queued.id)
    assert (held.state, held.error_class) == ("blocked", "flag_off")

    gate.off.remove(("ws-hosted", HOSTED))
    claimed = queue.claim(pool, worker(pool))
    assert claimed is not None and claimed.job.id == queued.id
    assert _row(cloud_engine, queued.id).error_class is None


def test_stored_media_proxy_work_is_not_stopped_with_the_hosted_write_grant(cloud_engine):
    gate = Flags()
    gate.off.add(("ws-existing", HOSTED))
    queue = make_store(cloud_engine, flags=gate)
    queued = queue.enqueue(JobSpec("ws-existing", "play.proxy")).job

    assert queued.flag_id == "core.playback"
    claimed = queue.claim("cpu-light", worker())
    assert claimed is not None and claimed.job.id == queued.id


def test_registering_local_first_metadata_enqueues_no_hosted_processing(cloud_engine):
    """Local import is metadata-only: registering it cannot create hosted analysis/render work."""
    workspace = "ws-local-first"
    with transaction(cloud_engine, workspace) as conn:
        local_media_store.register_songs(
            conn,
            workspace,
            [{"content_sha256": "a" * 64, "title": "Night Drive", "artist": "Rex"}],
        )
        queued = conn.execute(
            sa.select(jobs.c.type).where(
                jobs.c.workspace_id == workspace,
                jobs.c.flag_id == HOSTED,
            )
        ).all()
    assert queued == []


HOSTED_JOBS = (
    ("analyse.song", "cpu-heavy"),
    ("seam.render", "cpu-heavy"),
    ("export.render", "export"),
)


def test_the_catalogue_points_hosted_jobs_at_the_grant_and_proxies_at_playback():
    for job_type, pool in HOSTED_JOBS:
        assert (catalogue.lookup(job_type).flag_id, catalogue.lookup(job_type).pool) == (
            HOSTED,
            pool,
        )
    assert catalogue.lookup("play.proxy").flag_id == "core.playback"


def _accounts(engine, *pairs: tuple[str, str]) -> None:
    with transaction(engine) as conn:
        for workspace, user in pairs:
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
                age_confirmed=True, created_at=0.0,
            ))
            conn.execute(workspaces.insert().values(
                id=workspace, name="Mine", kind="personal", owner_user_id=user, created_at=0.0,
            ))


@pytest.fixture
def ruled(cloud_engine):
    """ws-granted holds the grant by a WORKSPACES rule; ws-ruled-off is caught by the trailing
    catch-all off rule, exactly the cutover shape of docs/operations/bf-rollout-runbook.md."""
    _accounts(cloud_engine, ("ws-granted", "u-granted"), ("ws-ruled-off", "u-ruled-off"))
    with transaction(cloud_engine) as conn:
        flag_rules.save(
            conn, HOSTED, build_grandfather_rules(["ws-granted"]), author="test", reason="jobs"
        )
    return make_store(cloud_engine, flags=CloudJobFlags(cloud_engine, RulesCache(cloud_engine)))


@pytest.mark.parametrize(("job_type", "pool"), HOSTED_JOBS)
def test_hosted_jobs_are_refused_per_workspace_when_the_grant_is_ruled_off(
    cloud_engine, ruled, job_type: str, pool: str
):
    off = ruled.enqueue(JobSpec("ws-ruled-off", job_type)).job
    on = ruled.enqueue(JobSpec("ws-granted", job_type)).job

    claimed = ruled.claim(pool, worker(pool))
    assert claimed is not None and claimed.job.id == on.id
    assert ruled.claim(pool, worker(pool, "worker-2")) is None
    held = _row(cloud_engine, off.id)
    assert held.error_class == "flag_off"
    assert held.state in ("blocked", "cancelled")


def test_stored_media_proxies_are_still_admitted_for_a_ruled_off_workspace(cloud_engine, ruled):
    queued = ruled.enqueue(JobSpec("ws-ruled-off", "play.proxy")).job
    claimed = ruled.claim("cpu-light", worker("cpu-light"))
    assert claimed is not None and claimed.job.id == queued.id
