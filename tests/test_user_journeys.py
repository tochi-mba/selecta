"""T0003: the written user journeys name browser tests that really exist."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "user-journeys.md"
STEP = re.compile(r'`(web/e2e/[\w.-]+\.e2e\.ts)` - "([^"]+)"')


def test_every_journey_is_recorded():
    text = DOC.read_text(encoding="utf-8")
    for journey in ("Casual listening", "Live requesting", "Mix creation", "Expert seam editing"):
        assert f"## {journey}" in text


def test_every_step_names_a_test_that_exists():
    steps = STEP.findall(DOC.read_text(encoding="utf-8"))
    assert len(steps) >= 20
    for spec, title in steps:
        source = (ROOT / spec).read_text(encoding="utf-8")
        assert f"test('{title}'" in source, f"{spec} has no test named {title!r}"
