"""T0269: each Selecta 2.0 ADR's acceptance criteria are audited against linked proof."""

from __future__ import annotations

from pathlib import Path

from selecta.audit import adr_acceptance as audit

ROOT = Path(__file__).resolve().parents[1]


def test_every_adr_has_criteria_and_tasks_and_none_is_verified_without_proof():
    audits = audit.collect(ROOT)
    assert sorted(audits) == list(range(1, 33))
    assert audit.gate(audits) == []
    # every T task on the checklist belongs to exactly one ADR's audit
    tasks = [task for adr in audits.values() for task, *_ in adr.tasks]
    assert len(tasks) == len(set(tasks)) == 279


def test_the_audit_page_covers_every_adr_and_its_criteria():
    page = (ROOT / audit.AUDIT_DOC).read_text(encoding="utf-8")
    for number, adr in audit.collect(ROOT).items():
        assert f"## [ADR-{number:04d}]({adr.file})" in page
        for line in adr.criteria:
            assert f"- {line}" in page


def test_an_adr_marked_verified_with_an_open_or_prose_only_task_is_refused():
    adr = audit.AdrAudit(5, "adr-0005-x.md", "Verified", ["Stale polls."])
    adr.tasks = [
        ("T0100", True, "Done", "`tests/test_state.py` passed"),
        ("T0101", True, "Done", "The docs say so."),
        ("T0102", False, "Partly", "later"),
    ]
    assert adr.proven == ["T0100"]
    assert not adr.may_be_verified
    audits = {
        number: audit.AdrAudit(
            number, f"adr-{number:04d}-x.md", "In", ["x"], [("T1", True, "Done", "`a/b.py`")]
        )
        for number in range(1, 33)
    }
    audits[5] = adr
    assert audit.gate(audits) == [
        "ADR-0005 is marked Verified but lacks linked proof for T0101, T0102"
    ]
    adr.tasks = adr.tasks[:1]
    assert audit.gate(audits) == []
