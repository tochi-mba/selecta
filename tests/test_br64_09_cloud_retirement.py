"""BR64-09: synthetic Cloud no-media and billing/privacy regression gates."""
from __future__ import annotations

import base64
import io
import json
import zipfile

import pytest

from cloud_world import HEADERS, add_asset, signed_up
from selecta.billing.plans import local_first_plans
from selecta.billing.stripe_sync import parse_price_map
from selecta.lf_egress import (
    AdmissionDenied, PayloadRejected, Phase, admit_cloud_metadata,
    current_phase, require_media_write, require_proxy_job,
    require_upload_action, safe_audit_fields,
)
from selecta.persistence import db_now, new_id, transaction
from selecta.usage.allowances import limit_for
from selecta.work.schema import artifacts


def _zip(response):
    assert response.status_code == 200, response.text
    assert response.headers["x-selecta-export-mode"] == "metadata"
    return zipfile.ZipFile(io.BytesIO(response.content))


def test_default_export_is_metadata_only_and_legacy_query_is_gone(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch, timezone="Europe/London") as world:
        raw = b"RIFF" + b"\x00" * 180 + b"WAVE secret fixture"
        asset_id = add_asset(
            world.engine, world.objects, world.workspace_id, raw,
            name="C:\\private\\my-music\\song.wav",
        )
        with _zip(world.client.get("/api/account/export", headers=HEADERS)) as archive:
            names = archive.namelist()
            assert not any(name.startswith("originals/") for name in names)
            assert set(names) == {
                "manifest.json", "settings.json", "assets.json",
                "mixes.json", "billing.json",
            }
            assert raw not in b"".join(archive.read(name) for name in names)
            manifest = json.loads(archive.read("manifest.json"))
            settings = json.loads(archive.read("settings.json"))
            [listed] = json.loads(archive.read("assets.json"))
            assert manifest["mode"] == "metadata_only"
            assert settings["account"]["timezone"] == "Europe/London"
            assert listed["legacy_asset_id"] == asset_id
            assert listed["local_original_included"] is False
            assert "sha256" not in listed and "original_key" not in listed
        denied = world.client.get("/api/account/export?mode=legacy", headers=HEADERS)
        assert denied.status_code == 410
        assert denied.json()["detail"]["code"] == "cloud_audio_export_retired"


def test_recipe_provenance_cannot_replace_settings_or_export_paths(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch, timezone="Europe/London") as world:
        with transaction(world.engine, world.workspace_id) as conn:
            now = db_now(conn)
            conn.execute(artifacts.insert().values(
                id=new_id(), workspace_id=world.workspace_id,
                kind="mix_revision", input_hash="recipe-revision-1",
                keys=[], checksum="metadata", size_bytes=0,
                provenance={"settings": {"contract": {
                    "revision": "recipe-revision-1", "recipe_id": "mix-one",
                    "occurrences": [{
                        "recording_ref": "safe-device-ref",
                        "file_path": "/home/user/private.wav",
                    }],
                    "raw_audio": base64.b64encode(b"RIFF" + b"x" * 90).decode(),
                    "raw_fingerprint": "f" * 64,
                }}},
                protected=True, created_at=now, last_used_at=now,
            ))
        with _zip(world.client.get("/api/account/export", headers=HEADERS)) as archive:
            settings = json.loads(archive.read("settings.json"))
            mixes = json.loads(archive.read("mixes.json"))
            assert settings["account"]["timezone"] == "Europe/London"
            assert settings["plan"]["id"] == "free"
            [revision] = mixes["mixes"]
            assert revision["contract"]["recipe_id"] == "mix-one"
            assert revision["contract"]["occurrences"] == [
                {"recording_ref": "safe-device-ref"}
            ]
            packed = archive.read("mixes.json").decode()
            assert "/home/" not in packed and "raw_audio" not in packed
            assert "raw_fingerprint" not in packed


def test_stale_upload_and_cloud_playback_proxy_routes_are_gone(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        plan = world.client.post("/api/uploads/plan", headers=HEADERS, json={
            "files": [{"name": "old.wav", "size": 64, "content_type": "audio/wav"}],
        })
        assert plan.status_code == 410
        song = add_asset(world.engine, world.objects, world.workspace_id, b"x" * 256)
        for method in (world.client.get, world.client.post):
            result = method(f"/api/assets/{song}/playback-proxy", headers=HEADERS)
            assert result.status_code == 410
            assert result.json()["detail"]["code"] == "cloud_audio_processing_retired"
        listing = world.client.get("/api/assets", headers=HEADERS)
        assert listing.status_code == 200
        [item] = listing.json()["assets"]
        assert "sha256" not in item


def test_cloud_mode_never_reopens_audio_even_with_valid_rollback_flags(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    monkeypatch.setenv("SELECTA_ENV", "development")
    monkeypatch.setenv("SELECTA_LF_AUDIO_ROLLOUT_PHASE", "legacy")
    monkeypatch.setenv("SELECTA_LF_AUDIO_EXCEPTION_APPROVED", "yes")
    assert current_phase() is Phase.SEALED
    for gate, args in (
        (require_upload_action, ("plan",)),
        (require_media_write, ("accept",)),
        (require_proxy_job, ()),
    ):
        with pytest.raises(AdmissionDenied):
            gate(*args)


@pytest.mark.parametrize("kind,body", [
    ("recipe", lambda: {"title": base64.b64encode(
        b"RIFF" + b"\x00" * 120 + b"WAVE").decode()}),
    ("recipe", lambda: {"occurrences": [{"raw_audio": "bad"}]}),
    ("diagnostic", lambda: {"reason_code": "error /home/user/music.flac"}),
    ("ai_plan", lambda: {"steps": [{"payload": [1, 2, 3]}]}),
])
def test_encoded_media_and_tool_payloads_fail_closed(kind, body):
    message = {
        "schema_version": 1, "kind": kind,
        "workspace_id": "workspace-a", "data": body(),
    }
    with pytest.raises(PayloadRejected) as error:
        admit_cloud_metadata(
            json.dumps(message).encode(), content_type="application/json",
            workspace_id="workspace-a", kind=kind,
        )
    safe = safe_audit_fields(error.value.code, kind)
    assert "RIFF" not in str(safe) and "/home/" not in str(safe)


def test_request_admission_rejects_non_json_and_cross_tenant():
    good = {
        "schema_version": 1, "kind": "recipe", "workspace_id": "workspace-a",
        "data": {"recipe_id": "r1"},
    }
    raw = json.dumps(good).encode()
    with pytest.raises(PayloadRejected):
        admit_cloud_metadata(raw, content_type="audio/wav", workspace_id="workspace-a", kind="recipe")
    with pytest.raises(PayloadRejected):
        admit_cloud_metadata(raw, content_type="application/json", workspace_id="workspace-b", kind="recipe")
    assert admit_cloud_metadata(
        raw, content_type="application/json; charset=UTF-8",
        workspace_id="workspace-a", kind="recipe",
    ) == good


def test_future_plans_do_not_meter_local_work_and_legacy_prices_remain_parseable():
    for plan in local_first_plans():
        for kind in ("analysis_song", "speculative_cpu_seconds", "stem_preview_window", "export"):
            assert limit_for(plan, kind) is None
        assert plan.storage_bytes == 0
        assert "cloud.uploads" not in plan.flags
    old = parse_price_map({
        "price_historical": {"plan": "standard", "version": 1, "interval": "month"},
        "price_future": {"plan": "standard", "version": 2, "interval": "month"},
    })
    assert old["price_historical"].plan_version == 1
    assert old["price_future"].plan_version == 2


def test_old_signed_url_routes_are_retired_even_when_retrieval_requested(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_LF_LEGACY_RETRIEVAL", "enabled")
    with signed_up(tmp_path, monkeypatch) as world:
        song = add_asset(world.engine, world.objects, world.workspace_id, b"synthetic")
        old = world.client.get(
            f"/api/assets/{song}/playback-url?download=true", headers=HEADERS
        )
        assert old.status_code == 410
        assert old.json()["detail"]["code"] == "cloud_audio_retrieval_retired"
        derived = world.client.post("/api/storage/derived-playback-url",
            headers=HEADERS, json={"key": "some/derived/key", "ttl": 300})
        assert derived.status_code == 410
        assert derived.json()["detail"]["code"] == "cloud_audio_retrieval_retired"


def test_deleting_cloud_record_never_touches_a_device_owned_file(tmp_path, monkeypatch):
    local_recording = tmp_path / "device-only.flac"
    local_recording.write_bytes(b"device-owned-synthetic-sound")
    with signed_up(tmp_path, monkeypatch) as world:
        song = add_asset(world.engine, world.objects, world.workspace_id, b"historical")
        deletion = world.client.delete(f"/api/assets/{song}", headers=HEADERS)
        assert deletion.status_code == 200
    assert local_recording.read_bytes() == b"device-owned-synthetic-sound"
