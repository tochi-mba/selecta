"""Over-quota behavior (SC-0402-03; storage/playback proposal §5.4).

When a plan change leaves a workspace above its limit, storage becomes read-only. New uploads
are refused with the overage named; playback, downloads, data export, and deletion still work.
The plan change itself never deletes customer data.
"""

from __future__ import annotations

import io
import zipfile

from cloud_world import HEADERS, ORIGINALS, add_asset, add_playback_file, signed_up

from selecta.billing.plans import plan_for
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.usage import quota

SONG = b"RIFF-not-really-audio-but-stored-bytes" * 50


def _over_quota(world, limit: int):
    with transaction(world.engine, world.workspace_id) as conn:
        return quota.set_limit(conn, world.workspace_id, plan_for("free"), limit_bytes=limit)


def test_an_over_quota_workspace_is_named_and_refused_new_uploads(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        add_asset(world.engine, world.objects, world.workspace_id, SONG)
        usage = _over_quota(world, 500)
        assert usage.read_only

        account = world.client.get("/api/account", headers=HEADERS).json()
        storage = account["usage"]["storage"]
        assert storage["state"] == "over_quota_read_only"
        assert storage["over_by_bytes"] == len(SONG) - 500
        assert account["usage"]["exports_month"]["blocked"] is True

        planned = world.client.post(
            "/api/uploads/plan",
            headers=HEADERS,
            json={"files": [{"name": "new.wav", "size": 10, "sha256": "a" * 64}]},
        )
        # Each refused file says why, and no upload session or reservation is made for it.
        assert planned.status_code == 201, planned.text
        [entry] = planned.json()["uploads"]
        assert entry["session"] is None
        assert "over your plan" in entry["refused"]
        assert "Free up space or upgrade" in entry["refused"]
        assert world.objects.count("create_multipart_upload") == 0


def test_an_over_quota_workspace_still_plays_downloads_and_exports(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, SONG)
        add_playback_file(world.engine, world.objects, world.workspace_id, asset_id, b"flac")
        _over_quota(world, 500)

        listed = world.client.get("/api/assets", headers=HEADERS)
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["assets"]] == [asset_id]

        download = world.client.get(f"/api/assets/{asset_id}/playback-url", headers=HEADERS)
        assert download.status_code == 200, download.text
        assert download.json()["url"]

        proxy = world.client.get(f"/api/assets/{asset_id}/playback-proxy", headers=HEADERS)
        assert proxy.status_code == 200, proxy.text
        assert proxy.json()["status"] == "ready"

        export = world.client.get("/api/account/export", headers=HEADERS)
        assert export.status_code == 200, export.text
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            originals = [name for name in archive.namelist() if name.startswith("originals/")]
            assert len(originals) == 1
            assert archive.read(originals[0]) == SONG


def test_going_over_quota_deletes_nothing_and_songs_can_still_be_removed(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        kept = add_asset(world.engine, world.objects, world.workspace_id, SONG)
        removed = add_asset(world.engine, world.objects, world.workspace_id, SONG + b"2")
        _over_quota(world, 500)

        with world.engine.connect() as conn:
            hidden = conn.execute(
                assets.select().where(assets.c.workspace_id == world.workspace_id)
            ).mappings().all()
        assert all(row["deleted_at"] is None for row in hidden)
        for asset_id in (kept, removed):
            assert (ORIGINALS, original_key(world.workspace_id, asset_id)) in world.objects.objects

        deleted = world.client.delete(f"/api/assets/{removed}", headers=HEADERS)
        assert deleted.status_code in (200, 202, 204), deleted.text
        account = world.client.get("/api/account", headers=HEADERS).json()
        # Freeing space lowers the overage; the workspace stays read-only until it fits.
        assert account["usage"]["storage"]["over_by_bytes"] == len(SONG) - 500


def test_freeing_enough_space_lifts_the_over_quota_state(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, SONG)
        _over_quota(world, 500)
        assert world.client.delete(f"/api/assets/{asset_id}", headers=HEADERS).status_code < 300
        storage = world.client.get("/api/account", headers=HEADERS).json()["usage"]["storage"]
        assert (storage["state"], storage["over_by_bytes"]) == ("ok", 0)
