import json
import sqlite3

import numpy as np
import pytest
import soundfile as sf

from selecta.config import Settings
from selecta.listening import (
    create_trials,
    prepare_comparison,
    public_trials,
    register_comparison,
    respond,
)


def test_comparison_preparation_matches_loudness_and_rejects_invalid_audio():
    sr = 8000
    wave = np.sin(np.arange(sr * 2) * 2 * np.pi * 440 / sr) * 0.5
    stereo = np.column_stack((wave, wave))
    first, second, report = prepare_comparison(stereo, stereo * 0.1, sr)
    assert np.allclose(first, second)
    assert np.max(np.abs(first)) <= 10 ** (-1 / 20)
    assert report["frames"] == sr * 2
    with pytest.raises(ValueError, match="identical duration"):
        prepare_comparison(stereo, stereo[:-1], sr)
    with pytest.raises(ValueError, match="Silent"):
        prepare_comparison(stereo, stereo * 0, sr)
    with pytest.raises(ValueError, match="out-of-range"):
        prepare_comparison(stereo, stereo * np.nan, sr)


def test_trials_hide_conditions_and_leave_unanswered_trials_unanswered():
    conn = sqlite3.connect(":memory:")
    ids = create_trials(
        conn, "held-out", [{"pair": "1-2", "conditions": ["adaptive", "baseline"]}], 42
    )
    public = public_trials(conn, "held-out")
    assert public == [{"id": ids[0], "options": ["a", "b"]}]
    assert "adaptive" not in json.dumps(public)
    assert conn.execute("SELECT COUNT(*) FROM listening_responses").fetchone()[0] == 0
    respond(conn, ids[0], "listener-1", "tie", "headphones")
    respond(conn, ids[0], "listener-1", "cannot_judge", "headphones")
    assert conn.execute("SELECT choice FROM listening_responses").fetchall() == [("cannot_judge",)]
    with pytest.raises(ValueError):
        respond(conn, ids[0], "listener-1", "adaptive", "headphones")
    with pytest.raises(ValueError):
        respond(conn, "missing", "listener-1", "a", "headphones")


def test_invalid_pairs_do_not_partially_create_a_study():
    conn = sqlite3.connect(":memory:")
    with pytest.raises(ValueError):
        create_trials(conn, "bad", [{"pair": "1-2", "conditions": ["same", "same"]}], 1)
    assert conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []


def test_import_preserves_study_audio_and_rejects_context_mismatch(tmp_path):
    sr = 8000
    wave = np.sin(np.arange(sr * 2) * 2 * np.pi * 440 / sr) * 0.4
    stereo = np.column_stack((wave, wave))
    paths = [tmp_path / "adaptive.wav", tmp_path / "baseline.wav"]
    for path in paths:
        sf.write(path, stereo, sr)
    context = {"a": 1, "b": 2, "a_at": 30, "b_at": 16}
    conditions = [{"path": str(path), "renderer": path.stem, "context": context} for path in paths]
    conn = sqlite3.connect(":memory:")
    settings = Settings(tmp_path / "data")
    ids = register_comparison(conn, settings, "heldout", "1-2", conditions)
    assert len(ids) == 1
    mapping = json.loads(conn.execute("SELECT mapping FROM listening_trials").fetchone()[0])
    for key in mapping.values():
        assert (settings.home / "listening-audio" / f"{key}.flac").exists()
    assert all(path.exists() for path in paths)
    conditions[1] = {**conditions[1], "context": {"a": 99}}
    with pytest.raises(ValueError, match="identical source cues"):
        register_comparison(conn, settings, "heldout", "1-2", conditions)
