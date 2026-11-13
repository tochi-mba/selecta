"""Review packets for the Final polish (FP) person steps.

Eleven FP tasks end in something only a person can do: an NVDA session, real browser chrome
screenshots, a signed contrast or collision report, a user study or the GO/NO-GO release gate.
This module does the part code can do for each of them, and nothing more:

* ``build`` turns the automated evidence (the FP-0264-02 contrast report, the FP-0271 paired
  manifests, the repo's own inventories) into a packet: every item the person must judge, with
  its evidence, the source SHA, and blank reviewer, date and verdict fields.
* ``check`` reads a packet the person has filled in and lists what is still missing: a named
  reviewer who is not an automation, a date, a full SHA, a verdict and note per item, the fields
  each item needs (screenshot, browser version, device), and any unresolved P0. The release gate
  (FP-0271-08) can only say GO with every pair passed, the denominator complete and zero open P0s.
* ``summarise_study`` and ``compare_studies`` turn timed study records (FP-0267-01/08,
  FP-0268-08) into medians, success rates and false beliefs, and say per task and group whether
  the after-run improved, stayed stable or got worse.

A packet is never verification: ``build`` writes status ``awaiting-person`` and reviewer null,
and ``check`` refuses an automation as the reviewer.

    python -m selecta.audit.fp_review_packets build FP-0264-08 --contrast <json> --out <file>
    python -m selecta.audit.fp_review_packets check <file>
    python -m selecta.audit.fp_review_packets --write    # regenerate the packet index doc

Read-only apart from the files named with --out and --write; no network.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INDEX_DOC = Path("docs/verification/fp-review-packets.md")
STATUS = "awaiting-person"
VERDICTS = ("pass", "fail", "accepted-exception", "not-applicable")
AUTOMATIONS = ("automation", "ci", "claude", "codex", "bot", "playwright", "github-actions")
THEMES = ("light", "dark")

# What each task's packet is built from, what the person does, and which fields every item needs.
TASKS: dict[str, dict] = {
    "FP-0264-06": {
        "title": "Harden menus and form boundaries",
        "kind": "manual",
        "source": "fixed matrix of control types x checks",
        "person": "NVDA with Edge, keyboard alone and 400% zoom on each control type",
        "fields": ("browser_version",),
    },
    "FP-0264-08": {
        "title": "Obtain independent sign-off",
        "kind": "contrast",
        "source": "fp-0264-boundary-contrast.json from web/e2e/fp-theme-boundaries.e2e.ts",
        "person": "a named reviewer resolves or rejects every edge under 3:1, with reason",
        "fields": (),
    },
    "FP-0265-02": {
        "title": "Reproduce or refute chrome mismatch",
        "kind": "chrome-capture",
        "source": "fixed matrix: Chrome and Edge x tab and installed PWA x four theme cases",
        "person": "screenshot of the real browser chrome per case, with browser version",
        "fields": ("screenshot", "browser_version"),
    },
    "FP-0265-08": {
        "title": "Document platform limits and acceptance",
        "kind": "chrome-matrix",
        "source": "expected behaviour and fallback per platform (CHROME_MATRIX below)",
        "person": "a named OS/browser/PWA reviewer records what each platform really does",
        "fields": ("observed", "browser_version"),
    },
    "FP-0266-08": {
        "title": "Independently verify live-theme graphics",
        "kind": "graphics",
        "source": "docs/engineering/music-graphics-inventory.md",
        "person": "a light and dark capture per graphic with real audio, device and verdict",
        "fields": ("screenshot", "device"),
    },
    "FP-0267-01": {
        "title": "Measure current empty-selection clutter",
        "kind": "study",
        "source": "STUDY_TASKS['FP-0267-01'] (before baseline)",
        "person": "time novice and power users on the Library tasks (phase before)",
        "fields": (),
    },
    "FP-0267-08": {
        "title": "Validate benefit without action loss",
        "kind": "study",
        "source": "STUDY_TASKS['FP-0267-08'] (before and after)",
        "person": "novice and expert study with light/dark screenshots and a signed review",
        "fields": (),
    },
    "FP-0268-08": {
        "title": "Validate faster, accurate comparisons",
        "kind": "study",
        "source": "STUDY_TASKS['FP-0268-08'] (pre and post)",
        "person": "uncoached listener and DJ comparison study, pre and post",
        "fields": (),
    },
    "FP-0269-08": {
        "title": "Independently approve no-loss simplification",
        "kind": "parity",
        "source": "docs/engineering/action-tier-register.md",
        "person": "a reviewer finds and completes every registered action, signs the parity report",
        "fields": (),
    },
    "FP-0270-08": {
        "title": "Accept zero critical occlusion defects",
        "kind": "collision",
        "source": "docs/engineering/layer-precedence.md precedence table x COLLISION_DEVICES",
        "person": "signed collision matrix on named devices and browsers",
        "fields": ("browser_version",),
    },
    "FP-0271-08": {
        "title": "Block release on missing critical review",
        "kind": "gate",
        "source": "paired-manifest-*.json and paired-states-manifest-*.json (FP-0271-02)",
        "person": "an independent reviewer judges every pair and signs GO or NO-GO",
        "fields": (),
    },
}

MANUAL_CONTROLS = (
    "text field",
    "dropdown (select)",
    "combobox",
    "dialog actions",
    "disabled control",
    "menu",
)
MANUAL_CHECKS = (
    ("nvda-edge", "NVDA with Edge announces its name, role, state and edge-carried meaning"),
    ("keyboard", "the keyboard alone reaches, operates and leaves it, focus always visible"),
    ("zoom-400", "at 400% zoom its boundary, label and state stay perceivable without scrolling"),
)

CHROME_CASES = (("Light", "dark"), ("Dark", "light"), ("System", "light"), ("System", "dark"))

# FP-0265-08: what the app does on each platform and the fallback when the platform ignores it.
# "expected" is the design intent; the person records "observed".
CHROME_MATRIX = (
    (
        "chrome-desktop-tab",
        "Chrome desktop, ordinary tab",
        "the tab strip follows the browser's own theme; theme-color is not used here",
        "the page itself always shows the chosen theme, so nothing contradicts it",
    ),
    (
        "edge-desktop-tab",
        "Edge desktop, ordinary tab",
        "the tab strip follows the browser's own theme; theme-color is not used here",
        "the page itself always shows the chosen theme",
    ),
    (
        "chrome-pwa",
        "Chrome installed app window",
        "the title bar takes the theme-color the app rewrites on every theme choice",
        "if a version reads it only at launch, the bar still uses a legible chosen colour",
    ),
    (
        "edge-pwa",
        "Edge installed app window",
        "the title bar takes the theme-color the app rewrites on every theme choice",
        "if a version reads it only at launch, the bar still uses a legible chosen colour",
    ),
    (
        "android-chrome",
        "Chrome on Android",
        "the address bar follows the theme-color, including a change without reload",
        "browser default bar; the page keeps the chosen theme",
    ),
    (
        "ios-safari",
        "Safari on iPhone",
        "the toolbar tint follows the theme-color tags",
        "Safari's own tint; the page keeps the chosen theme",
    ),
    (
        "firefox-desktop",
        "Firefox desktop",
        "theme-color is not supported; browser chrome follows Firefox's theme",
        "browser default chrome; the page keeps the chosen theme",
    ),
    (
        "forced-colours",
        "Windows High Contrast (any browser)",
        "browser chrome follows the system contrast theme",
        "system colours; the page uses forced-colour styles",
    ),
)

COLLISION_DEVICES = (
    ("iphone-safari", "iPhone with a notch, Safari"),
    ("android-chrome", "Android phone, Chrome"),
    ("windows-edge", "Windows laptop, Edge"),
)

# Study tasks: (task id, what the participant is asked, groups, phases needed)
STUDY_TASKS: dict[str, dict] = {
    "FP-0267-01": {
        "groups": ("novice", "power"),
        "phases": ("before",),
        "tasks": (
            ("browse", "find a song you like in the Library and play it, with no help"),
            ("select-three", "select three songs and move them up the queue together"),
            ("clear", "clear the selection and carry on browsing"),
        ),
    },
    "FP-0267-08": {
        "groups": ("novice", "power"),
        "phases": ("before", "after"),
        "tasks": (
            ("browse", "find a song you like in the Library and play it, with no help"),
            ("select-three", "select three songs and move them up the queue together"),
            ("clear", "clear the selection and carry on browsing"),
        ),
    },
    "FP-0268-08": {
        "groups": ("listener", "dj"),
        "phases": ("pre", "post"),
        "tasks": (
            ("choose", "pick the Explore idea that best fits a given brief"),
            ("eligible", "say which ideas can be built from your library right now"),
            ("outcome", "say what Play, Shape first and Save draft will each do"),
        ),
    },
}


def source_sha(root: Path = ROOT) -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout.strip() or None


def _item(item_id: str, ask: str, severity: str, evidence: str, fields: tuple[str, ...]) -> dict:
    item = {
        "id": item_id,
        "ask": ask,
        "severity": severity,
        "evidence": evidence,
        "verdict": None,
        "note": "",
    }
    for field in fields:
        item[field] = ""
    return item


def _table_rows(markdown: str, first_header: str) -> list[list[str]]:
    """Body rows of the first Markdown table whose first header cell is ``first_header``."""
    rows: list[list[str]] = []
    inside = False
    for line in markdown.splitlines():
        if not line.startswith("|"):
            if inside:
                break
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not inside:
            inside = cells[0] == first_header
            continue
        if set("".join(cells)) <= {"-", ":"}:
            continue
        rows.append(cells)
    return rows


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("`", "")).strip("-")


def contrast_items(report: dict) -> list[dict]:
    """FP-0264-08: every measured edge under the threshold, essential ones as P0."""
    threshold = float(report.get("threshold", 3))
    items: dict[str, dict] = {}
    for edge in report.get("edges", []):
        if float(edge["edge"]) >= threshold:
            continue
        item_id = "/".join(
            [edge["state"], edge["theme"], edge["component"], _slug(edge.get("label", "")) or "-"]
        )
        if item_id in items:
            continue
        severity = "P0" if edge.get("essential") else "exempt"
        evidence = (
            f"{float(edge['edge']):.2f}:1 on {edge['surface']} "
            f"(role {edge['role']}, threshold {threshold:g}:1)"
        )
        ask = (
            "resolve this functional edge, or reject it with a reason"
            if severity == "P0"
            else "confirm the recorded exemption, or reject it"
        )
        items[item_id] = _item(item_id, ask, severity, evidence, ())
    return list(items.values())


def manual_items() -> list[dict]:
    return [
        _item(
            f"{_slug(control)}/{check}",
            f"{control}: {ask}",
            "P0",
            "automated edge contrast in fp-0264-boundary-contrast.json",
            ("browser_version",),
        )
        for control in MANUAL_CONTROLS
        for check, ask in MANUAL_CHECKS
    ]


def chrome_capture_items() -> list[dict]:
    items = []
    for browser in ("Chrome", "Edge"):
        for surface in ("tab toolbar", "installed app title bar"):
            for choice, os_scheme in CHROME_CASES:
                item_id = f"{browser}/{_slug(surface)}/{choice.lower()}-on-os-{os_scheme}"
                ask = (
                    f"{browser} {surface}: app set to {choice}, OS set to {os_scheme}; "
                    "screenshot the real chrome and say whether it matches the page"
                )
                items.append(
                    _item(
                        item_id,
                        ask,
                        "P1",
                        "web/e2e/fp-first-paint.e2e.ts covers the page and theme-color tags",
                        ("screenshot", "browser_version"),
                    )
                )
    return items


def chrome_matrix_items() -> list[dict]:
    return [
        _item(
            key,
            f"{name}: record what the chrome really does",
            "P1",
            f"expected: {expected}; fallback: {fallback}",
            ("observed", "browser_version"),
        )
        for key, name, expected, fallback in CHROME_MATRIX
    ]


def graphics_items(inventory_md: str) -> list[dict]:
    items = []
    for cells in _table_rows(inventory_md, "Graphic"):
        graphic, state, source = cells[0], cells[1], cells[2]
        for theme in THEMES:
            items.append(
                _item(
                    f"{_slug(graphic)}/{_slug(state)}/{theme}",
                    f"{graphic} ({state}) in {theme}, playing real audio: "
                    "capture it and judge whether the meaning reads",
                    "P0",
                    f"source {source}; treatment {cells[4]}",
                    ("screenshot", "device"),
                )
            )
    return items


def parity_items(register_md: str) -> list[dict]:
    items = []
    for cells in _table_rows(register_md, "Surface"):
        surface, state, action, tier = cells[0], cells[1], cells[2], cells[3]
        items.append(
            _item(
                f"{_slug(surface)}/{_slug(state)}/{_slug(action)}",
                f"{surface} ({state}): find and complete {action} without help",
                "P0" if tier == "primary" else "P1",
                f"tier {tier}; {cells[5]}; {cells[6]}",
                (),
            )
        )
    return items


def collision_items(precedence_md: str) -> list[dict]:
    items = []
    for cells in _table_rows(precedence_md, "Situation"):
        situation, stays = cells[0], cells[2]
        for key, device in COLLISION_DEVICES:
            items.append(
                _item(
                    f"{_slug(situation)}/{key}",
                    f"{situation} on {device}: is anything that must stay "
                    f"({stays}) covered or unreachable?",
                    "P0",
                    f"yields: {cells[1]}",
                    ("browser_version",),
                )
            )
    return items


def gate_items(manifests: list[dict]) -> tuple[list[dict], dict]:
    """FP-0271-08: one item per Light/Dark pair, plus the denominator."""
    pairs: dict[str, dict] = {}
    required = captured = 0
    shas = set()
    for manifest in manifests:
        required += int(manifest.get("required", 0))
        captured += int(manifest.get("captured", 0))
        if manifest.get("sourceSha"):
            shas.add(manifest["sourceSha"])
        for cand in manifest.get("candidates", []):
            key = f"{cand['id']}@{cand['width']}x{cand['height']}"
            pair = pairs.setdefault(key, {})
            pair[cand["theme"]] = cand
    items = []
    for key, pair in sorted(pairs.items()):
        shots = ", ".join(pair[t]["screenshot"] for t in THEMES if t in pair)
        same = len({pair[t]["semanticSha256"] for t in THEMES if t in pair}) == 1
        missing = [t for t in THEMES if t not in pair]
        evidence = f"{shots}; semantics {'equal' if same else 'DIFFER'}"
        if missing:
            evidence += f"; missing {', '.join(missing)}"
        items.append(
            _item(
                key,
                "compare the Light and Dark captures: same meaning, legible",
                "P0",
                evidence,
                (),
            )
        )
    denominator = {
        "required_captures": required,
        "captured": captured,
        "pairs": len(pairs),
        "manifest_source_shas": sorted(shas),
    }
    return items, denominator


def study_items(task_id: str) -> list[dict]:
    spec = STUDY_TASKS[task_id]
    return [
        _item(f"{task}/{group}", f"{group}: {ask}", "P0", f"phases {', '.join(spec['phases'])}", ())
        for task, ask in spec["tasks"]
        for group in spec["groups"]
    ]


def build(
    task_id: str,
    *,
    root: Path = ROOT,
    contrast: dict | None = None,
    manifests: list[dict] | None = None,
    sha: str | None = None,
    today: dt.date | None = None,
) -> dict:
    """A blank packet for ``task_id``, pre-filled with every item and its automated evidence."""
    if task_id not in TASKS:
        raise KeyError(f"{task_id} is not an FP person step")
    spec = TASKS[task_id]
    kind = spec["kind"]
    extra: dict = {}
    if kind == "contrast":
        if contrast is None:
            raise ValueError("FP-0264-08 needs the contrast report (--contrast)")
        items = contrast_items(contrast)
        extra["measured_edges"] = contrast.get("measured", len(contrast.get("edges", [])))
    elif kind == "manual":
        items = manual_items()
    elif kind == "chrome-capture":
        items = chrome_capture_items()
    elif kind == "chrome-matrix":
        items = chrome_matrix_items()
    elif kind == "graphics":
        text = (root / "docs/engineering/music-graphics-inventory.md").read_text("utf-8")
        items = graphics_items(text)
    elif kind == "parity":
        text = (root / "docs/engineering/action-tier-register.md").read_text("utf-8")
        items = parity_items(text)
    elif kind == "collision":
        text = (root / "docs/engineering/layer-precedence.md").read_text("utf-8")
        items = collision_items(text)
    elif kind == "gate":
        if not manifests:
            raise ValueError("FP-0271-08 needs the paired manifests (--manifest)")
        items, extra["denominator"] = gate_items(manifests)
        extra["decision"] = None
    else:
        items = study_items(task_id)
        extra["records"] = []
    return {
        "task": task_id,
        "title": spec["title"],
        "status": STATUS,
        "person_step": spec["person"],
        "built_from": spec["source"],
        "source_sha": sha if sha is not None else source_sha(root),
        "generated_on": (today or dt.date.today()).isoformat(),
        "reviewer": None,
        "reviewed_on": None,
        **extra,
        "items": items,
    }


def open_p0(packet: dict) -> list[str]:
    return [
        item["id"]
        for item in packet.get("items", [])
        if item.get("severity") == "P0" and item.get("verdict") in (None, "fail")
    ]


def check(packet: dict) -> list[str]:
    """Everything still missing from a filled packet; empty means ready for the checklist."""
    problems: list[str] = []
    task_id = packet.get("task")
    if task_id not in TASKS:
        return [f"unknown task {task_id!r}"]
    spec = TASKS[task_id]
    reviewer = (packet.get("reviewer") or "").strip()
    if not reviewer:
        problems.append("no named reviewer")
    elif (
        any(word in reviewer.lower().split() for word in AUTOMATIONS)
        or reviewer.lower() in AUTOMATIONS
    ):
        problems.append(f"reviewer {reviewer!r} is an automation; a person must sign")
    try:
        dt.date.fromisoformat(str(packet.get("reviewed_on")))
    except ValueError:
        problems.append("reviewed_on is not a date (YYYY-MM-DD)")
    if not re.fullmatch(r"[0-9a-f]{40}", str(packet.get("source_sha") or "")):
        problems.append("source_sha is not a full 40-character SHA")
    for item in packet.get("items", []):
        verdict = item.get("verdict")
        if verdict not in VERDICTS:
            problems.append(f"{item['id']}: no verdict")
            continue
        if (
            verdict in ("fail", "accepted-exception", "not-applicable")
            and not str(item.get("note", "")).strip()
        ):
            problems.append(f"{item['id']}: a {verdict} verdict needs a reason in note")
        if verdict != "not-applicable":
            for field in spec["fields"]:
                if not str(item.get(field, "")).strip():
                    problems.append(f"{item['id']}: {field} is empty")
    if spec["kind"] == "study":
        problems.extend(_check_study(task_id, packet.get("records", [])))
    if spec["kind"] == "gate":
        problems.extend(_check_gate(packet))
    elif open_p0(packet) and not any(p.endswith("no verdict") for p in problems):
        problems.append(f"{len(open_p0(packet))} P0 item(s) failed and are unresolved")
    return problems


def _check_gate(packet: dict) -> list[str]:
    decision = packet.get("decision")
    if decision not in ("GO", "NO-GO"):
        return ["decision must be GO or NO-GO"]
    if decision == "NO-GO":
        return []
    problems = []
    den = packet.get("denominator", {})
    if den.get("captured", 0) < den.get("required_captures", 0) or not den.get("pairs"):
        problems.append("GO with an incomplete pair denominator")
    if open_p0(packet):
        problems.append(f"GO with {len(open_p0(packet))} open P0 pair(s)")
    if any(item.get("verdict") != "pass" for item in packet.get("items", [])):
        problems.append("GO needs every pair passed")
    return problems


def _check_study(task_id: str, records: list[dict]) -> list[str]:
    spec = STUDY_TASKS[task_id]
    problems = []
    for record in records:
        if record.get("group") not in spec["groups"] or record.get("phase") not in spec["phases"]:
            problems.append(f"record {record.get('participant')!r}: unknown group or phase")
    for phase in spec["phases"]:
        for group in spec["groups"]:
            for task, _ask in spec["tasks"]:
                if not any(
                    r.get("phase") == phase and r.get("group") == group and r.get("task") == task
                    for r in records
                ):
                    problems.append(f"no {phase} record for {group} on {task}")
    if len(spec["phases"]) == 2 and not problems:
        before, after = spec["phases"]
        for key, verdict in compare_studies(records, before, after).items():
            if verdict == "worse":
                problems.append(f"{key}: the {after} run is worse than {before}")
    return problems


def summarise_study(records: list[dict]) -> dict[str, dict]:
    """Per phase/group/task: participants, median seconds, success rate and false beliefs."""
    grouped: dict[str, list[dict]] = {}
    for record in records:
        key = f"{record['phase']}/{record['group']}/{record['task']}"
        grouped.setdefault(key, []).append(record)
    out = {}
    for key, rows in sorted(grouped.items()):
        out[key] = {
            "n": len(rows),
            "median_seconds": statistics.median(float(r["seconds"]) for r in rows),
            "success_rate": sum(1 for r in rows if r.get("success")) / len(rows),
            "false_beliefs": sum(int(r.get("false_beliefs", 0)) for r in rows),
        }
    return out


def compare_studies(
    records: list[dict], before: str, after: str, tolerance: float = 0.10
) -> dict[str, str]:
    """``improved``, ``stable`` or ``worse`` per group/task, after against before."""
    summary = summarise_study(records)
    out = {}
    for key, then in summary.items():
        phase, rest = key.split("/", 1)
        if phase != before or f"{after}/{rest}" not in summary:
            continue
        now = summary[f"{after}/{rest}"]
        slower = now["median_seconds"] > then["median_seconds"] * (1 + tolerance)
        less_success = now["success_rate"] < then["success_rate"] - tolerance
        more_false = now["false_beliefs"] > then["false_beliefs"]
        if slower or less_success or more_false:
            out[rest] = "worse"
        elif (
            now["median_seconds"] < then["median_seconds"] * (1 - tolerance)
            or now["success_rate"] > then["success_rate"] + tolerance
        ):
            out[rest] = "improved"
        else:
            out[rest] = "stable"
    return out


def render_index() -> str:
    lines = [
        "# FP review packets: what each Final polish person step is handed",
        "",
        "Generated by `python -m selecta.audit.fp_review_packets --write`; do not edit by hand.",
        "",
        "Each packet is built from the automated evidence, carries the source SHA and leaves "
        "reviewer, date and every verdict blank. A packet is never verification: "
        "`check` refuses an automation as reviewer and any unresolved P0.",
        "",
        "| Task | Title | Built from | The person | Item fields |",
        "|---|---|---|---|---|",
    ]
    for task_id, spec in TASKS.items():
        fields = ", ".join(("verdict", "note", *spec["fields"]))
        lines.append(
            f"| {task_id} | {spec['title']} | {spec['source']} | {spec['person']} | {fields} |"
        )
    lines += [
        "",
        "Build one: `python -m selecta.audit.fp_review_packets build <task> --out <file>` "
        "(add `--contrast <fp-0264-boundary-contrast.json>` for FP-0264-08, and "
        "`--manifest <file>` per paired manifest for FP-0271-08). Fill it in, then "
        "`python -m selecta.audit.fp_review_packets check <file>` lists what is missing. "
        "Study packets take `records`: one row per participant and task with `participant`, "
        "`group`, `phase`, `task`, `seconds`, `success` and `false_beliefs`; use no names.",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true", help="regenerate the packet index doc")
    sub = parser.add_subparsers(dest="command")
    b = sub.add_parser("build")
    b.add_argument("task")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--contrast", type=Path)
    b.add_argument("--manifest", type=Path, action="append", default=[])
    c = sub.add_parser("check")
    c.add_argument("packet", type=Path)
    args = parser.parse_args(argv)
    if args.write:
        (ROOT / INDEX_DOC).write_text(render_index(), encoding="utf-8", newline="\n")
        print(f"wrote {INDEX_DOC}")
        return 0
    if args.command == "build":
        contrast = json.loads(args.contrast.read_text("utf-8")) if args.contrast else None
        manifests = [json.loads(p.read_text("utf-8")) for p in args.manifest]
        packet = build(args.task, contrast=contrast, manifests=manifests)
        args.out.write_text(json.dumps(packet, indent=2) + "\n", encoding="utf-8")
        print(f"{args.task}: {len(packet['items'])} items -> {args.out}")
        return 0
    if args.command == "check":
        problems = check(json.loads(args.packet.read_text("utf-8")))
        for problem in problems:
            print(problem)
        print("ready" if not problems else f"{len(problems)} problem(s)")
        return 1 if problems else 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
