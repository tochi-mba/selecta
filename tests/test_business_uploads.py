"""Uploads remember who made them (ADR-0442 BZ-0442-05).

`POST /api/uploads/plan` passes the signed-in person to `Uploads.plan_batch(uploaded_by=...)`;
the kept asset records it in `assets.uploaded_by`. In an organisation the library names the
uploader while they are a member and says "Former member" once they are not
(`business.members.uploader_label`). Older sessions with no uploader keep `uploaded_by` empty.
"""

from __future__ import annotations

import sqlalchemy as sa
from test_cloud_storage_fakes import FakeS3, Limits
from test_cloud_uploads_completion import WS, RealQuota, complete, planned_sizes

from selecta.business.members import FORMER_MEMBER, uploader_label
from selecta.persistence import transaction
from selecta.storage.parts import PART_SIZE
from selecta.storage.schema import assets
from selecta.storage.uploads import FileSpec, Probe, Status, Uploads


def _keep(engine, fake, uploads, uploaded_by):
    with transaction(engine, WS) as conn:
        session = uploads.plan_batch(conn, WS, [FileSpec("song.wav", PART_SIZE + 10)],
                                     uploaded_by=uploaded_by)[0].session
    fake.upload_sizes(session.upload_id, planned_sizes(PART_SIZE + 10))
    complete(engine, uploads, session.id)
    with transaction(engine, WS) as conn:
        outcome = uploads.accept(conn, session.id,
                                 Probe("wav", 60.0, 44_100, 2, "e" * 64, PART_SIZE + 10),
                                 workspace_id=WS)
    assert outcome.status is Status.ACCEPTED
    return outcome.asset_id


def test_the_kept_asset_names_who_uploaded_it(cloud_engine):
    fake = FakeS3()
    uploads = Uploads(fake, quota=RealQuota(), limits=Limits())
    asset_id = _keep(cloud_engine, fake, uploads, "user-sam")
    with transaction(cloud_engine, WS) as conn:
        assert conn.execute(sa.select(assets.c.uploaded_by).where(
            assets.c.id == asset_id)).scalar() == "user-sam"
        # Sam is not a member of this workspace, so the library says "Former member".
        assert uploader_label(conn, WS, "user-sam") == FORMER_MEMBER


def test_an_upload_without_an_uploader_keeps_it_empty(cloud_engine):
    fake = FakeS3()
    uploads = Uploads(fake, quota=RealQuota(), limits=Limits())
    asset_id = _keep(cloud_engine, fake, uploads, None)
    with transaction(cloud_engine, WS) as conn:
        assert conn.execute(sa.select(assets.c.uploaded_by).where(
            assets.c.id == asset_id)).scalar() is None
