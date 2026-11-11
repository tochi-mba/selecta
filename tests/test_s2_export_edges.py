"""T0181: a partly rendered mix and a stale download link never pass for a finished export."""

from __future__ import annotations

import time

from selecta import db, mix
from selecta.config import Settings
from selecta.routes import exports
from selecta.seams import SeamStore


def _three_songs(tmp_path):
    with db.connect(Settings(tmp_path).db_path) as conn:
        for song in (1, 2, 1):
            mix.add_song(conn, song)


def _settle(client, job_id, leave=("preparing", "encoding", "cancelling")):
    for _ in range(150):
        saved = client.get(f"/api/exports/jobs/{job_id}").json()
        if saved["state"] not in leave:
            return saved
        time.sleep(0.02)
    raise AssertionError(f"export {job_id} never settled: {saved}")


def test_a_partly_rendered_mix_waits_and_writes_no_file(client, tmp_path, monkeypatch):
    _three_songs(tmp_path)
    monkeypatch.setattr(exports, "CHECK_EVERY_SECONDS", 0.01)
    seen: set[str] = set()

    def half_ready(_store, key):
        seen.add(key)
        first = sorted(seen)[0]
        return {"status": "ready" if key == first else "rendering", "key": key}

    monkeypatch.setattr(SeamStore, "status", half_ready)
    monkeypatch.setattr(SeamStore, "submit", lambda _store, _request: None)
    written = []
    monkeypatch.setattr(
        mix, "export_snapshot", lambda *args: written.append(args) or {"seconds": 1}
    )
    job = client.post("/api/exports/jobs").json()
    time.sleep(0.2)
    shown = client.get(f"/api/exports/jobs/{job['id']}").json()
    assert shown["state"] == "preparing"
    assert written == [], "one unfinished transition holds back the whole file"
    client.delete(f"/api/exports/jobs/{job['id']}")
    assert _settle(client, job["id"])["state"] == "cancelled"
    assert written == []


def test_a_ready_file_that_has_gone_is_shown_expired_and_its_link_is_refused(
    client, tmp_path, monkeypatch
):
    _three_songs(tmp_path)
    monkeypatch.setattr(SeamStore, "status", lambda _store, key: {"status": "ready", "key": key})

    def write(_conn, _settings, _store, destination, _songs, _keys):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"fLaC")
        return {"seconds": 1}

    monkeypatch.setattr(mix, "export_snapshot", write)
    monkeypatch.setattr(exports, "verify_export", lambda _path, _seconds: None)
    job = client.post("/api/exports/jobs").json()
    ready = _settle(client, job["id"])
    assert ready["state"] == "ready"
    assert client.get(f"/api/exports/{ready['name']}").status_code == 200

    (Settings(tmp_path).home / "exports" / ready["name"]).unlink()
    assert client.get(f"/api/exports/jobs/{job['id']}").json()["state"] == "expired"
    assert client.get(f"/api/exports/{ready['name']}").status_code == 404


def test_a_download_link_cannot_reach_outside_the_exports_folder(client, tmp_path):
    (Settings(tmp_path).home / "secret.flac").write_bytes(b"fLaC")
    for name in ("..%2Fsecret.flac", "..%5Csecret.flac", "nothing-here.flac"):
        assert client.get(f"/api/exports/{name}").status_code == 404
