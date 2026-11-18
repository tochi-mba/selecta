#!/usr/bin/env python3
"""Reject user-agent/browser identity checks in capability and feature-gate code.

Run from any directory with ``python tools/check_no_user_agent_gates.py``. The check is
deliberately static and conservative: only the named label-only modules may read browser
identity, and capability/feature decision modules may not import those readers. The allowlist
is for displaying or recording descriptive labels; it is never authority to gate playback.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "src"

IDENTITY_READ = re.compile(
    r"\buserAgent\b|\buserAgentData\b|"
    r"\bnavigator\s*\.\s*vendor\b|"
    r"\bnavigator\s*\.\s*platform\b|"
    r"\bnav\s*\.\s*platform\b"
)
IMPORT = re.compile(
    r"(?:^|\n)\s*(?:import|export)[^'\"\n]*?from\s+['\"]([^'\"]+)['\"]"
)
IDENTITY_IMPORT = re.compile(r"(?:^|/)(?:deviceInfo|deviceIdentity)(?:\.[cm]?[jt]sx?)?$")
DECIDER = re.compile(
    r"^(?:flags|engine/|media/|dsp/|cloud/onboarding/|cloud/localFirst|"
    r"cloud/venue/(?!deviceIdentity|probeSuite|capabilityRecord))"
)

# These modules only produce human-readable names, advisory words, a catalogue key, or an
# operator-copied evidence record. If one starts controlling a feature, move the decision into
# a probe-only module and remove its allowance here.
LABEL_ONLY = {
    "cloud/venue/deviceIdentity.ts",
    "devices/deviceInfo.ts",
    "devices/DeviceCheck.tsx",
    "kiosk/api.ts",
}

REQUIRED_DECIDERS = {
    "engine/probe.ts",
    "media/capabilities.ts",
    "cloud/venue/capabilityRecord.ts",
    "cloud/venue/VenuePosture.tsx",
}


def without_comments(source: str) -> str:
    """Remove comments while retaining strings and line boundaries for import scanning."""
    source = re.sub(r"/\*[\s\S]*?\*/", " ", source)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", source, flags=re.MULTILINE)


def source_files() -> list[Path]:
    if not SOURCE.is_dir():
        raise FileNotFoundError(f"web source directory not found: {SOURCE}")
    return sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file()
        and path.suffix in {".ts", ".tsx"}
        and not path.name.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"))
        and "/test/" not in path.as_posix()
        and "/__tests__/" not in path.as_posix()
    )


def main() -> int:
    problems: list[str] = []
    files = source_files()
    relative_names = {path.relative_to(SOURCE).as_posix() for path in files}
    missing_deciders = REQUIRED_DECIDERS - relative_names
    if missing_deciders:
        problems.append(
            "expected decision modules were not found: " + ", ".join(sorted(missing_deciders))
        )

    readers: set[str] = set()
    for path in files:
        relative = path.relative_to(SOURCE).as_posix()
        text = without_comments(path.read_text(encoding="utf-8"))
        if IDENTITY_READ.search(text):
            readers.add(relative)
            if relative not in LABEL_ONLY:
                problems.append(
                    f"{relative}: reads user-agent/platform identity outside the label-only allowlist"
                )

        if DECIDER.match(relative):
            for imported in IMPORT.findall(text):
                if IDENTITY_IMPORT.search(imported):
                    problems.append(
                        f"{relative}: capability/feature decision imports identity reader {imported}"
                    )

    stale = LABEL_ONLY - readers
    if stale:
        problems.append(
            "remove stale label-only allowances: " + ", ".join(sorted(stale))
        )

    if problems:
        print("User-agent feature-gate source scan failed:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print(f"User-agent feature-gate source scan passed ({len(files)} source files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
