"""Owner verification runbook: every open "Needs a person" checklist task, grouped into sittings.

The checklists in docs/adr/implementation-checklist.md and docs/adr/*-implementation-checklist.md
are the source of truth. This module reads every unticked task whose line says "Needs a person",
files it into one sitting (a listening session, a screen-reader session, a phone session and so
on), and writes the task lists of docs/verification/owner-runbook.md plus one tracker table per
sitting under docs/verification/tracker/. The step-by-step scripts live in
owner_runbook_sittings.py.

    python -m selecta.audit.owner_runbook --write   # regenerate after checklists change
    python -m selecta.audit.owner_runbook --check   # exit 1 when the runbook is out of date

Read-only apart from --write: no network, never edits a checklist line.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from selecta.audit.owner_runbook_sittings import (
    CLASSIFY_ORDER,
    OVERRIDES,
    SITTINGS,
    Sitting,
)

ADR_DIR = "docs/adr"
OUT_DIR = "docs/verification"
RUNBOOK = "owner-runbook.md"
ORIGINAL_CHECKLIST = "implementation-checklist.md"
TRACKER_DIR = "tracker"
NEED = "Needs a person"
ID = r"[A-Z][A-Z0-9]*-?\d{4}(?:-\d{2})?"
BOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(?:\*\*)?(" + ID + r")(?![\w-])")
TITLE = re.compile(r"^\s*[-*]\s+\[.\]\s+(?:\*\*)?" + ID + r"\s*-\s*(.+?)(?:\*\*|$)")
IMPL = re.compile(r"Implementation:?\**:?\s*\**\s*(Not started|In progress|Implemented|Partly)")
MARKUP = re.compile(r"\*\*|`")
MAX_WHAT = 240
BEGIN = "<!-- owner-runbook:generated:begin -->"
END = "<!-- owner-runbook:generated:end -->"


@dataclass(frozen=True)
class Task:
    """One open checklist task that only a person can close."""

    task_id: str
    checklist: str
    title: str
    need: str
    state: str
    sitting: str


def _need_text(line: str) -> str:
    """The words after the last "Needs a person:" (the most specific ask), without markup."""
    at = line.rfind(NEED + ":")
    if at < 0:
        at = line.rfind(NEED)
    text = line[at + len(NEED) :].lstrip(":. ")
    text = MARKUP.sub("", text).strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > MAX_WHAT:
        text = text[: MAX_WHAT - 3].rstrip() + "..."
    return text.replace("|", "/")


def _state(line: str) -> str:
    found = IMPL.search(line)
    if found:
        return found.group(1)
    if "Implemented (automated)" in line:
        return "Implemented"
    return "Open"


def classify(task_id: str, text: str) -> str:
    """Pick the sitting for a task: an override, else the first sitting whose words match."""
    if task_id in OVERRIDES:
        return OVERRIDES[task_id]
    by_slug = {sitting.slug: sitting for sitting in SITTINGS}
    for slug in CLASSIFY_ORDER:
        words = by_slug[slug].words
        if any(re.search(rf"\b(?:{word})", text, re.IGNORECASE) for word in words):
            return slug
    return CLASSIFY_ORDER[-1]


def parse_checklist(path: Path) -> list[Task]:
    """Every unticked line in one checklist that says it needs a person."""
    tasks: list[Task] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        box = BOX.match(line)
        if not box or box.group(1) != " " or NEED not in line:
            continue
        task_id = box.group(2)
        title_match = TITLE.match(line)
        title = MARKUP.sub("", title_match.group(1)).strip().rstrip(".") if title_match else ""
        title = title.replace("|", "/")
        need = _need_text(line)
        tasks.append(
            Task(
                task_id=task_id,
                checklist=path.name,
                title=title,
                need=need,
                state=_state(line),
                sitting=classify(task_id, f"{title} {need}"),
            )
        )
    return tasks


def collect(root: Path) -> list[Task]:
    """All open person-only tasks across every implementation checklist, in file order."""
    tasks: list[Task] = []
    for path in checklist_paths(root):
        tasks.extend(parse_checklist(path))
    return tasks


def checklist_paths(root: Path) -> list[Path]:
    """The Selecta 2.0 checklist (implementation-checklist.md, no prefix) first, then the rest."""
    adr = root / ADR_DIR
    paths = sorted(adr.glob("*-implementation-checklist.md"))
    original = adr / ORIGINAL_CHECKLIST
    return ([original] if original.is_file() else []) + paths


def _by_sitting(tasks: list[Task]) -> dict[str, list[Task]]:
    grouped: dict[str, list[Task]] = {sitting.slug: [] for sitting in SITTINGS}
    for task in tasks:
        grouped[task.sitting].append(task)
    return grouped


def _id_list(tasks: list[Task]) -> str:
    """Task IDs grouped by checklist, so a sitting's closing list reads at a glance."""
    lines: list[str] = []
    by_file: dict[str, list[str]] = {}
    for task in tasks:
        by_file.setdefault(task.checklist, []).append(task.task_id)
    for name, ids in by_file.items():
        lines.append(f"- `{name}` ({len(ids)}): {', '.join(ids)}")
    return "\n".join(lines) if lines else "- None open."


def render_generated(tasks: list[Task]) -> str:
    """The generated block of the runbook: counts per sitting and the IDs each one closes."""
    grouped = _by_sitting(tasks)
    out = [BEGIN, "", f"**Open person-only tasks: {len(tasks)}.**", ""]
    out.append("| Sitting | Tasks | Tracker |")
    out.append("|---|---|---|")
    for sitting in SITTINGS:
        link = f"[{TRACKER_DIR}/{sitting.slug}.md]({TRACKER_DIR}/{sitting.slug}.md)"
        out.append(f"| {sitting.number}. {sitting.name} | {len(grouped[sitting.slug])} | {link} |")
    out.append("")
    for sitting in SITTINGS:
        out.append(f"### Task IDs closed by sitting {sitting.number}: {sitting.name}")
        out.append("")
        out.append(_id_list(grouped[sitting.slug]))
        out.append("")
    out.append(END)
    return "\n".join(out)


def render_runbook(tasks: list[Task]) -> str:
    """The whole runbook: hand-written sitting scripts plus the generated task lists."""
    from selecta.audit.owner_runbook_sittings import INTRO, OUTRO

    parts = [INTRO.strip(), ""]
    for sitting in SITTINGS:
        parts.append(_sitting_script(sitting))
    parts.append("## What each sitting closes")
    parts.append("")
    parts.append(render_generated(tasks))
    parts.append("")
    parts.append(OUTRO.strip())
    return "\n".join(parts) + "\n"


def _sitting_script(sitting: Sitting) -> str:
    out = [f"## Sitting {sitting.number}: {sitting.name}", "", sitting.summary.strip(), ""]
    out.append("**Before you start:**")
    out.append("")
    out.extend(f"- {step}" for step in sitting.prepare)
    out.append("")
    out.append("**Steps:**")
    out.append("")
    out.extend(f"{index}. {step}" for index, step in enumerate(sitting.steps, start=1))
    out.append("")
    out.append(f"**Pass:** {sitting.passes.strip()}")
    out.append("")
    out.append(f"**Record:** {sitting.record.strip()}")
    out.append("")
    out.append(f"Tracker: [{TRACKER_DIR}/{sitting.slug}.md]({TRACKER_DIR}/{sitting.slug}.md)")
    out.append("")
    return "\n".join(out)


def render_tracker(sitting: Sitting, tasks: list[Task]) -> str:
    """One sitting's tracker table: task ID, checklist, what the person must do, status."""
    out = [
        f"# Tracker: sitting {sitting.number}, {sitting.name}",
        "",
        "Generated by `python -m selecta.audit.owner_runbook --write`; do not edit by hand.",
        "Status is the checklist line's own implementation state. A task leaves this table when",
        "its checklist box is ticked with evidence and the runbook is regenerated.",
        "",
        f"Open tasks: {len(tasks)}. Script: [../{RUNBOOK}](../{RUNBOOK}).",
        "",
        "| Task ID | Checklist | Task | What the person does | Sitting | Status |",
        "|---|---|---|---|---|---|",
    ]
    for task in tasks:
        out.append(
            f"| {task.task_id} | {task.checklist} | {task.title} | {task.need} "
            f"| {sitting.number} | {task.state}; open |"
        )
    return "\n".join(out) + "\n"


def expected_files(root: Path) -> dict[Path, str]:
    """Every file the runbook consists of, keyed by path, with the content it should have."""
    tasks = collect(root)
    grouped = _by_sitting(tasks)
    out_dir = root / OUT_DIR
    files = {out_dir / RUNBOOK: render_runbook(tasks)}
    for sitting in SITTINGS:
        path = out_dir / TRACKER_DIR / f"{sitting.slug}.md"
        files[path] = render_tracker(sitting, grouped[sitting.slug])
    return files


def stale(root: Path) -> list[str]:
    """Runbook files that are missing or differ from what the checklists say now."""
    found: list[str] = []
    for path, content in expected_files(root).items():
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current != content:
            found.append(str(path.relative_to(root)).replace("\\", "/"))
    return found


def write(root: Path) -> list[Path]:
    """Regenerate the runbook and trackers; return the paths written."""
    written: list[Path] = []
    for path, content in expected_files(root).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path.cwd())
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="regenerate the runbook files")
    mode.add_argument("--check", action="store_true", help="exit 1 when the runbook is stale")
    args = parser.parse_args(argv)
    if args.write:
        for path in write(args.root):
            print(f"wrote {path.relative_to(args.root)}")
        return 0
    if args.check:
        out_of_date = stale(args.root)
        for name in out_of_date:
            print(f"stale: {name} (run python -m selecta.audit.owner_runbook --write)")
        return 1 if out_of_date else 0
    grouped = _by_sitting(collect(args.root))
    for sitting in SITTINGS:
        print(f"{sitting.number}. {sitting.name}: {len(grouped[sitting.slug])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
