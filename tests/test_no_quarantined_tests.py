"""S4-0112-10: nothing is made green by focusing, skipping or quarantining a browser or unit test.

A test that is wrong is fixed or deleted with a reason in the commit (docs/ci.md, "Flakes and
quarantine"). A conditional runtime skip that names why (a missing prerequisite file) is allowed;
a test declared skipped, focused or marked fixme is not.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / "web" / "e2e", ROOT / "web" / "src"]
SUFFIXES = {".ts", ".tsx"}

FOCUSED = re.compile(r"\b(?:it|test|describe)(?:\.describe)?\.only\(")
DECLARED_SKIP = re.compile(r"\b(?:it|test|describe)(?:\.describe)?\.(?:skip|todo|fixme)\(\s*['\"`]")
FIXME = re.compile(r"\btest\.fixme\(")


def offending_lines() -> list[str]:
    found: list[str] = []
    for base in SOURCES:
        for path in sorted(base.rglob("*")):
            if path.suffix not in SUFFIXES or "node_modules" in path.parts:
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if FOCUSED.search(line) or DECLARED_SKIP.search(line) or FIXME.search(line):
                    found.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
    return found


def test_no_browser_or_unit_test_is_focused_skipped_or_quarantined() -> None:
    assert offending_lines() == []


def test_the_guard_recognises_what_it_forbids() -> None:
    assert FOCUSED.search("test.only('x', async () => {})")
    assert FOCUSED.search("test.describe.only('x', () => {})")
    assert DECLARED_SKIP.search("it.skip('flaky on Edge', () => {})")
    assert DECLARED_SKIP.search("test.describe.skip(\"later\", () => {})")
    assert FIXME.search("test.fixme(true, 'quarantined')")
    # a conditional runtime skip that explains a missing prerequisite stays allowed
    runtime = "test.skip(true, `run the whole MP spec first: ${file}.json is missing`);"
    assert not DECLARED_SKIP.search(runtime)
