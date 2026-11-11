"""Selecta 3.0 design documents held to the code they describe (S3-0067/0068/0069/0070/0072).

Each document under docs/adr/selecta-3-*.md is the deliverable for a "specify", "inventory" or
"audit" task. These checks fail when the code moves on and the document does not: a new place that
makes sound, a new shortcut, a new remote address, or a missing person-run script.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADR = ROOT / "docs" / "adr"
WEB = ROOT / "web" / "src"


def doc(name: str) -> str:
    return (ADR / name).read_text(encoding="utf-8")


def sources(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    return [
        path
        for path in root.rglob("*")
        if path.suffix in suffixes and ".test." not in path.name and "test" not in path.parts
    ]


def test_every_place_that_starts_sound_is_in_the_audio_audit():
    """S3-0069-02: the audit names every source file that can make a sound."""
    text = doc("selecta-3-audio.md")
    sound = re.compile(r"takeAudio\(|new Audio\(|<audio\b|new AudioContext\(")
    makers = [
        path.relative_to(ROOT).as_posix()
        for path in sources(WEB, (".ts", ".tsx"))
        if sound.search(path.read_text(encoding="utf-8"))
    ]
    assert len(makers) >= 6
    missing = [path for path in makers if f"`{path}`" not in text]
    assert missing == []


def test_the_audio_states_and_failures_are_written_down():
    """S3-0069-01 and S3-0069-08: the state machine and failure table exist with their rows."""
    text = doc("selecta-3-audio.md")
    for state in (
        "Idle",
        "Playing",
        "Paused by the person",
        "Previewing, mix was playing",
        "Previewing, then the person touched the transport",
    ):
        assert f"| {state} |" in text
    for failure in (
        "Rejected `play()`",
        "Song is missing",
        "Song can't be decoded",
        "System suspends the sound",
    ):
        assert failure in text


def test_every_global_shortcut_is_in_the_keyboard_inventory():
    """S3-0068-01: each key in web/src/state/shortcuts.ts has a row saying what it collides with."""
    registry = (WEB / "state" / "shortcuts.ts").read_text(encoding="utf-8")
    keys = re.findall(r"keys: '([^']+)'", registry)
    assert len(keys) >= 10
    table = doc("selecta-3-keyboard.md")
    rows = [line for line in table.splitlines() if line.startswith("| ") and line.count("|") == 5]
    for key in keys:
        assert any(
            f"| {key} " in row or f"| {key} or" in row or f" {key} |" in row for row in rows
        ), key


def test_the_accessibility_inventory_and_person_scripts_cover_the_named_journeys():
    """S3-0067-01 and S3-0067-02: criteria are mapped, and a script exists per journey."""
    text = doc("selecta-3-accessibility.md")
    for criterion in (
        "1.3.1",
        "1.4.3",
        "1.4.10",
        "2.1.1",
        "2.1.2",
        "2.4.3",
        "2.4.11",
        "2.5.7",
        "2.5.8",
        "4.1.2",
        "4.1.3",
    ):
        cells = [line.split("|")[1] for line in text.splitlines() if line.startswith("| ")]
        pattern = rf"(?<![\d.]){re.escape(criterion)}(?!\d)"
        assert any(re.search(pattern, cell) for cell in cells), criterion
    scripts = text.split("## Scripts for a person", 1)[1]
    for journey in ("First run", "Playback", "Editing", "Requests", "Studio", "Export", "Zoom"):
        assert f"**{journey}.**" in scripts, journey
    assert "NVDA" in scripts and "VoiceOver" in scripts


def test_every_remote_address_the_local_server_calls_is_disclosed():
    """S3-0072-01/02: what can leave this PC is listed, with the lyric lookup first."""
    text = doc("selecta-3-privacy.md")
    remote = set()
    for path in sources(ROOT / "src" / "selecta", (".py",)):
        if {"cloud", "saas", "observability", "billing"} & set(
            path.relative_to(ROOT / "src" / "selecta").parts
        ):
            continue
        source = path.read_text(encoding="utf-8")
        for host in re.findall(r"https://([a-z0-9-]+(?:\.[a-z0-9-]+)+)", source):
            if host not in {"github.com", "127.0.0.1", "localhost"} and "example" not in host:
                remote.add(host)
    assert "lrclib.net" in remote
    undisclosed = sorted(host for host in remote if f"`{host}`" not in text)
    # WorkOS and Stripe are Cloud-mode hosts, documented under docs/saas,
    # never reached by the local app.
    assert [host for host in undisclosed if host not in {"api.workos.com", "api.stripe.com"}] == []
    assert "Artist, title, album and duration" in text


def test_the_glossary_layers_numbers_and_motion_are_specified():
    """S3-0070-01/03/04/05: states with their API source, layered explanations,
    honest numbers and motion."""
    text = doc("selecta-3-glossary.md")
    for heading in (
        "## States, and where each comes from",
        "## How explanations are layered",
        "## Being honest about numbers",
        "## Motion",
        "## Buttons and messages",
    ):
        assert heading in text, heading


def test_every_runtime_dependency_added_since_the_baseline_is_audited():
    """S3-0072-05: a runtime dependency beyond the baseline's React and build tools is named
    in the audit."""
    import json

    baseline = {"react", "react-dom", "vite", "@vitejs/plugin-react", "typescript"}
    package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
    added = sorted(set(package.get("dependencies", {})) - baseline)
    text = doc("selecta-3-privacy.md").split("## New dependencies", 1)[1].split("\n## ", 1)[0]
    assert [name for name in added if f"`{name}`" not in text] == []
