"""GP-0263: Workspace diagnostics report measured local faults (environment, scan, worker,
export) as booleans and counts only, so a person sees a verified cause and nothing private."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from selecta import db, self_service
from selecta.api import create_app
from selecta.config import Settings
from selecta.routes.exports import NO_ROOM


@pytest.fixture
def made(tmp_path):
    settings = Settings(tmp_path / "home")
    return TestClient(create_app(settings, tmp_path / "no-web")), settings


def _job(home, name, state, error=None):
    folder = home / "exports" / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.json").write_text(json.dumps({"id": name, "state": state, "error": error}))


def test_a_missing_ffmpeg_is_reported_as_missing_and_a_present_one_as_present(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(self_service.shutil, "which", lambda name: None)
    assert self_service.local_checks(tmp_path)["ffmpeg"] is False
    monkeypatch.setattr(self_service.shutil, "which", lambda name: "C:/tools/ffmpeg.exe")
    checks = self_service.local_checks(tmp_path)
    assert checks["ffmpeg"] is True
    assert checks["data_writable"] is True
    assert set(checks) == {"ffmpeg", "data_writable", "disk_low"}


def test_a_data_folder_that_is_not_there_is_not_writable(tmp_path):
    assert self_service.local_checks(tmp_path / "gone")["data_writable"] is False


def test_low_disk_is_measured_not_assumed(tmp_path, monkeypatch):
    class Usage:
        free = 10

    monkeypatch.setattr(self_service.shutil, "disk_usage", lambda path: Usage)
    assert self_service.local_checks(tmp_path)["disk_low"] is True
    monkeypatch.setattr(
        self_service.shutil, "disk_usage", lambda path: (_ for _ in ()).throw(OSError())
    )
    assert self_service.local_checks(tmp_path)["disk_low"] is False


def test_export_outcomes_tell_a_known_full_drive_from_an_unknown_failure(tmp_path):
    _job(tmp_path, "a" * 32, "failed", NO_ROOM)
    _job(tmp_path, "b" * 32, "failed", "The file couldn't be written. Check there's free space")
    _job(tmp_path, "c" * 32, "interrupted")
    _job(tmp_path, "d" * 32, "ready")
    (tmp_path / "exports" / "jobs" / "broken.json").write_text("{not json")
    assert self_service.export_outcomes(tmp_path) == {
        "failed": 1,
        "failed_no_room": 1,
        "interrupted": 1,
    }
    assert self_service.export_outcomes(tmp_path / "nothing") == {
        "failed": 0,
        "failed_no_room": 0,
        "interrupted": 0,
    }


def test_diagnostics_carry_the_checks_as_booleans_and_counts_with_nothing_private(
    made, monkeypatch
):
    client, settings = made
    monkeypatch.setattr(self_service.shutil, "which", lambda name: None)
    with db.connect(settings.db_path) as conn:
        db.set_preference(conn, "library_folders", ["Z:/Private Music Folder"])
        conn.commit()
    _job(settings.home, "e" * 32, "failed", NO_ROOM)
    response = client.get("/api/diagnostics")
    info = response.json()
    assert info["checks"]["ffmpeg"] is False
    assert info["checks"]["data_writable"] is True
    assert info["exports"]["failed_no_room"] == 1
    assert info["folders_missing"] == 1
    assert info["scan_failed"] is False
    assert info["storage_full"] in (True, False)
    for private in ("Private", "Z:", str(settings.home), "free space"):
        assert private not in response.text
