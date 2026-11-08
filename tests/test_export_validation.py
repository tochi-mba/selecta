"""A job may only report a verified, decodable frozen FLAC as ready."""

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from selecta import mix
from selecta.api import create_app
from selecta.config import SAMPLE_RATE, Settings
from selecta.export_validation import verify_export


def test_complete_export_is_decoded_frame_by_frame(tmp_path):
    path = tmp_path / "mix.flac"
    audio = np.zeros((2 * SAMPLE_RATE, 2), dtype=np.float32)
    sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16", format="FLAC")
    verify_export(path, 2.0)


def test_bad_or_wrong_export_cannot_be_reported_ready(tmp_path):
    path = tmp_path / "mix.flac"
    path.write_bytes(b"not a playable FLAC")
    with pytest.raises(ValueError):
        verify_export(path, 2.0)

    sf.write(path, np.zeros((SAMPLE_RATE, 1), dtype=np.float32), SAMPLE_RATE,
             subtype="PCM_16", format="FLAC")
    with pytest.raises(ValueError, match="format, length or channel"):
        verify_export(path, 1.0)

    sf.write(path, np.zeros((SAMPLE_RATE, 2), dtype=np.float32), SAMPLE_RATE,
             subtype="PCM_16", format="FLAC")
    with pytest.raises(ValueError, match="format, length or channel"):
        verify_export(path, 2.0)


def test_invalid_seam_placement_is_rejected_before_scheduling_export(tmp_path, monkeypatch):
    monkeypatch.setattr(mix, "read_mix", lambda *_args: [
        {"song_id": 1, "title": "First", "artist": "A", "duration": 240},
        {
            "song_id": 2, "title": "Second", "artist": "B", "duration": 240,
            "seam": {"state": {"status": "ready", "key": "cached"}, "settings": {},
                     "too_soon": True},
        },
    ])
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    result = client.post("/api/exports/jobs")
    assert result.status_code == 409
    assert "Adjust its timing" in result.json()["detail"]
    assert not (tmp_path / "exports" / "jobs").exists()
