"""Keep the S4/EX crosswalk equal to the task lines it summarises (EX-0114-02).

    python -m selecta.audit.ex_crosswalk           # list rows that disagree with the lines
    python -m selecta.audit.ex_crosswalk --write   # rewrite only those counts

`docs/adr/selecta-experience-status-reconciliation.md` keeps PR #29's claims apart from what each
S4 task line records: one row per ADR-0089 to ADR-0113 with its state counts and Verified count,
and one programme row each for S4 and EX. This recounts them from the checklists. Owner review of
the crosswalk at one exact SHA is a person's step.

Writes only that file, and only with --write; no network.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

from selecta.audit.checklist_summary import summarise

ROOT = Path(__file__).resolve().parents[3]
ADR = ROOT / "docs/adr"
S4 = ADR / "selecta-4-implementation-checklist.md"
EX = ADR / "selecta-experience-implementation-checklist.md"
RECON = ADR / "selecta-experience-status-reconciliation.md"
STATES = ("Implemented", "In progress", "Not started", "Superseded")
ROW = re.compile(
    r"^(\| (0(?:089|09\d|1[01]\d)) \| [^|]+ \| )(\d+) unchecked \| ([^|]+) \| (\d+)/(\d+) \|$",
    re.M,
)
S4_PROGRAMME = re.compile(
    r"\d+ Implemented, \d+ In progress, \d+ Not started, \d+ Verified; 250 unchecked"
)
EX_PROGRAMME = re.compile(
    r"\d+ Implemented, \d+ In progress, \d+ Not started, \d+ Superseded, \d+ Verified\*\*"
)


def expected(text: str, date: str) -> str:
    """The reconciliation text with every count recomputed from the task lines."""
    by_adr: dict[str, list] = {}
    for task in summarise(S4).tasks:
        by_adr.setdefault(task.task_id.split("-")[1], []).append(task)

    def row(match: re.Match) -> str:
        tasks = by_adr.get(match.group(2), [])
        counts = Counter(task.state for task in tasks)
        states = ", ".join(f"{counts[s]} {s}" for s in STATES if counts[s])
        verified = sum(task.verified for task in tasks)
        return (
            f"{match.group(1)}{len(tasks)} unchecked | {states} ({date}) | "
            f"{verified}/{len(tasks)} |"
        )

    text = ROW.sub(row, text)
    s4, ex = summarise(S4), summarise(EX)
    s4_text = ", ".join(f"{s4.count(s)} {s}" for s in STATES[:3])
    text = S4_PROGRAMME.sub(f"{s4_text}, {s4.verified} Verified; 250 unchecked", text)
    ex_text = ", ".join(f"{ex.count(s)} {s}" for s in STATES)
    return EX_PROGRAMME.sub(f"{ex_text}, {ex.verified} Verified**", text)


def strip_dates(text: str) -> str:
    return re.sub(r" \(\d{4}-\d\d-\d\d\)", "", text)


def check() -> list[str]:
    """Rows of the crosswalk whose counts differ from the task lines (dates ignored)."""
    text = RECON.read_text(encoding="utf-8")
    want = expected(text, "today")
    have_lines, want_lines = strip_dates(text).splitlines(), strip_dates(want).splitlines()
    want_lines = [line.replace(" (today)", "") for line in want_lines]
    return [w for h, w in zip(have_lines, want_lines, strict=True) if h != w]


def write(date: str) -> bool:
    text = RECON.read_bytes().decode("utf-8")
    new = expected(text, date)
    if new != text and check():
        RECON.write_bytes(new.encode("utf-8"))
        return True
    return False


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--write" in args:
        import datetime as dt

        changed = write(dt.date.today().isoformat())
        print("updated the crosswalk" if changed else "crosswalk already matches")
        return 0
    stale = check()
    for line in stale:
        print(f"stale, should be: {line}")
    if not stale:
        print("crosswalk matches the task lines")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
