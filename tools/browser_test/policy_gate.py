"""Fail new hosted-audio egress in browser Cloud code without hiding legacy debt.

CI uses a patch-scoped gate because the base currently contains legacy upload paths.
Release additionally requires --full after the owning migration agents remove those paths.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PREFIXES = (
    "web/src/cloud/",
    "web/src/engine/",
    "web/src/media/",
    "web/src/venue-player/",
    "src/selecta/routes/cloud_",
)
# Calls/payloads, not harmless architecture prose mentioning older URLs.
FORBIDDEN = re.compile(
    r"(?:fetch\s*\(|\bapi\s*(?:<[^>]+>)?\s*\(|XMLHttpRequest|"
    r"sendBeacon|\.open\s*\()"
    r"[^\n]*(?:/uploads/plan|/uploads/parts|/cloud-assets|/audio/upload|"
    r"/assets/presign|/uploads/[^/]+/parts)",
    re.IGNORECASE,
)
INSTRUCTIONS = re.compile(
    r"(?i)(?:must|required|need to)\s+(?:install|run|start)\s+"
    r"(?:python|ffmpeg|a\s+local\s+server|the\s+daemon)"
)
USER_FACING = ("web/src/cloud/", "web/src/venue-player/")


def affected(path: str) -> bool:
    return path.startswith(SOURCE_PREFIXES)


def violations(lines: list[tuple[str, str]]) -> list[str]:
    output = []
    for path, line in lines:
        if not affected(path):
            continue
        if FORBIDDEN.search(line) or (
            path.startswith(USER_FACING) and INSTRUCTIONS.search(line)
        ):
            output.append(f"{path}: {line.strip()[:180]}")
    return output


def added_lines(base: str) -> list[tuple[str, str]]:
    result = subprocess.run(
        ["git", "diff", "--no-ext-diff", "--unified=0", f"{base}...HEAD", "--",
         "web/src/cloud", "web/src/engine", "web/src/media", "web/src/venue-player",
         "src/selecta/routes"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    path = ""
    found = []
    for line in result.stdout.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++"):
            found.append((path, line[1:]))
    return found


def all_lines() -> list[tuple[str, str]]:
    found = []
    roots = ("web/src/cloud", "web/src/engine", "web/src/media", "web/src/venue-player")
    for root in roots:
        parent = ROOT / root
        if not parent.is_dir():
            continue
        for file in parent.rglob("*"):
            if file.suffix not in (".ts", ".tsx", ".js", ".jsx"):
                continue
            for line in file.read_text(encoding="utf-8").splitlines():
                found.append((file.relative_to(ROOT).as_posix(), line))
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", help="PR base commit, required for patch-scoped CI")
    parser.add_argument("--full", action="store_true", help="strict release source audit")
    args = parser.parse_args()
    if not args.full and not args.base:
        parser.error("pass --base or --full")
    issues = violations(all_lines() if args.full else added_lines(args.base))
    for issue in issues:
        print("[NO-GO] " + issue)
    scope = "full current Cloud source" if args.full else "newly introduced lines only"
    print(f"[BROWSER-QA] {scope}: {len(issues)} forbidden hosted-audio references")
    if not args.full:
        print("[BROWSER-QA] NOT a release clearance: legacy paths require full audit.")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
