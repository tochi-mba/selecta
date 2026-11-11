"""T0256: the server restarting in the middle of a change, then the page retrying it. The retry gets
the first answer back instead of doing the change twice, a different change can't borrow the id,
and a guarded mix edit retried against a mix that moved on is refused rather than misapplied."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.operation_log import FinishedOperations
from selecta.seams import SeamStore


@pytest.fixture
def home(tmp_path, monkeypatch):
    settings = Settings(tmp_path / "home")
    settings.home.mkdir()
    conn = db.connect(settings.db_path)
    for song_id in range(1, 6):
        path = tmp_path / f"{song_id}.flac"
        path.write_bytes(b"x")
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song_id, str(path), "f", 1, 1.0, 200.0, "Someone", f"Song {song_id}"),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )
    conn.commit()
    conn.close()
    monkeypatch.setattr(
        SeamStore, "submit", lambda self, request, **_k: {"status": "queued", "key": request.key}
    )
    return settings, tmp_path


def _server(home):
    """A fresh server process on the same data folder, as after a restart."""
    settings, tmp_path = home
    return TestClient(create_app(settings, tmp_path / "no-web"))


def test_a_retry_after_a_restart_gets_the_first_answer(home):
    name = {"x-operation-id": "draft-5e1f0c3a-restart"}
    first = _server(home).post("/api/drafts", json={"name": "Friday"}, headers=name)
    assert first.status_code == 200
    # the page never saw that answer; the server restarts; the page sends it again
    after = _server(home)
    again = after.post("/api/drafts", json={"name": "Friday"}, headers=name)
    assert again.status_code == 200
    assert again.json() == first.json()
    assert [draft["name"] for draft in after.get("/api/drafts").json()["drafts"]] == ["Friday"]
    repeats = after.get("/api/diagnostics").json()["recent_operations"]
    assert {
        "kind": "draft",
        "status": 200,
        "repeat": True,
        "operation": name["x-operation-id"],
    } in (repeats)


def test_after_a_restart_a_different_change_still_cannot_borrow_the_id(home):
    name = {"x-operation-id": "draft-borrowed-id"}
    _server(home).post("/api/drafts", json={"name": "Friday"}, headers=name).raise_for_status()
    other = _server(home).post("/api/drafts", json={"name": "Saturday"}, headers=name)
    assert other.status_code == 409
    assert "different action" in other.json()["detail"]


def test_a_guarded_mix_edit_retried_after_a_restart_is_not_applied_twice(home):
    server = _server(home)
    for song in (1, 2):
        server.post("/api/mix/songs", json={"song_id": song}).raise_for_status()
    order = ",".join(str(item["song_id"]) for item in server.get("/api/mix").json()["mix"])
    guarded = {"x-operation-id": "add-guarded-restart", "x-mix-order": order}
    first = server.post("/api/mix/songs", json={"song_id": 3}, headers=guarded)
    assert first.status_code == 200
    after = _server(home)
    again = after.post("/api/mix/songs", json={"song_id": 3}, headers=guarded)
    assert again.status_code == 200
    assert again.json() == first.json()
    assert [item["song_id"] for item in after.get("/api/mix").json()["mix"]].count(3) == 1


def test_only_the_newest_answers_are_kept_on_disk(tmp_path):
    kept = FinishedOperations(tmp_path / "operations", keep=30)
    for number in range(60):
        kept.remember(f"draft-{number}", (200, b"{}", "print"))
    assert len(list((tmp_path / "operations").glob("*.json"))) <= 35
    fresh = FinishedOperations(tmp_path / "operations", keep=30)
    assert fresh.get("draft-59") == (200, b"{}", "print")
    assert fresh.get("draft-0") is None
    assert "draft-59" in fresh and "never-sent" not in fresh
