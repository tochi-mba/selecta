"""T0001: the pre-redesign baseline is pinned and its archive is complete.

`docs/baseline/911c981/` was captured by `tests/baseline_capture.py` from the 911c981 checkout's
own running server and page. This checks it stays whole: the pinned commit, the settings, the read
answers, a screenshot of each main view at both widths, and a playback trace with real sounds.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "docs" / "baseline" / "911c981"
MANIFEST = json.loads((ARCHIVE / "manifest.json").read_text("utf-8"))
VIEWS = ["mixes", "now", "edit", "library", "words", "workshop"]


def test_the_baseline_commit_is_pinned_and_is_the_pre_redesign_main():
    assert MANIFEST["task"] == "T0001"
    assert MANIFEST["commit"] == "911c98106795e9ce0154afc8d9a53a886a8643ef"
    contracts = json.loads((ROOT / MANIFEST["contracts"]).read_text("utf-8"))
    assert contracts
    shown = subprocess.run(
        ["git", "cat-file", "-t", MANIFEST["commit"]], cwd=ROOT, capture_output=True, text=True
    )
    if shown.returncode:  # a shallow CI clone may not hold the old commit
        pytest.skip("the baseline commit is not in this clone")
    assert shown.stdout.strip() == "commit"


def test_every_archived_file_exists_and_is_not_empty():
    for name in MANIFEST["files"]:
        assert (ARCHIVE / name).stat().st_size > 0, name


def test_each_main_view_has_a_screenshot_at_desktop_and_phone_width():
    for view in VIEWS:
        for size in ("desktop", "phone"):
            name = f"screens/{view}-{size}.png"
            assert name in MANIFEST["files"]
            assert (ARCHIVE / name).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_settings_and_api_answers_came_from_the_running_older_server():
    settings = json.loads((ARCHIVE / "settings.json").read_text("utf-8"))
    assert {"settings_defaults", "steering", "storage", "browser_storage"} <= set(settings)
    assert settings["settings_defaults"]["beat_model"]
    status = json.loads((ARCHIVE / "api" / "status.json").read_text("utf-8"))
    assert status["counts"]["total"] > 0
    mix = json.loads((ARCHIVE / "api" / "mix.json").read_text("utf-8"))
    assert len(mix["mix"]) >= 2


def test_the_playback_trace_records_songs_starting_on_the_audio_clock():
    trace = json.loads((ARCHIVE / "playback-trace.json").read_text("utf-8"))
    assert trace["mix"] and trace["sounds_started"]
    assert any(entry["state"] == "running" for entry in trace["audio_context"])
    assert any(item["path"].endswith("/audio") for item in trace["audio_fetched"])
    for sound in trace["sounds_started"]:
        assert sound["length"] > 0 and sound["when"] >= 0
