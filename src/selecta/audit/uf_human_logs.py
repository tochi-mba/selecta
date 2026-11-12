"""Unified finish (UF) person-evidence logs: the checkers for what only a person can record.

Each ADR-0388/0389 person step writes one JSON log in docs/verification/uf/. The logs ship empty;
this module says what a complete one needs and refuses anything half filled, unnamed or synthetic.
It never fills a log itself.

    python -m selecta.audit.uf_human_logs     # list what each log still needs
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

LOGS = Path("docs/verification/uf")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")
HASH = re.compile(r"^[0-9a-f]{64}$")
CORE_ROUTES = ("/", "/mixes", "/listen", "/library", "/mix/current/edit", "/mixes/lucy")


@dataclass(frozen=True)
class Log:
    """One person-evidence log: who fills it, which rows it must cover, which fields each needs."""

    name: str
    tasks: tuple[str, ...]
    key: str
    required: tuple[str, ...]
    fields: tuple[str, ...]
    passing: str = "outcome"
    passes: tuple[str, ...] = ("pass",)


LOG_SPECS: dict[str, Log] = {
    spec.name: spec
    for spec in (
        Log(
            "at-journeys",
            ("UF-0388-08",),
            "journey",
            ("first-mix", "library", "lucy", "editor", "studio"),
            ("reviewer", "date", "device", "os", "browser", "assistive_technology", "outcome"),
        ),
        Log(
            "platform-report",
            ("UF-0389-02",),
            "check",
            ("mobile", "zoom-400", "forced-colours", "physical-keyboard", "screen-reader"),
            ("reviewer", "date", "device", "browser", "routes", "outcome"),
        ),
        Log(
            "visual-signoff",
            ("UF-0389-01",),
            "fixture",
            (),
            (
                "route",
                "state",
                "revision",
                "viewport",
                "light_sha256",
                "dark_sha256",
                "reviewer",
                "date",
                "verdict",
            ),
            passing="verdict",
            passes=("approved",),
        ),
        Log(
            "benchmarks",
            ("UF-0389-03", "UF-0380-08"),
            "scenario",
            ("library-20k", "lucy-long", "editor-40", "spectrum-active"),
            ("device", "cpu", "os", "browser", "sha", "metric", "budget", "measured", "date"),
            passing="",
            passes=(),
        ),
        Log(
            "real-audio",
            ("UF-0389-05",),
            "aspect",
            ("seams", "stems", "audio-focus", "output"),
            ("listener", "date", "output_device", "revision", "source", "outcome", "notes"),
        ),
        Log(
            "functional-preservation",
            ("UF-0389-06",),
            "invariant",
            ("no-unsolicited-pause", "exact-ids", "consent", "ready-only", "frozen-flac"),
            ("reviewer", "date", "sha", "outcome"),
        ),
    )
}


def _named(value: object) -> bool:
    return isinstance(value, str) and value.strip(" -") != ""


def entry_problems(spec: Log, entry: dict) -> list[str]:
    """Everything wrong with one row of a log."""
    row = str(entry.get(spec.key, "?"))
    problems = [
        f"{spec.name} {row}: {field} missing"
        for field in spec.fields
        if field not in entry or entry[field] in (None, "", [], "-")
    ]
    if spec.required and entry.get(spec.key) not in spec.required:
        problems.append(f"{spec.name}: unknown {spec.key} {row!r}")
    if "date" in entry and not DATE.match(str(entry["date"])):
        problems.append(f"{spec.name} {row}: date must be YYYY-MM-DD")
    if "sha" in entry and not SHA.match(str(entry["sha"])):
        problems.append(f"{spec.name} {row}: sha must be a commit hash")
    for who in ("reviewer", "listener"):
        if who in entry and not _named(entry[who]):
            problems.append(f"{spec.name} {row}: {who} must be a named person")
    if spec.passes and entry.get(spec.passing) not in (*spec.passes, "fail", "rejected"):
        problems.append(f"{spec.name} {row}: {spec.passing} must be one of {spec.passes}, fail")
    if spec.name == "platform-report":
        missing = [r for r in CORE_ROUTES if r not in (entry.get("routes") or [])]
        if missing:
            problems.append(f"platform-report {row}: core routes not covered: {missing}")
    if spec.name == "real-audio" and entry.get("source") != "real audio":
        problems.append(f"real-audio {row}: source must be 'real audio', never a synthetic test")
    if spec.name == "visual-signoff":
        light, dark = entry.get("light_sha256", ""), entry.get("dark_sha256", "")
        if not (HASH.match(str(light)) and HASH.match(str(dark))) or light == dark:
            problems.append(f"visual-signoff {row}: needs two different capture hashes")
        if entry.get("verdict") == "rejected" and not _named(entry.get("rationale")):
            problems.append(f"visual-signoff {row}: a rejection needs its rationale")
    if spec.name == "benchmarks":
        budget, measured = entry.get("budget"), entry.get("measured")
        if not all(isinstance(v, (int, float)) for v in (budget, measured)):
            problems.append(f"benchmarks {row}: budget and measured must be numbers")
        if str(entry.get("device", "")).lower() in ("laptop", "phone", "desktop", "pc"):
            problems.append(f"benchmarks {row}: device must be a named model, not a class")
    return problems


def log_status(spec: Log, log: dict, required: tuple[str, ...] | None = None) -> list[str]:
    """What this log still needs before its task's person step is done (empty when complete)."""
    entries = log.get("entries", [])
    problems = [p for entry in entries for p in entry_problems(spec, entry)]
    needed = required if required is not None else spec.required
    good = {
        entry.get(spec.key)
        for entry in entries
        if not entry_problems(spec, entry)
        and (not spec.passes or entry.get(spec.passing) in spec.passes)
        and (spec.name != "benchmarks" or entry["measured"] <= entry["budget"])
    }
    problems += [
        f"{spec.name}: no passing {spec.key} {item!r} yet" for item in needed if item not in good
    ]
    if not needed and not entries:
        problems.append(f"{spec.name}: no entries yet")
    return problems


def visual_fixtures(root: Path) -> tuple[str, ...]:
    """The fixture IDs UF-0389-01 must sign, read from docs/adr/completion/visual-evidence.md."""
    text = (root / "docs/adr/completion/visual-evidence.md").read_text(encoding="utf-8")
    table = text.split("## Fixtures", 1)[1].split("\n## ", 1)[0]
    ids: list[str] = []
    for line in table.splitlines():
        if line.startswith("| `"):
            ids += re.findall(r"`([a-z0-9-]+)`", line.split("|")[1])
    return tuple(dict.fromkeys(ids))


def load(root: Path, name: str) -> dict:
    path = root / LOGS / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"entries": []}


def all_status(root: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for name, spec in LOG_SPECS.items():
        required = visual_fixtures(root) if name == "visual-signoff" else None
        out[name] = log_status(spec, load(root, name), required)
    return out


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[3]
    for name, problems in all_status(root).items():
        tasks = ", ".join(LOG_SPECS[name].tasks)
        print(f"{name} ({tasks}): {'complete' if not problems else f'{len(problems)} open'}")
        for problem in problems[:8]:
            print(f"  - {problem}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
