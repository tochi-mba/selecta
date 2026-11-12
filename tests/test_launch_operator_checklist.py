"""The launch operator checklist names every SELECTA_* setting the cloud code reads, and no others.

docs/saas/launch-operator-checklist.md is what an operator follows to configure staging and
production. A setting added to src/selecta without a line there would be missed at launch, and a
name left there after the code stops reading it sends the operator after nothing.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "saas" / "launch-operator-checklist.md"
NAME = re.compile(r"(?<![A-Za-z0-9_])SELECTA_[A-Z0-9_]+")

LOCAL_ONLY = frozenset(
    {
        # The local app's home folder and its worker child process.
        "SELECTA_HOME",
        "SELECTA_PARENT_PID",
        # The loopback-only development stack (`dev.cmd cloud`), refused outside development.
        "SELECTA_DEV_API_URL",
        "SELECTA_DEV_DATA",
        "SELECTA_DEV_DATABASE_URL",
        "SELECTA_DEV_IDENTITY_URL",
        "SELECTA_DEV_ISOLATED",
        "SELECTA_DEV_SITE_URL",
        "SELECTA_DEV_STARTUP",
        "SELECTA_DEV_STRIPE_TEST_MODE",
        "SELECTA_LOCAL_IDENTITY",
    }
)
"""Settings src/selecta reads that an operator never sets for staging or production."""

OTHER_SOURCES = (
    ROOT / "infra",
    ROOT / "services",
    ROOT / ".github" / "workflows" / "deploy.yml",
)
"""Where deploy-time names live (Modal app, workflow, scripts) that src/selecta never reads."""


def names_in(text: str) -> set[str]:
    # A trailing underscore is a prefix built in an f-string (`SELECTA_R2_{name}`), not a name.
    return {name for name in NAME.findall(text) if not name.endswith("_")}


def files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return [p for p in path.rglob("*") if p.is_file() and "__pycache__" not in p.parts]


def code_names() -> set[str]:
    """Every SELECTA_* name in the cloud code. The audit tooling only quotes names in prose."""
    found: set[str] = set()
    for path in (ROOT / "src" / "selecta").rglob("*.py"):
        if "audit" in path.relative_to(ROOT / "src" / "selecta").parts:
            continue
        found |= names_in(path.read_text(encoding="utf-8"))
    return found


def deploy_names() -> set[str]:
    found: set[str] = set()
    for source in OTHER_SOURCES:
        for path in files(source):
            try:
                found |= names_in(path.read_text(encoding="utf-8"))
            except UnicodeDecodeError:
                continue
    return found


def doc_names() -> set[str]:
    return names_in(DOC.read_text(encoding="utf-8"))


def test_every_setting_the_code_reads_is_in_the_checklist() -> None:
    missing = sorted(code_names() - LOCAL_ONLY - doc_names())
    assert not missing, f"Add these to {DOC.name} Section 11 (or LOCAL_ONLY): {missing}"


def test_the_checklist_names_only_settings_something_reads() -> None:
    known = code_names() | deploy_names()
    stale = sorted(doc_names() - known)
    assert not stale, f"{DOC.name} names settings nothing reads: {stale}"


def test_local_only_list_is_still_true() -> None:
    gone = sorted(LOCAL_ONLY - code_names())
    assert not gone, f"Drop these from LOCAL_ONLY, the code no longer reads them: {gone}"
    leaked = sorted(LOCAL_ONLY & doc_names())
    assert not leaked, f"Local-only settings in the operator checklist: {leaked}"


def test_checklist_has_no_em_dash_and_fits() -> None:
    text = DOC.read_text(encoding="utf-8")
    assert "—" not in text
    assert len(text.splitlines()) < 1000
