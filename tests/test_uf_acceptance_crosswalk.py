"""UF-0388-02, UF-0388-03 and UF-0389-06: every automated test the crosswalk cites still exists.

The crosswalk (docs/adr/completion/uf-acceptance-crosswalk.md) maps APG patterns, WCAG 2.2 AA
criteria and the functional-preservation invariants to the test covering their code half. If a
test is renamed or deleted the row would silently lie, so each cited name is looked up here.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = (ROOT / "docs/adr/completion/uf-acceptance-crosswalk.md").read_text(encoding="utf-8")
CITE = re.compile(r"`([^`]+)` :: (.+)")


def rows(heading: str) -> list[list[str]]:
    part = DOC.split(f"({heading})", 1)[1].split("\n## ", 1)[0]
    return [
        [cell.strip() for cell in line.strip().strip("|").split("|")]
        for line in part.splitlines()
        if line.startswith("| ") and not line.startswith("| ---") and "Automated test" not in line
    ]


def test_every_cited_test_exists_under_its_name() -> None:
    cited = 0
    for heading in ("UF-0388-02", "UF-0388-03", "UF-0389-06"):
        for row in rows(heading):
            match = CITE.match(row[1])
            assert match, row
            path, name = match.groups()
            text = (ROOT / path).read_text(encoding="utf-8")
            assert name.strip() in text, f"{path} has no test named {name!r}"
            assert row[2] and row[2] != "-", f"{row[0]}: say what is left for a person"
            cited += 1
    assert cited >= 25


def test_each_section_covers_what_its_task_names() -> None:
    patterns = " ".join(row[0] for row in rows("UF-0388-02"))
    for word in ("Menu", "dialog", "Tabs", "Combobox", "Grid"):
        assert word in patterns
    criteria = " ".join(row[0] for row in rows("UF-0388-03"))
    for number in ("1.4.3", "2.4.7", "1.4.10", "2.5.8", "2.5.7"):
        assert number in criteria  # contrast, focus, reflow, target size, drag alternatives
    invariants = " ".join(row[0] for row in rows("UF-0389-06"))
    for word in ("unsolicited Pause", "Exact IDs", "Consent", "ready-only", "FLAC"):
        assert word in invariants


def test_no_em_dash() -> None:
    assert chr(0x2014) not in DOC
