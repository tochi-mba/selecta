"""Staging walkthrough fixes (docs/engineering/staging-walkthrough-notes.md): an accepted upload
joins the catalogue, and a storage failure says so plainly and alerts an operator once."""

from __future__ import annotations

import sqlalchemy as sa
from test_cloud_upload_api import HEADERS, ClosingS3, _cloud_app, _plan, _send

from selecta.admin.schema import platform_alerts
from selecta.local_media import store
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.storage import failures
from selecta.storage.catalogue_link import UNKNOWN_ARTIST, register_upload, title_and_artist
from selecta.storage.objects import R2Error


def test_an_artist_and_title_file_name_is_split():
    assert title_and_artist("Adekunle Gold - Call on Me.mp3") == ("Call on Me", "Adekunle Gold")
    assert title_and_artist("Untitled jam.flac") == ("Untitled jam", UNKNOWN_ARTIST)
    assert title_and_artist(" - .wav") == ("-", UNKNOWN_ARTIST)


def test_an_accepted_upload_appears_in_the_catalogue(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "Adekunle Gold - Call on Me.mp3", "size": 10})
        _send(objects, b"x" * 10)
        body = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        ).json()
    assert body["status"] == "accepted"
    with transaction(cloud_engine, "workspace-a") as conn:
        songs, _ = store.list_songs(conn, "workspace-a", after=0, limit=10)
    assert [(song["title"], song["artist"]) for song in songs] == [("Call on Me", "Adekunle Gold")]


def test_a_song_already_imported_keeps_its_own_tags(cloud_engine):
    with transaction(cloud_engine, "ws") as conn:
        store.register_songs(conn, "ws", [{"content_sha256": "a" * 64, "title": "Real Title",
                                           "artist": "Real Artist"}])
        found = register_upload(conn, "ws", sha256="A" * 64, file_name="wrong - name.mp3",
                                duration_s=1.0, codec="mp3", sample_rate=44_100)
        rows = conn.execute(sa.select(local_songs.c.id, local_songs.c.title)).all()
    assert len(rows) == 1 and rows[0].title == "Real Title" and found == rows[0].id


def test_a_storage_failure_says_so_with_a_reference_and_alerts_once(cloud_engine):
    missing = R2Error("gone", status=404, code="NoSuchBucket")
    first = failures.storage_failure(cloud_engine, missing)
    second = failures.storage_failure(cloud_engine, missing)
    assert first.status_code == 503
    assert first.detail["code"] == "storage_unavailable"
    assert "Nothing was lost" in first.detail["message"]
    assert first.detail["reference"] in first.detail["message"]
    assert "updated" not in first.detail["message"]
    assert second.detail["reference"] != first.detail["reference"]
    with cloud_engine.connect() as conn:
        alerts = conn.execute(
            sa.select(platform_alerts.c.summary)
            .where(platform_alerts.c.kind == failures.ALERT_KIND)
        ).scalars().all()
    assert alerts == ["File storage refused an upload: the bucket does not exist."]
