"""Evidence checker behavior: historical table, inline proof and MI source mapping."""

import json
from pathlib import Path

from selecta.audit.checklist_evidence import validate


def write(root: Path, path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def test_empty_repository_fails_closed(tmp_path: Path) -> None:
    assert validate(tmp_path) == ["No implementation checklists found in docs/adr"]


def test_unchecked_items_do_not_require_evidence(tmp_path: Path) -> None:
    write(
        tmp_path,
        "docs/adr/implementation-checklist.md",
        "- [ ] T0001 - A human verification step.\n",
    )
    assert validate(tmp_path) == []


def test_historical_checks_require_a_done_evidence_row(tmp_path: Path) -> None:
    write(tmp_path, "docs/adr/implementation-checklist.md", "- [x] T0002 - Existing feature.\n")
    assert "needs a Done row" in validate(tmp_path)[0]

    write(
        tmp_path,
        "docs/adr/implementation-evidence.md",
        "| T0002 Existing feature | Partly | `web/src/App.tsx` |\n",
    )
    assert "needs a Done row" in validate(tmp_path)[0]

    write(
        tmp_path,
        "docs/adr/implementation-evidence.md",
        "| T0002 Existing feature | Done | - |\n",
    )
    assert "needs a Done row" in validate(tmp_path)[0]

    write(
        tmp_path,
        "docs/adr/implementation-evidence.md",
        "| T0002 Existing feature | Done | `web/src/App.tsx` verifies it. |\n",
    )
    assert validate(tmp_path) == []


def test_inline_evidence_is_required_for_new_checked_items(tmp_path: Path) -> None:
    path = "docs/adr/polish-implementation-checklist.md"
    write(tmp_path, path, "- [x] P0001 - Change implemented.\n")
    assert "without cited implementation evidence" in validate(tmp_path)[0]

    write(tmp_path, path, "- [x] P0001 - Change. **Evidence: -; owner: Unassigned.**\n")
    assert "without cited implementation evidence" in validate(tmp_path)[0]

    write(
        tmp_path,
        path,
        "- [x] P0001 - Change. **Evidence: `web/src/App.tsx`; owner: Unassigned.**\n",
    )
    assert validate(tmp_path) == []


def setup_mi(root: Path, implemented: list[str] | None = None) -> None:
    write(
        root,
        "docs/adr/selecta-microinteraction-code-status.json",
        json.dumps(
            {
                "groups": {
                    "0135": {
                        "implemented": implemented if implemented is not None else ["01"],
                        "source": ["web/src/App.tsx"],
                        "tests": ["web/src/App.test.tsx"],
                    }
                }
            }
        ),
    )
    write(root, "web/src/App.tsx", "export const app = true;\n")
    write(root, "web/src/App.test.tsx", "// test fixture\n")


def test_mi_checks_must_match_source_ledger_and_existing_files(tmp_path: Path) -> None:
    path = "docs/adr/selecta-microinteraction-implementation-checklist.md"
    write(
        tmp_path,
        path,
        "- [x] **MI-0135-01 - Built.** **Evidence: `web/src/App.tsx`; owner: X.**\n",
    )
    setup_mi(tmp_path)
    assert validate(tmp_path) == []

    setup_mi(tmp_path, [])
    assert "not implemented in the MI code-status ledger" in validate(tmp_path)[0]

    setup_mi(tmp_path)
    (tmp_path / "web/src/App.test.tsx").unlink()
    assert "references missing tests file" in validate(tmp_path)[0]


def test_checked_duplicate_and_unidentifiable_task_are_errors(tmp_path: Path) -> None:
    line = "- [x] P0001 - Built. **Evidence: `web/src/App.tsx`.**\n"
    write(tmp_path, "docs/adr/polish-implementation-checklist.md", line)
    write(
        tmp_path,
        "docs/adr/selecta-flow-implementation-checklist.md",
        line + "- [x] Does not have a stable task identifier.\n",
    )
    errors = validate(tmp_path)
    assert any("duplicate checked task P0001" in error for error in errors)
    assert any("no recognizable task ID" in error for error in errors)
