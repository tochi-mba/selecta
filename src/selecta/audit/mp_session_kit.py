"""MP person-step session kit: the code part of every open MP task that ends with a person.

`docs/verification/mp-session-kit.json` holds, per task, who does it, the routes, the setup, the
uncoached wording, the pass rule and the automated prechecks that must be green first. This module
checks that data against the repo (every precheck test exists, every route is inventoried) and
renders `docs/verification/mp-session-kit.md`, including two tables computed from the defect
register: the critical adjustments a reviewer signs (MP-0299-02) and the release decision sheet
(MP-0299-08). Sign-offs live apart from anything generated, in `mp-signoffs.json`, and are
validated here; code never writes one.

    python -m selecta.audit.mp_session_kit --write   # regenerate the page
    python -m selecta.audit.mp_session_kit --check   # exit 1 when stale or invalid
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
KIT = ROOT / "docs/verification/mp-session-kit.json"
SIGNOFFS = ROOT / "docs/verification/mp-signoffs.json"
PAGE = ROOT / "docs/verification/mp-session-kit.md"
REGISTER = ROOT / "docs/adr/mp-0272-defect-register.md"
INVENTORY = ROOT / "docs/adr/mp-0272-surface-inventory.json"

SITTINGS = {
    "visual": "Visual review",
    "screen-reader": "Screen reader and accessibility",
    "device": "Real devices",
    "listening": "Listening",
    "study": "User studies",
    "sign-off": "Sign-off",
}
OUTCOMES = {"pass", "fail", "accept", "reject", "GO", "NO-GO"}
NOT_A_PERSON = re.compile(r"\b(claude|codex|agent|bot|automat\w*|ci|playwright)\b", re.I)
ROW = re.compile(
    r"^\| (D-\d+) \| (P[01]) \| `([^`]*)` \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*) \|$"
)
GATE = {
    "hidden CTA": "web/e2e/mp-baseline.mp.ts",
    "wrong-mix change": "web/e2e/mp-0286-my-mixes.e2e.ts",
    "lost sound": "web/e2e/mp-0281-mini-player.e2e.ts",
    "inaccessible control": "web/e2e/mp-0298-responsive-and-a11y.e2e.ts",
    "privacy breach": "web/e2e/mp-0294-export-and-study.e2e.ts",
}


@dataclass(frozen=True)
class Defect:
    id: str
    severity: str
    key: str
    viewports: str
    baseline: str
    target: str
    status: str

    @property
    def open(self) -> bool:
        return not re.search(r"\*\*(Fixed|Exception)", self.status)


def load_kit(path: Path = KIT) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def defects(path: Path = REGISTER) -> list[Defect]:
    found = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if match:
            g = match.groups()
            found.append(Defect(g[0], g[1], g[2], g[5], g[6], g[7], g[8]))
    return found


def precheck_exists(file: str, title: str) -> bool:
    path = ROOT / file
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    if file.endswith(".py"):
        return re.search(rf"^def {re.escape(title)}\(", text, re.M) is not None
    return title in text


def problems(kit: dict, signoffs: dict) -> list[str]:
    found = []
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    routes = {route["path"] for route in inventory["routes"]}
    ids = [task["id"] for task in kit["tasks"]]
    if len(ids) != len(set(ids)):
        found.append("a task is listed twice")
    for task in kit["tasks"]:
        tid = task["id"]
        if task["sitting"] not in SITTINGS:
            found.append(f"{tid}: unknown sitting {task['sitting']!r}")
        for key in ("who", "setup", "pass"):
            if not task.get(key):
                found.append(f"{tid}: no {key}")
        if not task.get("steps"):
            found.append(f"{tid}: no steps")
        if not task.get("prechecks"):
            found.append(f"{tid}: no automated precheck")
        for route in task.get("routes", []):
            if route not in routes:
                found.append(f"{tid}: route {route} is not in the surface inventory")
        for file, title in task.get("prechecks", []):
            if not precheck_exists(file, title):
                found.append(f"{tid}: precheck {file} :: {title} not found")
    for n, record in enumerate(signoffs.get("records", [])):
        where = f"sign-off {n + 1}"
        if record.get("task") not in ids:
            found.append(f"{where}: task {record.get('task')!r} is not in the kit")
        person = str(record.get("person", "")).strip()
        if not person or NOT_A_PERSON.search(person):
            found.append(f"{where}: person must be a named human")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(record.get("date", ""))):
            found.append(f"{where}: date must be YYYY-MM-DD")
        if not re.fullmatch(r"[0-9a-f]{40}", str(record.get("commit", ""))):
            found.append(f"{where}: commit must be a full 40-character SHA")
        if record.get("outcome") not in OUTCOMES:
            found.append(f"{where}: outcome must be one of {sorted(OUTCOMES)}")
        if not record.get("role"):
            found.append(f"{where}: no role")
    return found


def signed(signoffs: dict, task_id: str) -> list[dict]:
    return [r for r in signoffs.get("records", []) if r.get("task") == task_id]


def render(kit: dict, signoffs: dict, register: list[Defect]) -> str:
    out = [
        "# MP person-step session kit",
        "",
        "Generated by `python -m selecta.audit.mp_session_kit --write` from",
        "`mp-session-kit.json`, `mp-signoffs.json` and `docs/adr/mp-0272-defect-register.md`;",
        "do not edit by hand. Code prepared each session below (setup, wording, pass rule and the",
        "automated prechecks to run first); what is left is the person's part. Record every result",
        "in `mp-signoffs.json` (a person, role, date, full commit SHA and outcome), never in a",
        "generated file.",
        "",
        f"Server: {kit['server']}.",
        "",
        f"Tasks: {len(kit['tasks'])}. Signed: "
        f"{sum(1 for t in kit['tasks'] if signed(signoffs, t['id']))}.",
        "",
    ]
    for sitting, name in SITTINGS.items():
        tasks = [t for t in kit["tasks"] if t["sitting"] == sitting]
        if not tasks:
            continue
        out += [f"## {name}", ""]
        for task in tasks:
            records = signed(signoffs, task["id"])
            state = ", ".join(f"{r['outcome']} by {r['person']} {r['date']}" for r in records)
            out += [f"### {task['id']}", "", f"- **Who:** {task['who']}"]
            if task["routes"]:
                out.append("- **Routes:** " + ", ".join(f"`{r}`" for r in task["routes"]))
            out.append(f"- **Setup:** {task['setup']}")
            out.append("- **Steps:**")
            out += [f"  {i}. {step}" for i, step in enumerate(task["steps"], 1)]
            out.append(f"- **Pass:** {task['pass']}")
            out.append("- **Run first (automated part):**")
            out += [f"  - `{file}` :: {title}" for file, title in task["prechecks"]]
            out += [f"- **Signed:** {state or 'not yet'}", ""]
    out += [
        "## MP-0299-02 critical adjustments to accept or reject",
        "",
        "| ID | Sev | Key | Viewports | Measured baseline | Target | Register status |",
        "|---|---|---|---|---|---|---|",
    ]
    for d in register:
        status = "open" if d.open else ("fixed" if "Fixed" in d.status else "exception")
        out.append(
            f"| {d.id} | {d.severity} | `{d.key}` | {d.viewports} | {d.baseline} | "
            f"{d.target} | {status} |"
        )
    open_p0 = [d.id for d in register if d.severity == "P0" and d.open]
    open_p1 = [d.id for d in register if d.severity == "P1" and d.open]
    out += [
        "",
        "## MP-0298-08 critical-regression gate",
        "",
        "| Category | Gate spec |",
        "|---|---|",
    ]
    out += [f"| {category} | `{spec}` |" for category, spec in GATE.items()]
    out += [
        "",
        "## MP-0299-08 release decision sheet",
        "",
        f"- Open P0 in the register: {len(open_p0)} ({', '.join(open_p0) or 'none'}).",
        f"- Open P1 in the register: {len(open_p1)} ({', '.join(open_p1) or 'none'}); "
        "each needs a disposition.",
        "- Rollback: `python tests/rollback_check.py <older checkout>`.",
        "- Exact SHA: `git rev-parse HEAD` at the build you sign.",
        "- Decision: GO or NO-GO, signed in `mp-signoffs.json` by the owner.",
        "",
    ]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    kit, signoffs = load_kit(), json.loads(SIGNOFFS.read_text(encoding="utf-8"))
    found = problems(kit, signoffs)
    for problem in found:
        print(problem)
    page = render(kit, signoffs, defects())
    if "--write" in argv:
        PAGE.write_text(page, encoding="utf-8", newline="\n")
    elif not PAGE.exists() or PAGE.read_text(encoding="utf-8") != page:
        print(f"{PAGE.name} is out of date; run with --write")
        return 1
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
