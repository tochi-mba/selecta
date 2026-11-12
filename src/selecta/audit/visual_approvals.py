"""Which visual review captures has a named person approved? (EX-0133-02)

    python -m selecta.audit.visual_approvals inventory
    python -m selecta.audit.visual_approvals check <captures-dir> [approvals.json]
    python -m selecta.audit.visual_approvals approve <dir> --reviewer "Name" [--browser edge]

`web/e2e/visual.e2e.ts` saves review candidates (`candidate-<width>-<scheme>-<state>.png`), never
self-blessed baselines. `inventory` lists every key state at every display and theme that spec
captures, read from the spec itself. `check` hashes the captures in a folder (search it
recursively, so a Playwright output folder per browser works) and compares them with the approvals
file: each capture is approved (same image a reviewer signed), stale (the image changed since),
unapproved, or missing (the spec should have captured it and didn't). It exits 0 only when every
expected capture is approved. `approve` is for the reviewer: it records, under their name and
today's date, the hash of each capture they looked at. Nothing here approves anything by itself.

No network; writes only the approvals file, and only on `approve`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / "web/e2e/visual.e2e.ts"
APPROVALS = ROOT / "docs/verification/visual-approvals.json"
DISPLAY = re.compile(r"\{\s*width:\s*(\d+),\s*height:\s*\d+,\s*scheme:\s*'(\w+)'\s*\}")
VIEW = re.compile(r"\{\s*path:\s*'[^']*',\s*name:\s*'([\w-]+)'\s*\}")
STATE = re.compile(r"capture\('([\w-]+)'\)")


def inventory(spec: Path = SPEC) -> list[str]:
    """Every capture name the spec takes, one per display, theme and state."""
    text = spec.read_text(encoding="utf-8")
    states = [*VIEW.findall(text), *STATE.findall(text)]
    return [
        f"candidate-{width}-{scheme}-{state}"
        for width, scheme in DISPLAY.findall(text)
        for state in dict.fromkeys(states)
    ]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def captures(folder: Path, browser: str) -> dict[str, Path]:
    """Capture name (with its browser) to file, for every candidate PNG under the folder."""
    return {f"{browser}/{p.stem}": p for p in sorted(folder.rglob("candidate-*.png"))}


def load(approvals: Path) -> dict:
    if not approvals.exists():
        return {}
    return json.loads(approvals.read_text(encoding="utf-8"))


def check(folder: Path, approvals: Path, browser: str, spec: Path = SPEC) -> dict[str, list[str]]:
    signed = load(approvals)
    found = captures(folder, browser)
    result: dict[str, list[str]] = {"approved": [], "stale": [], "unapproved": [], "missing": []}
    for name in inventory(spec):
        key = f"{browser}/{name}"
        if key not in found:
            result["missing"].append(key)
        elif key not in signed:
            result["unapproved"].append(key)
        elif signed[key]["sha256"] != digest(found[key]):
            result["stale"].append(key)
        else:
            result["approved"].append(key)
    return result


def approve(folder: Path, approvals: Path, browser: str, reviewer: str) -> int:
    if not reviewer.strip():
        raise ValueError("a reviewer must be named")
    signed = load(approvals)
    today = dt.date.today().isoformat()
    found = captures(folder, browser)
    for key, path in found.items():
        signed[key] = {"sha256": digest(path), "reviewer": reviewer.strip(), "date": today}
    approvals.parent.mkdir(parents=True, exist_ok=True)
    approvals.write_text(json.dumps(signed, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return len(found)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inventory")
    for name in ("check", "approve"):
        command = sub.add_parser(name)
        command.add_argument("folder", type=Path)
        command.add_argument("approvals", type=Path, nargs="?", default=APPROVALS)
        command.add_argument("--browser", default="edge")
        if name == "approve":
            command.add_argument("--reviewer", required=True)
    args = parser.parse_args(argv)
    if args.command == "inventory":
        names = inventory()
        print("\n".join(names))
        print(f"{len(names)} captures")
        return 0
    if args.command == "approve":
        count = approve(args.folder, args.approvals, args.browser, args.reviewer)
        print(f"recorded {count} captures as approved by {args.reviewer}")
        return 0
    result = check(args.folder, args.approvals, args.browser)
    for state, names in result.items():
        print(f"{state}: {len(names)}")
        if state != "approved":
            print("".join(f"  {name}\n" for name in names), end="")
    return 0 if len(result["approved"]) == len(inventory()) else 1


if __name__ == "__main__":
    sys.exit(main())
