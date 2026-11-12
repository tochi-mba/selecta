"""S4-0112-01: a file-by-file map from every Selecta 4.0 baseline test to where it is now.

    python -m selecta.audit.suite_inventory --write

Reads every Python, web unit, browser (Edge) and bench test file at the pinned baseline commit
and in the working tree, takes the name of every test in each, and follows git's rename
detection from the baseline to HEAD. Each baseline test is then `kept` (same name in the same or
renamed file), `moved` (same name in another file of the same kind) or `not found` (dropped or
renamed; a person decides which). The report is a machine map for a person to review; it proves no assertion is equivalent.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASELINE = "9b663f9f10212619f27ce67ce82f602347065cbd"
REPORT = ROOT / "docs" / "adr" / "completion" / "s4-0112-test-inventory.md"
DATA = ROOT / "docs" / "adr" / "completion" / "s4-0112-test-inventory.json"

KINDS = [
    ("python", re.compile(r"^tests/(.+/)?test_[^/]*\.py$")),
    ("web unit", re.compile(r"^web/src/.+\.test\.tsx?$")),
    ("browser", re.compile(r"^web/e2e/.+\.(e2e|mp)\.ts$")),
    ("bench", re.compile(r"^web/bench/.+\.bench\.ts$")),
]
PY_TEST = re.compile(r"^\s*(?:async\s+)?def (test_\w+)\s*\(", re.MULTILINE)
TS_TEST = re.compile(
    r"\b(?:it|test)(?:\.(?:skip|only|fixme|fails))?\(\s*(['\"`])((?:\\.|(?!\1).)*)\1"
)


def kind_of(path: str) -> str | None:
    for kind, pattern in KINDS:
        if pattern.match(path):
            return kind
    return None


def names_in(path: str, text: str) -> list[str]:
    """Every test's own name in a file, in order, duplicates kept once."""
    if path.endswith(".py"):
        found = PY_TEST.findall(text)
    else:
        found = [name for _, name in TS_TEST.findall(text)]
    return list(dict.fromkeys(found))


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout


def baseline_files(ref: str = BASELINE) -> dict[str, str]:
    """Each test file at `ref` with its text, read in one `git cat-file --batch` call."""
    listed = _git("ls-tree", "-r", "--name-only", ref).splitlines()
    paths = [path for path in listed if kind_of(path)]
    batch = "".join(f"{ref}:{path}\n" for path in paths).encode()
    raw = subprocess.run(
        ["git", "cat-file", "--batch"], cwd=ROOT, input=batch, capture_output=True, check=True
    ).stdout
    texts: dict[str, str] = {}
    at = 0
    for path in paths:
        header_end = raw.index(b"\n", at)
        size = int(raw[at:header_end].split()[2])
        texts[path] = raw[header_end + 1 : header_end + 1 + size].decode("utf-8", "replace")
        at = header_end + 1 + size + 1
    return texts


def current_files(root: Path = ROOT) -> dict[str, str]:
    files: dict[str, str] = {}
    for base in ("tests", "web/src", "web/e2e", "web/bench"):
        for path in (root / base).rglob("*"):
            relative = path.relative_to(root).as_posix()
            if "node_modules" in relative or not path.is_file() or not kind_of(relative):
                continue
            files[relative] = path.read_text(encoding="utf-8", errors="replace")
    return files


def renames(ref: str = BASELINE) -> dict[str, str]:
    moved: dict[str, str] = {}
    for line in _git("diff", "-M", "--name-status", ref, "HEAD").splitlines():
        parts = line.split("\t")
        if parts[0].startswith("R") and len(parts) == 3:
            moved[parts[1]] = parts[2]
    return moved


@dataclass
class FileMap:
    path: str
    kind: str
    now: str | None
    kept: list[str] = field(default_factory=list)
    moved: dict[str, str] = field(default_factory=dict)
    not_found: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.now is None and not self.kept and not self.moved:
            return "file gone"
        if self.not_found:
            return "tests not found"
        if self.moved:
            return "tests moved"
        return "same tests" if self.now == self.path else "renamed, same tests"


def build(old: dict[str, str], new: dict[str, str], renamed: dict[str, str]) -> list[FileMap]:
    names_now = {path: names_in(path, text) for path, text in new.items()}
    where: dict[tuple[str, str], list[str]] = {}
    for path, names in names_now.items():
        for name in names:
            where.setdefault((kind_of(path) or "", name), []).append(path)
    maps = []
    for path in sorted(old):
        kind = kind_of(path) or ""
        target = renamed.get(path, path)
        now = target if target in new else None
        entry = FileMap(path, kind, now)
        here = set(names_now.get(now, [])) if now else set()
        for name in names_in(path, old[path]):
            if name in here:
                entry.kept.append(name)
            elif where.get((kind, name)):
                entry.moved[name] = where[(kind, name)][0]
            else:
                entry.not_found.append(name)
        maps.append(entry)
    return maps


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def markdown(maps: Iterable[FileMap], head: str, now_files: int, now_tests: int) -> str:
    maps = list(maps)
    tests = sum(len(m.kept) + len(m.moved) + len(m.not_found) for m in maps)
    kept = sum(len(m.kept) for m in maps)
    moved = sum(len(m.moved) for m in maps)
    missing = [(m, name) for m in maps for name in m.not_found]
    lines = [
        "# S4-0112-01 test inventory: baseline to now",
        "",
        "Generated by `python -m selecta.audit.suite_inventory --write`; do not edit by hand.",
        f"Baseline `{BASELINE}`, compared with the working tree at `{head}`.",
        "A machine map from test names and git renames. A kept name is not proof the assertion is",
        "unchanged, and every `not found` row needs a person to say dropped, renamed or replaced.",
        "",
        f"- Baseline: {len(maps)} test files, {tests} tests.",
        f"- Kept by name in the same or renamed file: {kept}. Moved to another file: {moved}.",
        f"  Not found by name: {len(missing)}.",
        f"- Now: {now_files} test files, {now_tests} tests.",
        "",
        "## Every baseline file",
        "",
        "| Baseline file | Kind | Now | Tests | Kept | Moved | Not found | Status |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for m in maps:
        total = len(m.kept) + len(m.moved) + len(m.not_found)
        lines.append(
            f"| `{m.path}` | {m.kind} | {f'`{m.now}`' if m.now else '-'} | {total} | "
            f"{len(m.kept)} | {len(m.moved)} | {len(m.not_found)} | {m.status} |"
        )
    lines += ["", "## Moved tests", ""]
    rows = [(m, name, to) for m in maps for name, to in m.moved.items()]
    lines += [f"- `{m.path}` {_cell(name)!r} is now in `{to}`" for m, name, to in rows] or ["None."]
    lines += ["", "## Not found by name (for review)", ""]
    lines += [f"- `{m.path}`: {_cell(name)!r}" for m, name in missing] or ["None."]
    lines.append("")
    return "\n".join(lines)


def run(write: bool) -> str:
    old = baseline_files()
    new = current_files()
    maps = build(old, new, renames())
    head = _git("rev-parse", "--short", "HEAD").strip()
    now_tests = sum(len(names_in(path, text)) for path, text in new.items())
    text = markdown(maps, head, len(new), now_tests)
    if write:
        REPORT.write_text(text, encoding="utf-8", newline="\n")
        data = [
            {
                "path": m.path,
                "kind": m.kind,
                "now": m.now,
                "status": m.status,
                "kept": len(m.kept),
                "moved": m.moved,
                "not_found": m.not_found,
            }
            for m in maps
        ]
        payload = {"baseline": BASELINE, "head": head, "files": data}
        DATA.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8", newline="\n")
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--write", action="store_true", help="write the report and its JSON")
    args = parser.parse_args()
    text = run(args.write)
    print(text.split("## Every baseline file", 1)[0])


if __name__ == "__main__":
    main()
