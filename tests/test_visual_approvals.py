"""EX-0133-02: a capture counts as approved only when a named reviewer signed that exact image."""

import json

import pytest

from selecta.audit import visual_approvals as va


def test_inventory_covers_every_state_at_every_display_and_theme():
    names = va.inventory()
    assert len(names) % 4 == 0 and len(names) // 4 >= 16  # four displays, every state
    for display in ("320-light", "375-dark", "1280-light", "1440-dark"):
        for state in ("explore", "listen", "editor-empty", "song-details", "export-dialog"):
            assert f"candidate-{display}-{state}" in names
    assert len(set(names)) == len(names)


@pytest.fixture
def folder(tmp_path):
    out = tmp_path / "test-results" / "visual-edge"
    out.mkdir(parents=True)
    for name in va.inventory():
        (out / f"{name}.png").write_bytes(name.encode())
    return tmp_path / "test-results"


def test_nothing_is_approved_until_a_reviewer_signs(folder, tmp_path):
    result = va.check(folder, tmp_path / "approvals.json", "edge")
    assert result["approved"] == [] and len(result["unapproved"]) == len(va.inventory())


def test_a_signed_capture_is_approved_and_goes_stale_when_the_image_changes(folder, tmp_path):
    approvals = tmp_path / "approvals.json"
    assert va.approve(folder, approvals, "edge", "Named Reviewer") == len(va.inventory())
    record = json.loads(approvals.read_text(encoding="utf-8"))
    assert {entry["reviewer"] for entry in record.values()} == {"Named Reviewer"}
    assert len(va.check(folder, approvals, "edge")["approved"]) == len(va.inventory())
    changed = next(folder.rglob("candidate-320-light-listen.png"))
    changed.write_bytes(b"a different picture")
    result = va.check(folder, approvals, "edge")
    assert result["stale"] == ["edge/candidate-320-light-listen"]
    assert va.main(["check", str(folder), str(approvals)]) == 1


def test_a_capture_the_spec_should_take_but_did_not_is_missing(folder, tmp_path):
    next(folder.rglob("candidate-1440-dark-library.png")).unlink()
    result = va.check(folder, tmp_path / "approvals.json", "edge")
    assert result["missing"] == ["edge/candidate-1440-dark-library"]


def test_approving_needs_a_name_and_another_browser_is_separate(folder, tmp_path):
    approvals = tmp_path / "approvals.json"
    with pytest.raises(ValueError):
        va.approve(folder, approvals, "edge", "  ")
    va.approve(folder, approvals, "edge", "Named Reviewer")
    assert va.check(folder, approvals, "firefox")["approved"] == []
