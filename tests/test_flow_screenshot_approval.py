"""Screenshots stay candidates until a person signs them, and the a11y automation list stays true.

SF-0239-06: a captured screen is a candidate, never a golden image, until a named reviewer records
name, date, device and the exact SHA in docs/adr/completion/visual-evidence.md.
SF-0239-05: every automated accessibility check named in docs/engineering/flow-cross-cutting.md is a
test that exists in the file it names.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / "web" / "e2e"
EVIDENCE = ROOT / "docs" / "adr" / "completion" / "visual-evidence.md"
DOC = ROOT / "docs" / "engineering" / "flow-cross-cutting.md"
CANDIDATE = "candidate-not-independently-verified"


def _specs() -> dict[str, str]:
    return {path.name: path.read_text(encoding="utf-8") for path in sorted(E2E.glob("*.ts"))}


def test_every_screenshot_manifest_is_written_as_a_candidate() -> None:
    specs = _specs()
    # every spec that writes a capture manifest or a measured baseline
    writers = {
        name
        for name, text in specs.items()
        if "writeFileSync(" in text and ("screenshot(" in text or CANDIDATE in text)
    }
    assert {"paired-theme.e2e.ts", "mp-baseline.mp.ts"} <= writers
    for name in writers:
        statuses = set(re.findall(r"status:\s*'([a-z-]+)'", specs[name]))
        manifest = {
            status
            for status in statuses
            if "verified" in status or "approved" in status or "golden" in status
        }
        assert manifest == {CANDIDATE}, f"{name} writes {manifest}"


def test_no_spec_turns_a_capture_into_a_golden_baseline() -> None:
    # toHaveScreenshot / toMatchSnapshot would make the first capture the expected image unreviewed
    for name, text in _specs().items():
        assert "toHaveScreenshot(" not in text, name
        assert "toMatchSnapshot(" not in text, name
    assert not list((ROOT / "web").glob("e2e/*-snapshots")), (
        "a committed snapshot folder is an unreviewed golden"
    )


def test_an_approval_in_the_evidence_names_reviewer_date_device_and_sha() -> None:
    for line in EVIDENCE.read_text(encoding="utf-8").splitlines():
        if line.startswith("|") and re.search(r"\bapproved\b", line, re.IGNORECASE):
            assert re.search(r"\b20\d\d-\d\d-\d\d\b", line), f"approval without a date: {line}"
            assert re.search(r"\b[0-9a-f]{7,40}\b", line), f"approval without an exact SHA: {line}"
            assert line.count("|") >= 6, f"approval without reviewer and device columns: {line}"


def test_every_named_accessibility_check_exists() -> None:
    section = DOC.read_text(encoding="utf-8").split("(SF-0239-05)", 1)[1].split("\n## ", 1)[0]
    cited = re.findall(r"`(web/e2e/[^`]+\.ts)` \"([^\"]+)\"", section)
    assert len(cited) >= 10
    for path, name in cited:
        text = (ROOT / path).read_text(encoding="utf-8")
        assert name in text, f"{name!r} is not in {path}"
