"""The account data export (SC-0412-04): originals, mixes and settings JSON in one ZIP."""

from __future__ import annotations

import io
import json
import zipfile

from cloud_world import HEADERS, add_asset, signed_up

from selecta.persistence import db_now, new_id, transaction
from selecta.playback.schema import devices, playback_sessions

SONG = b"an original, byte for byte" * 40


def _archive(world) -> zipfile.ZipFile:
    answer = world.client.get("/api/account/export", headers=HEADERS)
    assert answer.status_code == 200, answer.text
    assert answer.headers["content-type"] == "application/zip"
    assert "selectadj-account-export.zip" in answer.headers["content-disposition"]
    return zipfile.ZipFile(io.BytesIO(answer.content))


def test_the_export_holds_originals_byte_for_byte_with_a_manifest(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, SONG, name="a.wav")
        with _archive(world) as archive:
            names = archive.namelist()
            assert f"originals/{asset_id}-a.wav" in names
            assert archive.read(f"originals/{asset_id}-a.wav") == SONG
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["asset_count"] == 1
            assert {"settings.json", "assets.json", "mixes.json"} <= set(names)
            [listed] = json.loads(archive.read("assets.json"))
            assert (listed["id"], listed["size"]) == (asset_id, len(SONG))


def test_the_settings_json_carries_plan_lucy_choices_and_devices(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch, timezone="Europe/London") as world:
        saved = world.client.put(
            "/api/account/lucy",
            headers=HEADERS,
            json={"enabled": False, "phases": {"voice": True}, "privacy": {"share_lyrics": True}},
        )
        assert saved.status_code == 200, saved.text
        with transaction(world.engine, world.workspace_id) as conn:
            now = db_now(conn)
            conn.execute(
                devices.insert().values(
                    id=new_id(),
                    workspace_id=world.workspace_id,
                    user_id=world.user_id,
                    name="Kitchen laptop",
                    kind="laptop",
                    capabilities={},
                    created_at=now,
                    last_seen_at=now,
                )
            )
        with _archive(world) as archive:
            settings = json.loads(archive.read("settings.json"))
        assert settings["account"]["timezone"] == "Europe/London"
        assert settings["plan"]["id"] == "free"
        assert settings["lucy"]["enabled"] is False
        assert settings["lucy"]["phases"]["voice"] is True
        assert settings["lucy"]["privacy"] == {"share_lyrics": True, "share_history": False}
        assert [device["name"] for device in settings["devices"]] == ["Kitchen laptop"]
        # Lucy's choices are in their own section, not mixed into the feature opt-outs.
        assert not [
            row for row in settings["feature_preferences"] if row["flag_id"].startswith("lucy:")
        ]


def test_the_mixes_json_says_what_cloud_keeps_and_includes_the_playback_session(
    tmp_path, monkeypatch
):
    with signed_up(tmp_path, monkeypatch) as world:
        with _archive(world) as archive:
            empty = json.loads(archive.read("mixes.json"))
        assert empty["available"] is False
        assert empty["mixes"] == []
        assert empty["playback_session"] is None

        revision = new_id()
        with transaction(world.engine, world.workspace_id) as conn:
            conn.execute(
                playback_sessions.insert().values(
                    workspace_id=world.workspace_id,
                    mix_revision_id=revision,
                    song_index=3,
                    offset_ms=42_000,
                    state="paused",
                    seq=7,
                    updated_at=db_now(conn),
                )
            )
        with _archive(world) as archive:
            mixes = json.loads(archive.read("mixes.json"))
            manifest = json.loads(archive.read("manifest.json"))
        session = mixes["playback_session"]
        assert (session["mix_revision_id"], session["song_index"], session["offset_ms"]) == (
            revision,
            3,
            42_000,
        )
        assert manifest["mixes"]["playback_session"] == "included in mixes.json"
