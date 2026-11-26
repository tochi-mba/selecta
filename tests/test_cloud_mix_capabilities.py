"""The local versus Cloud map (`cloud_mixes.capability_map`): computed from the account's flags,
and no row says or means "not yet" (the owner's rule: finish it or file it)."""

from __future__ import annotations

from pathlib import Path

import pytest

from selecta import cloud_mixes, flags

ROOT = Path(__file__).resolve().parents[1]
HOSTED = {"cloud.hosted_media": True, "cloud.hosted_render": True}


def _rows(answers: dict[str, bool]) -> dict[str, dict]:
    with flags.bound(answers):
        return {row["id"]: row for row in cloud_mixes.capability_map()}


@pytest.mark.parametrize("answers", [
    {}, HOSTED, {**HOSTED, "cloud.hosted_brain": True},
    {"cloud.brain": True, "cloud.account_mixes": True},
])
def test_no_row_says_or_means_not_yet(answers):
    for row in _rows(answers).values():
        assert row["local"] in cloud_mixes.STATES and row["cloud"] in cloud_mixes.STATES
        words = row["note"].lower()
        assert "not yet" not in words and " yet" not in words, row
        assert "—" not in row["note"] and "–" not in row["note"]


def test_every_row_names_sources_that_exist():
    for cap in cloud_mixes.CAPABILITIES:
        assert (ROOT / cap.local_source).is_file()
        assert cap.cloud_source is None or (ROOT / cap.cloud_source).is_file()


def test_rendered_transitions_follow_the_hosted_flags():
    browser = _rows({"cloud.hosted_render": False})["rendered_seams"]
    assert "in your browser" in browser["note"] and "uploading" in browser["note"]
    older = _rows({**HOSTED, "cloud.hosted_brain": False})["rendered_seams"]
    core = _rows({**HOSTED, "cloud.hosted_brain": True})["rendered_seams"]
    assert "Desktop app's way" in older["note"]
    assert "same planner as the Desktop app" in core["note"]
    assert core["cloud"] == "partial" and "without stem moves" in core["note"]


def test_the_editor_row_and_the_sign_in_row_are_decisions_said_plainly():
    rows = _rows({"cloud.account_mixes": False})
    assert rows["seam_tools"]["cloud"] == "desktop_only"
    assert rows["no_account"]["cloud"] == "needs_sign_in"
    assert "signed in" in rows["no_account"]["note"]
    mixes = _rows({"cloud.brain": True, "cloud.account_mixes": True})["seam_tools"]
    assert mixes["cloud"] == "partial" and "Choose each transition's move" in mixes["note"]
