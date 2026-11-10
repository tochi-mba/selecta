"""The Flow cross-cutting inventories stay true to the code (SF-0232, SF-0237, SF-0238, SF-0243).

docs/engineering/flow-cross-cutting.md names the source and tests behind each inventory, and lists
every module allowed to open an outbound connection. These checks keep that document honest.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "engineering" / "flow-cross-cutting.md"
OUTBOUND = re.compile(
    r"^\s*(?:import|from)\s+(?:httpx|urllib\.request|requests|aiohttp|http\.client|boto3|botocore)\b"
    r"|\burllib\.request\.",
    re.MULTILINE,
)
SECTIONS = (
    "SF-0232-01",
    "SF-0232-02",
    "SF-0232-05",
    "SF-0237-01",
    "SF-0243-01",
    "SF-0238-01",
)


def cited_paths(text: str) -> set[str]:
    return {
        path
        for path in re.findall(r"`((?:web|src|tests|docs)/[^`\s]+\.[a-z]+)`", text)
    }


def test_every_section_is_there() -> None:
    text = DOC.read_text(encoding="utf-8")
    for task in SECTIONS:
        assert f"({task})" in text, task
    assert chr(0x2014) not in text


def test_every_cited_file_exists() -> None:
    text = DOC.read_text(encoding="utf-8")
    paths = cited_paths(text)
    assert len(paths) > 20
    missing = sorted(path for path in paths if not (ROOT / path).is_file())
    assert missing == []


def test_only_listed_modules_open_outbound_connections() -> None:
    text = DOC.read_text(encoding="utf-8")
    egress = text.split("## Network egress and local files", 1)[1]
    listed = {path for path in cited_paths(egress) if path.startswith("src/selecta/")}
    listed.discard("src/selecta/cli.py")
    found = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "src" / "selecta").rglob("*.py")
        if OUTBOUND.search(path.read_text(encoding="utf-8"))
    }
    assert found == listed


def test_the_local_server_only_listens_on_this_computer() -> None:
    cli = (ROOT / "src" / "selecta" / "cli.py").read_text(encoding="utf-8")
    assert 'host="127.0.0.1" if mode is Mode.LOCAL' in cli
    assert 'uvicorn.run(server, host="127.0.0.1"' in cli


def test_the_research_protocol_covers_each_journey_and_keeps_joy_apart() -> None:
    text = (ROOT / "docs" / "research" / "flow-research-protocol.md").read_text(encoding="utf-8")
    for task in ("SF-0240-01", "SF-0240-02", "SF-0240-04", "SF-0240-06", "SF-0240-07"):
        assert f"({task})" in text, task
    for journey in ("First run", "First play", "First handoff", "Shape", "Reorder", "Audition", "Studio", "Export"):
        assert journey in text, journey
    assert "NVDA with Microsoft Edge" in text
    assert "never combined into one score" in text
    assert "Denominator" in text and "Exact SHA" in text
    assert chr(0x2014) not in text
