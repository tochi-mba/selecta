"""CI-0184-03: the creative-interface coverage matrix maps every CI task to its tests and gaps."""

from __future__ import annotations

from selecta.audit import ci_coverage


def test_the_matrix_file_is_current():
    written = ci_coverage.MATRIX.read_text(encoding="utf-8")
    assert written == ci_coverage.markdown(), (
        "run: .venv\\Scripts\\python -m selecta.audit.ci_coverage --write"
    )


def test_every_ci_task_has_one_row_and_every_cited_test_file_exists():
    rows = ci_coverage.rows()
    tasks = [row["task"] for row in rows]
    assert len(tasks) == 140 and len(set(tasks)) == 140
    for row in rows:
        for name in [*row["state"], *row["browser"]]:
            assert (ci_coverage.ROOT / name).is_file(), f"{row['task']}: {name} is missing"


def test_every_ticked_task_cites_at_least_one_test():
    for row in ci_coverage.rows():
        if row["status"] == "ticked":
            assert row["state"] or row["browser"], f"{row['task']} is ticked with no test"


def test_gaps_are_named_not_hidden():
    sample = (
        "- [x] **CI-9999-01 - Example.** **Implementation:** Implemented; **Evidence:** "
        "web/src/views/A.test.tsx 'shows the pair'.\n"
        "- [x] **CI-9999-02 - Other.** **Implementation:** Implemented; **Evidence:** "
        "web/src/views/B.test.tsx 'never plays on its own'; web/e2e/b.e2e.ts.\n"
        "- [ ] **CI-9999-03 - Third.** **Implementation:** Needs a person: a study; "
        "**Evidence:** -.\n"
    )
    one, two, three = ci_coverage.rows(sample)
    assert one["gaps"] == ["browser", "negative"]
    assert two["gaps"] == [] and two["negative"] == ["never plays on its own"]
    assert three["status"] == "person" and three["gaps"] == []
