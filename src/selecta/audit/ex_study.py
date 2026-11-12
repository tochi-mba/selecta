"""Uncoached study sessions: counterbalanced orders and honest scoring (EX-0118-05, EX-0133-01).

    python -m selecta.audit.ex_study orders 12 baseline-cards new-cards   # who sees what first
    python -m selecta.audit.ex_study template                           # a blank session file
    python -m selecta.audit.ex_study score sessions.json                # the report

This is the code half of a study: it never invents a participant or a result. `orders` hands out
condition orders so every condition appears in every position equally often (a balanced Latin
square, or a plain rotation for an odd count with its reverse). `score` reads session records a
person wrote and reports, per condition, task success and confidence as raw numerator/denominator,
order effects (first-seen against second-seen), and keeps what was OBSERVED (an error the
participant made, in their words or actions) apart from what someone THINKS caused it (a design
hypothesis). A record that mixes the two, names no participant, admits coaching or has no consent
is rejected rather than counted. "Better than baseline" is only said when every condition has at
least `MIN_PARTICIPANTS` scored participants and the success rate is higher; otherwise the report
says the sample is too small.

Read-only apart from printing; no network.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

MIN_PARTICIPANTS = 5
KINDS = ("observed", "hypothesis")


def balanced_orders(conditions: list[str], participants: int) -> list[list[str]]:
    """Condition orders for each participant, every condition in every position equally often."""
    n = len(conditions)
    if n < 2 or len(set(conditions)) != n:
        raise ValueError("need at least two distinct conditions")
    if participants < 1:
        raise ValueError("need at least one participant")
    # Williams design: first row 0, 1, n-1, 2, n-2, ...; later rows add the row number
    first = [0]
    low, high = 1, n - 1
    while len(first) < n:
        first.append(low)
        low += 1
        if len(first) < n:
            first.append(high)
            high -= 1
    rows = [[(start + step) % n for start in first] for step in range(n)]
    if n % 2:
        rows += [list(reversed(row)) for row in rows]
    return [[conditions[i] for i in rows[p % len(rows)]] for p in range(participants)]


@dataclass
class Report:
    """What `score` found, all counts raw."""

    success: dict[str, list[int]] = field(default_factory=dict)  # condition -> [done, attempted]
    confident: dict[str, list[int]] = field(default_factory=dict)  # condition -> [sure, asked]
    participants: dict[str, set[str]] = field(default_factory=dict)
    by_position: dict[int, list[int]] = field(default_factory=dict)  # position -> [done, tried]
    observed: list[str] = field(default_factory=list)
    hypotheses: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)

    def verdict(self, baseline: str) -> str:
        small = [c for c, who in self.participants.items() if len(who) < MIN_PARTICIPANTS]
        if baseline not in self.success:
            return f"no scored sessions for the baseline {baseline!r}; nothing can be compared"
        if small:
            return (
                f"too few participants to compare ({', '.join(sorted(small))} under "
                f"{MIN_PARTICIPANTS}); report the raw counts only"
            )
        base_done, base_tried = self.success[baseline]
        lines = []
        for condition, (done, tried) in sorted(self.success.items()):
            if condition == baseline:
                continue
            better = done * base_tried > base_done * tried
            word = "higher than" if better else "not higher than"
            lines.append(
                f"{condition}: {done}/{tried} succeeded, {word} {baseline} {base_done}/{base_tried}"
            )
        return "; ".join(lines) or "only the baseline was run"


def _problem(session: dict) -> str | None:
    if not str(session.get("participant", "")).strip():
        return "names no participant"
    if session.get("consent") is not True:
        return "has no recorded consent"
    if session.get("coached") is not False:
        return "does not say the session was uncoached"
    if not str(session.get("sha", "")).strip():
        return "names no exact SHA"
    if not session.get("order"):
        return "has no condition order"
    for task in session.get("tasks", []):
        for note in task.get("notes", []):
            if note.get("kind") not in KINDS:
                return f"has a note that is neither observed nor hypothesis: {note.get('text')!r}"
    return None


def score(sessions: list[dict]) -> Report:
    """Count each valid session's tasks per condition; reject any session that can't be trusted."""
    report = Report()
    for number, session in enumerate(sessions, 1):
        problem = _problem(session)
        if problem:
            report.rejected.append(f"session {number} {problem}")
            continue
        order = list(session["order"])
        who = str(session["participant"])
        for task in session.get("tasks", []):
            condition = task["condition"]
            if condition not in order:
                report.rejected.append(f"session {number}: task under {condition!r} not in order")
                continue
            report.participants.setdefault(condition, set()).add(who)
            done = 1 if task.get("completed") is True else 0
            success = report.success.setdefault(condition, [0, 0])
            success[0] += done
            success[1] += 1
            position = report.by_position.setdefault(order.index(condition) + 1, [0, 0])
            position[0] += done
            position[1] += 1
            if "confident" in task:
                sure = report.confident.setdefault(condition, [0, 0])
                sure[0] += 1 if task["confident"] is True else 0
                sure[1] += 1
            for note in task.get("notes", []):
                line = f"{who} / {condition} / {task.get('task', '?')}: {note['text']}"
                (report.observed if note["kind"] == "observed" else report.hypotheses).append(line)
    return report


TEMPLATE = {
    "participant": "P01 (a code, never a real name)",
    "consent": True,
    "coached": False,
    "sha": "exact commit the session ran on",
    "order": ["baseline-cards", "new-cards"],
    "tasks": [
        {
            "condition": "baseline-cards",
            "task": "pick a mix for a dinner party and start it",
            "completed": True,
            "confident": True,
            "notes": [
                {"kind": "observed", "text": "pressed Save draft first, then asked where it went"},
                {"kind": "hypothesis", "text": "Save draft may read as the main action"},
            ],
        }
    ],
}


def render(report: Report, baseline: str) -> str:
    out = ["# Study report (raw counts; no participant invented)", ""]
    for condition, (done, tried) in sorted(report.success.items()):
        sure = report.confident.get(condition, [0, 0])
        who = len(report.participants.get(condition, ()))
        out.append(
            f"- {condition}: {done}/{tried} tasks completed, {sure[0]}/{sure[1]} confident, "
            f"{who} participants"
        )
    for position, (done, tried) in sorted(report.by_position.items()):
        out.append(f"- seen in position {position}: {done}/{tried} completed")
    out += ["", f"Verdict: {report.verdict(baseline)}", "", "## Observed"]
    out += [f"- {line}" for line in report.observed] or ["- none"]
    out += ["", "## Design hypotheses (not findings)"]
    out += [f"- {line}" for line in report.hypotheses] or ["- none"]
    out += ["", "## Rejected sessions"]
    out += [f"- {line}" for line in report.rejected] or ["- none"]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["orders"] and len(args) >= 4:
        for number, order in enumerate(balanced_orders(args[2:], int(args[1])), 1):
            print(f"P{number:02d}: {' -> '.join(order)}")
        return 0
    if args[:1] == ["template"]:
        print(json.dumps([TEMPLATE], indent=2))
        return 0
    if args[:1] == ["score"] and len(args) >= 2:
        sessions = json.loads(Path(args[1]).read_text(encoding="utf-8"))
        baseline = args[2] if len(args) > 2 else "baseline-cards"
        report = score(sessions)
        print(render(report, baseline))
        return 1 if report.rejected else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
