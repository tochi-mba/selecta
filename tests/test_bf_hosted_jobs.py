"""Hosted-media job admission and local-first non-admission (BF-0456-03).

These are integration tests over the real queue claim path.  They deliberately name the
`cloud.hosted_media` grant rather than the older `core.analysis` examples, so a future catalogue
regression cannot leave hosted processing running for an account whose grant was revoked.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import Flags, make_store, worker

from selecta.local_media import store as local_media_store
from selecta.persistence import transaction
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
    assert queue.claim(pool, worker()) is None
    held = _row(cloud_engine, queued.id)
    assert (held.state, held.error_class) == ("blocked", "flag_off")

    gate.off.remove(("ws-hosted", HOSTED))
    claimed = queue.claim(pool, worker())
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

