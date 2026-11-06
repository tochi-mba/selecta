"""No file in the project goes over 1,000 lines. Long files get split by what they do."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent
MOST_LINES = 1000
# written by tools, not people, and nobody reads or edits them
GENERATED = {"uv.lock", "web/pnpm-lock.yaml"}
# not text anyone keeps lines of
BINARY = {".png", ".jpg", ".ico", ".flac", ".wav", ".mp3"}


def _every_file() -> list[str]:
    """What git keeps, and what it would keep, so a new file counts before it's committed."""
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return listed.stdout.splitlines()


def _too_long(names: list[str], root: Path = ROOT, limit: int = MOST_LINES) -> dict[str, int]:
    found = {}
    for name in names:
        path = root / name
        if name in GENERATED or path.suffix.lower() in BINARY or not path.is_file():
            continue
        try:
            lines = len(path.read_text("utf-8").splitlines())
        except UnicodeDecodeError:
            continue
        if lines > limit:
            found[name] = lines
    return found


def test_no_file_is_over_a_thousand_lines():
    found = _too_long(_every_file())
    assert not found, f"Split these by what they do, so each is {MOST_LINES} lines or fewer: {found}"


def test_the_rule_catches_a_long_file(tmp_path):
    (tmp_path / "long.py").write_text("x\n" * 1001, "utf-8")
    (tmp_path / "fine.py").write_text("x\n" * 1000, "utf-8")
    assert _too_long(["long.py", "fine.py"], tmp_path) == {"long.py": 1001}


def test_generated_files_are_the_only_ones_let_off(tmp_path):
    (tmp_path / "uv.lock").write_text("x\n" * 2000, "utf-8")
    assert _too_long(["uv.lock"], tmp_path) == {}
    assert GENERATED == {"uv.lock", "web/pnpm-lock.yaml"}
