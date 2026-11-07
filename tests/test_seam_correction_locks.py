"""A correction waits out Windows readers without hiding persistent deletion failures."""

import json
from pathlib import Path

import pytest

from selecta import seams
from selecta.config import Settings
from selecta.seams import SeamStore


def test_correction_retries_busy_transition_files(client, tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    history = tmp_path / "seam-history"
    history.mkdir()
    for key, pair in (("affected", (1, 2)), ("unrelated", (3, 4))):
        folder = store.folder(key)
        folder.mkdir(parents=True)
        state = json.dumps(
            {"key": key, "status": "ready", "request": {"a": pair[0], "b": pair[1]}}
        )
        (folder / "seam.json").write_text(state, "utf-8")
        (folder / "clip.flac").write_bytes(b"audio")
        (history / f"{key}.json").write_text(state, "utf-8")

    busy = {
        store.folder("affected") / "seam.json",
        store.folder("affected") / "clip.flac",
        history / "affected.json",
    }
    refused = set()
    unlink = Path.unlink

    def busy_once(path, *args, **kwargs):
        if path in busy and path not in refused:
            refused.add(path)
            raise PermissionError(13, "File is being read", str(path))
        return unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", busy_once)
    response = client.post("/api/songs/1/correct", json={"camelot": "2B"})
    assert response.status_code == 200, response.text
    assert response.json()["redone"] == 1
    assert refused == busy
    assert all(not path.exists() for path in busy)
    assert (store.folder("unrelated") / "seam.json").exists()
    assert (store.folder("unrelated") / "clip.flac").exists()
    assert (history / "unrelated.json").exists()


def test_persistently_locked_transition_reports_failure(tmp_path, monkeypatch):
    calls = []

    def locked(path, **kwargs):
        calls.append(path)
        raise PermissionError(13, "Access denied", str(path))

    monkeypatch.setattr(Path, "unlink", locked)
    monkeypatch.setattr(seams.time, "sleep", lambda _seconds: None)
    with pytest.raises(PermissionError):
        seams._unlink_after_readers(tmp_path / "seam.json")
    assert len(calls) == 50
