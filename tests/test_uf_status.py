"""UF-0389-07: the UF checklist, ADR files, evidence ledger and status JSON move together."""

import json
from pathlib import Path

from selecta.audit.uf_status import validate

ROOT = Path(__file__).resolve().parents[1]
TAIL = (
    "**Implementation:** {impl}; **Independently Verified:** {verified}; "
    "**Owner:** Unassigned; **Evidence/reviewer:** -."
)


def build(
    tmp_path: Path,
    impl: str = "Implemented",
    box: str = "x",
    adr_impl: str | None = None,
    ledger_impl: str | None = None,
    json_impl: str | None = None,
    evidence: bool = True,
    verified: bool = False,
    reviewer: str | None = None,
) -> Path:
    adr = tmp_path / "docs/adr"
    adr.mkdir(parents=True)
    proof = "**Evidence:** tests/test_x.py (2026-11-10); " if evidence else ""
    yes = "Yes" if verified else "No"
    (adr / "selecta-unified-finish-implementation-checklist.md").write_text(
        f"- [{box}] **UF-0389-07 - Keep provenance.** {proof}"
        + TAIL.format(impl=impl, verified=yes)
        + "\n",
        encoding="utf-8",
    )
    (adr / "adr-0389-gates.md").write_text(
        "7. **UF-0389-07 - Keep provenance.** "
        + TAIL.format(impl=adr_impl or impl, verified=yes)
        + "\n",
        encoding="utf-8",
    )
    (adr / "selecta-unified-finish-implementation-evidence.md").write_text(
        f"| UF-0389-07 | ADR-0389 | Accepted | {ledger_impl or impl} | {yes} | "
        "Unassigned | - | - | - |\n",
        encoding="utf-8",
    )
    task = {
        "id": "UF-0389-07",
        "implementation": json_impl or impl,
        "independently_verified": verified,
        "reviewer": reviewer,
        "review_date": "2026-11-10" if reviewer else None,
    }
    summary = {"Not_started": 0, "In_progress": 0, "Implemented": 0}
    summary[(json_impl or impl).replace(" ", "_")] = 1
    (adr / "selecta-unified-finish-code-status.json").write_text(
        json.dumps({"implementation_summary": summary, "adrs": [{"number": 389, "tasks": [task]}]}),
        encoding="utf-8",
    )
    return tmp_path


def test_the_repository_records_agree() -> None:
    assert validate(ROOT) == []


def test_matching_records_pass(tmp_path: Path) -> None:
    assert validate(build(tmp_path)) == []


def test_missing_records_fail_closed(tmp_path: Path) -> None:
    assert len(validate(tmp_path)) == 3


def test_an_adr_that_moved_alone_is_caught(tmp_path: Path) -> None:
    errors = validate(build(tmp_path, adr_impl="In progress"))
    assert any("implementation differs" in error and "ADR=In progress" in error for error in errors)


def test_a_ledger_or_json_that_lags_is_caught(tmp_path: Path) -> None:
    assert any(
        "ledger=Not started" in e
        for e in validate(build(tmp_path / "a", ledger_impl="Not started"))
    )
    assert any(
        "JSON=In progress" in e for e in validate(build(tmp_path / "b", json_impl="In progress"))
    )


def test_a_tick_needs_implemented_and_evidence(tmp_path: Path) -> None:
    errors = validate(build(tmp_path / "a", impl="In progress"))
    assert any("ticked in the checklist but implementation is In progress" in e for e in errors)
    errors = validate(build(tmp_path / "b", evidence=False))
    assert any("without an Evidence field" in e for e in errors)
    assert validate(build(tmp_path / "c", impl="In progress", box=" ", evidence=False)) == []


def test_independent_verification_needs_a_named_reviewer(tmp_path: Path) -> None:
    errors = validate(build(tmp_path / "a", verified=True))
    assert any("without a named reviewer" in e for e in errors)
    assert validate(build(tmp_path / "b", verified=True, reviewer="A. Reviewer")) == []


def test_a_wrong_summary_count_is_caught(tmp_path: Path) -> None:
    root = build(tmp_path)
    path = root / "docs/adr/selecta-unified-finish-code-status.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["implementation_summary"]["Implemented"] = 5
    path.write_text(json.dumps(data), encoding="utf-8")
    assert any("implementation_summary" in e for e in validate(root))
