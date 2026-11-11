"""T0278: every Selecta 2.0 checklist item has a linked implementing PR and concrete evidence."""

from __future__ import annotations

from pathlib import Path

from selecta.audit import t_task_evidence as audit

ROOT = Path(__file__).resolve().parents[1]


def _repo(tmp_path: Path, checklist: str, ledger: str) -> Path:
    (tmp_path / "docs/adr").mkdir(parents=True)
    (tmp_path / "docs/adr/adr-0001-x.md").write_text("# ADR-0001\n", encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests/test_real.py").write_text("", encoding="utf-8")
    (tmp_path / audit.CHECKLIST).write_text(checklist, encoding="utf-8")
    (tmp_path / audit.LEDGER).write_text(ledger, encoding="utf-8")
    return tmp_path


HEADER = f"# Ledger\n\nEach task in [#22]({audit.IMPLEMENTING_PR}).\n\n## Phase\n\n"
SECTION = "### Thing - [ADR-0001](https://example/docs/adr/adr-0001-x.md)\r\n\r\n"


def test_the_real_checklist_and_ledger_agree_and_only_known_gaps_remain():
    found = audit.audit(ROOT)
    assert found.errors == []
    assert found.prose_only <= audit.PROSE_ONLY


def test_a_tick_without_a_done_row_and_a_done_row_without_a_tick_are_both_refused(tmp_path):
    root = _repo(
        tmp_path,
        SECTION + "- [x] T0001 - One.\r\n- [ ] T0002 - Two.\r\n",
        HEADER + "| T0001 One | Partly | `tests/test_real.py` |\n"
        "| T0002 Two | Done | `tests/test_real.py` |\n",
    )
    errors = audit.audit(root).errors
    assert "T0001 is ticked but its ledger status is Partly" in errors
    assert "T0002 is unticked but its ledger status is Done" in errors


def test_missing_rows_missing_files_and_prose_only_evidence_are_reported(tmp_path):
    root = _repo(
        tmp_path,
        SECTION + "- [x] T0001 - One.\r\n- [x] T0002 - Two.\r\n- [ ] T0003 - Three.\r\n",
        HEADER + "| T0001 One | Done | `tests/test_gone.py` passed |\n"
        "| T0002 Two | Done | The docs say it works. |\n",
    )
    found = audit.audit(root)
    assert "T0003 has no row in docs/adr/implementation-evidence.md" in found.errors
    assert "T0001 cites tests/test_gone.py, which does not exist" in found.errors
    assert found.prose_only == {"T0002"}
    assert any(error.startswith("T0002 is Done with prose-only evidence") for error in found.errors)


def test_the_ledger_must_name_the_implementing_pr_and_sections_their_adr(tmp_path):
    root = _repo(
        tmp_path,
        "### Thing - [ADR-0009](https://example/docs/adr/adr-0009-gone.md)\n- [ ] T0001 - One.\n",
        "# Ledger\n\n## Phase\n\n| T0001 One | Partly | later |\n",
    )
    errors = audit.audit(root).errors
    assert any("does not name the implementing PR" in error for error in errors)
    assert any("section links no existing ADR file" in error for error in errors)
