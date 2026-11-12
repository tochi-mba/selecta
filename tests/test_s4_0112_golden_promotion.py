"""S4-0112-06: golden screenshots exist only when a named person promotes a captured candidate."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from selecta.audit import golden_promote
from selecta.audit.golden_promote import Refused, promote

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "web" / "e2e" / "s4-0112-golden.e2e.ts"
SHA = "0123456789abcdef0123456789abcdef01234567"


def _candidates(folder: Path, status: str = "candidate-not-independently-verified") -> Path:
    folder.mkdir()
    (folder / "candidate-s4-0112-library-1280-dark.png").write_bytes(b"\x89PNG fake")
    manifest = {
        "status": status,
        "commit": SHA,
        "browser": "Edge 142",
        "fixture": "made-up library",
        "captures": [
            {
                "name": "library-1280-dark",
                "file": "candidate-s4-0112-library-1280-dark.png",
                "theme": "dark",
                "width": 1280,
                "height": 900,
            }
        ],
    }
    (folder / "s4-0112-manifest-1280-dark.json").write_text(json.dumps(manifest), "utf-8")
    return folder


def test_a_named_review_copies_the_candidate_and_records_who_when_where_and_which_commit(
    tmp_path: Path,
) -> None:
    folder = _candidates(tmp_path / "out")
    goldens = tmp_path / "goldens"
    added = promote(
        folder,
        ["library-1280-dark"],
        "Ada Lovelace",
        "Surface Laptop, Windows 11",
        SHA[:7],
        goldens=goldens,
        today=dt.date(2026, 11, 12),
    )
    assert (goldens / "library-1280-dark.png").read_bytes() == b"\x89PNG fake"
    register = json.loads((goldens / "approved.json").read_text("utf-8"))
    assert register["approvals"] == added
    assert added[0] | {} == {
        **added[0],
        "reviewer": "Ada Lovelace",
        "date": "2026-11-12",
        "sha": SHA,
        "viewport": "1280x900",
    }


@pytest.mark.parametrize(
    ("names", "reviewer", "device", "sha", "words"),
    [
        ([], "Ada Lovelace", "laptop", SHA, "at least one"),
        (["library-1280-dark"], "claude", "laptop", SHA, "full name"),
        (["library-1280-dark"], "Ada Lovelace", " ", SHA, "device"),
        (["library-1280-dark"], "Ada Lovelace", "laptop", "HEAD", "exact commit"),
        (["library-1280-dark"], "Ada Lovelace", "laptop", "fedcba9", "captured at"),
        (["editor-375-light"], "Ada Lovelace", "laptop", SHA, "no candidate"),
    ],
)
def test_promotion_refuses_anything_unattributed_or_mismatched(
    tmp_path: Path, names: list[str], reviewer: str, device: str, sha: str, words: str
) -> None:
    folder = _candidates(tmp_path / "out")
    with pytest.raises(Refused, match=words):
        promote(folder, names, reviewer, device, sha, goldens=tmp_path / "goldens")
    assert not (tmp_path / "goldens").exists()


def test_a_manifest_that_is_not_a_candidate_cannot_be_promoted(tmp_path: Path) -> None:
    folder = _candidates(tmp_path / "out", status="something-else")
    with pytest.raises(Refused, match="candidate manifest"):
        promote(folder, ["library-1280-dark"], "Ada Lovelace", "laptop", SHA, goldens=tmp_path)


def test_the_spec_only_reads_the_goldens_and_none_is_approved_yet() -> None:
    spec = SPEC.read_text(encoding="utf-8")
    assert "toHaveScreenshot(" not in spec and "toMatchSnapshot(" not in spec
    # every write goes to the test's own output folder
    writes = [line for line in spec.splitlines() if "writeFileSync(" in line]
    assert writes and all(
        "info.outputPath(" in line or "writeFileSync(manifest" in line for line in writes
    )
    assert "GOLDENS" not in "".join(writes)
    register = json.loads((golden_promote.GOLDENS / "approved.json").read_text("utf-8"))
    for entry in register["approvals"]:
        assert len(entry["reviewer"].split()) >= 2 and entry["device"] and entry["date"]
        assert golden_promote.SHA.fullmatch(entry["sha"])
        assert (golden_promote.GOLDENS / entry["file"]).is_file()
