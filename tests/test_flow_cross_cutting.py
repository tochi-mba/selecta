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
    return {path for path in re.findall(r"`((?:web|src|tests|docs)/[^`\s]+\.[a-z]+)`", text)}


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
    for journey in (
        "First run",
        "First play",
        "First handoff",
        "Shape",
        "Reorder",
        "Audition",
        "Studio",
        "Export",
    ):
        assert journey in text, journey
    assert "NVDA with Microsoft Edge" in text
    assert "never combined into one score" in text
    assert "Denominator" in text and "Exact SHA" in text
    assert chr(0x2014) not in text


def test_every_parity_capability_has_a_tested_journey_that_exists() -> None:
    """SF-0247-05: each capability in the parity map names an end-to-end test that is really there."""
    parity = (ROOT / "docs" / "adr" / "selecta-flow-feature-parity.md").read_text(encoding="utf-8")
    capabilities = [
        row.split("|")[1].strip()
        for row in parity.splitlines()
        if row.startswith("| ") and not row.startswith("| Capability") and not row.startswith("|---")
    ]
    assert len(capabilities) >= 20
    text = DOC.read_text(encoding="utf-8").split("(SF-0247-05)", 1)[1]
    rows = {}
    for row in text.splitlines():
        found = re.match(r'^\| ([^|]+?) \| `(web/e2e/[^`]+)` "([^"]+)" \|$', row)
        if found:
            rows[found.group(1)] = (found.group(2), found.group(3))
    assert sorted(rows) == sorted(capabilities)
    for spec, title in rows.values():
        source = (ROOT / spec).read_text(encoding="utf-8")
        assert f"test('{title}'" in source, (spec, title)


def test_the_breakpoint_matrix_names_real_media_queries() -> None:
    """SF-0233-01: each width or height the matrix relies on is a media query in its stylesheet."""
    text = DOC.read_text(encoding="utf-8").split("(SF-0233-01)", 1)[1].split("\n## ", 1)[0]
    css = "".join(
        (ROOT / path).read_text(encoding="utf-8")
        for path in sorted(set(re.findall(r"`(web/src/[^`]+\.css)`", text)))
    )
    for query in ("max-width: 1040px", "max-width: 1024px", "max-width: 760px", "max-width: 620px",
                  "max-width: 520px", "max-width: 560px", "min-width: 761px", "max-height: 520px",
                  "max-height: 420px"):
        assert f"({query})" in css, query


def test_the_rollout_order_goes_foundation_then_shell_then_scenes_then_operations() -> None:
    """SF-0241-01: the roadmap's delivery phases run in the migration order the ADR asks for."""
    roadmap = (ROOT / "docs" / "adr" / "selecta-flow-roadmap.md").read_text(encoding="utf-8")
    phases = re.findall(r"^### Phase (\d+) - (.+)$", roadmap, re.MULTILINE)
    order = [int(number) for number, _ in phases]
    assert order == sorted(order) and len(order) >= 10
    names = [name.lower() for _, name in phases]

    def first(*words: str) -> int:
        return next(i for i, name in enumerate(names) if any(word in name for word in words))

    foundation = first("components", "foundation")
    shell = first("navigation", "persistent player")
    scenes = first("listening", "explore", "create", "studio")
    operations = first("operations", "finishing")
    assert foundation < shell < scenes < operations


def test_release_gates_block_audio_data_privacy_and_access_failures() -> None:
    """SF-0247-04: P0 names audio, data, privacy and access failures; P1 and P2 are separate tiers."""
    gates = (ROOT / "docs" / "adr" / "selecta-flow-release-gates.md").read_text(encoding="utf-8")
    p0 = next(line for line in gates.splitlines() if line.startswith("- **P0"))
    for failure in ("overlapping audio", "rewriting local audio", "wrong-revision FLAC",
                    "exposed private media", "inaccessible essential control"):
        assert failure in p0, failure
    assert "- **P1" in gates and "- **P2" in gates


def test_every_pull_request_carries_its_evidence_record() -> None:
    """SF-0239-08 and SF-0241-06: SHA, fixture, reviewer and open findings are asked for on every PR."""
    template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
    for field in ("**Tested SHA:**", "**Fixture:**", "**Independent reviewer:**", "**Unresolved findings:**"):
        assert field in template, field
    assert "Link the ADR and checklist tasks" in template


def test_every_flow_adr_records_a_dated_decision_and_counted_implementation() -> None:
    """SF-0247-01 and SF-0247-02: decision and implementation states are explicit, dated and counted."""
    states = ("Proposed", "Accepted", "Rejected", "Superseded")
    for number in range(198, 248):
        path = next((ROOT / "docs" / "adr").glob(f"adr-0{number}-*.md"))
        text = path.read_text(encoding="utf-8")
        decision = re.search(r"^- \*\*Decision:\*\* (\w+) \((.*?)\)", text, re.MULTILINE)
        assert decision and decision.group(1) in states, path.name
        assert re.search(r"\d{4}-\d{2}-\d{2}", decision.group(2)), path.name
        implementation = re.search(r"^- \*\*Implementation:\*\* (Not started|In progress|Implemented)\b", text, re.MULTILINE)
        assert implementation, path.name
    policy = (ROOT / "docs" / "adr" / "selecta-flow-implementation-checklist.md").read_text(encoding="utf-8")
    policy = policy.split("## Status update policy", 1)[1]
    assert "Proposed" in policy and "Rejected" in policy and "Superseded" in policy and "date" in policy
    assert "Not started" in policy and "In progress" in policy and "Implemented only with matching code" in policy


def _web_sources() -> dict[str, str]:
    src = ROOT / "web" / "src"
    return {
        path.relative_to(src).as_posix(): path.read_text(encoding="utf-8")
        for path in src.rglob("*.ts*")
        if ".test." not in path.name and path.suffix in {".ts", ".tsx"}
    }


def test_transport_and_routes_each_have_one_owner() -> None:
    """SF-0236-01: one module makes sound, one shares the audio element, one owns local addresses."""
    sources = _web_sources()
    contexts = sorted(name for name, text in sources.items() if "new AudioContext(" in text)
    elements = sorted(name for name, text in sources.items() if "new Audio(" in text)
    assert contexts == ["player.ts", "studio.ts"], "the main player, and the Studio preview engine"
    assert elements == ["audio/focus.ts"], "every preview shares the one element audio focus owns"
    # everything that can make its own sound asks audio focus first
    for name in ("views/Studio.tsx", "views/Listening.tsx", "views/Links.tsx", "ui/AudioPreview.tsx"):
        assert "takeAudio" in sources[name], name
    local = {
        name
        for name, text in sources.items()
        if ("history.pushState" in text or "history.replaceState" in text)
        and not name.startswith(("cloud/", "admin/"))
    }
    assert local == {"router.ts"}


def test_shared_primitives_never_reach_into_a_screen() -> None:
    """SF-0236-02: tokens, ui primitives and state never import a page, so screens stay uncoupled."""
    sources = _web_sources()
    for name, text in sources.items():
        if name.startswith(("ui/", "state/", "styles/")):
            assert not re.search(r"from '\.\./views/", text), name
    tokens = (ROOT / "web" / "src" / "styles" / "tokens.css").read_text(encoding="utf-8")
    assert "--space-" in tokens and "--text-" in tokens
