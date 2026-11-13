"""S4-0110-10: the assistive-technology session log asks for the exact environment and never lets an
automated pass stand for a screen-reader session or for WCAG compliance."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "docs" / "verification" / "at-session-log.md"
SPEC = ROOT / "web" / "e2e" / "s4-0110-at-log.e2e.ts"
FIELDS = [
    "Date:",
    "Tester (name):",
    "Commit SHA:",
    "Device and OS (with version):",
    "Browser (with full version):",
    "Screen reader (with version)",
    "Zoom and text size:",
    "Automated log line",
    "Signed:",
]


def test_the_template_asks_for_every_environment_field_and_all_seven_tasks() -> None:
    text = LOG.read_text(encoding="utf-8")
    template = text.split("## Template", 1)[1].split("## Sessions", 1)[0]
    for field in FIELDS:
        assert field in template, field
    for task in ("First run", "Playback", "Editing", "Requests", "Studio", "Export", "Zoom"):
        assert re.search(rf"^\| \d {task} \|", template, re.MULTILINE), task


def test_recorded_sessions_fill_every_field_and_no_page_claims_compliance() -> None:
    text = LOG.read_text(encoding="utf-8")
    sessions = text.split("## Sessions", 1)[1]
    for block in re.split(r"^### Session ", sessions, flags=re.MULTILINE)[1:]:
        for field in FIELDS:
            line = next((row for row in block.splitlines() if field in row), "")
            assert line and line.split(field, 1)[1].strip(), (
                f"{field} empty in session {block[:10]}"
            )
    assert not re.search(r"\bis (fully )?WCAG[^.\n]* compliant", text, re.IGNORECASE)


def test_the_automated_log_says_what_it_is_not() -> None:
    spec = SPEC.read_text(encoding="utf-8")
    assert "not WCAG 2.2 compliance and not a screen-reader session" in spec
    for stamp in ("commit:", "machine:", "axe:", "viewport:", "fixture:"):
        assert stamp in spec, stamp
