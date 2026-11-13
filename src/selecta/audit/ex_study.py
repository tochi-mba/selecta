"""Uncoached study sessions: counterbalanced orders and honest scoring (EX-0118-05, EX-0133-01).

    python -m selecta.audit.ex_study orders 12 baseline-cards new-cards   # who sees what first
    python -m selecta.audit.ex_study template                           # a blank session file
    python -m selecta.audit.ex_study score sessions.json                # the report
    python -m selecta.audit.ex_study cards [EX-0117-01 ...]             # per-task study cards

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


# Per-task study cards (EX-0114-01 to EX-0128-01). Preparation only: a card says how to run one
# uncoached task on the made-up library of tests/e2e_server.py; it holds no participant or result.
SERVER = "python tests/e2e_server.py <port> (made-up library, no real music, no real names)"
CONSENT_LINE = (
    "Before we start: I am testing SelectaDJ, not you. I record the time, what you click and what "
    "you say, under a code like P01, never your name. You can stop at any time. Is that OK?"
)
HESITATION_RULE = (
    "one hesitation = 10 seconds or more with no action, a return to a page already left, or a "
    "question to the facilitator; the facilitator answers only 'what would you do?'"
)
RECORD_FIELDS = (
    "participant (code only)", "sha", "consent", "coached (must be false)", "seconds_to_success",
    "hesitations", "completed", "confident (1 to 5, asked after the task)", "notes (observed or "
    "hypothesis)",
)


@dataclass(frozen=True)
class TaskCard:
    """One uncoached task: where it starts, the words read aloud, and how it is scored."""

    entry: str
    route: str
    setup: str
    prompt: str
    success: str
    condition: str = "current"


TASK_CARDS: tuple[TaskCard, ...] = (
    TaskCard(
        "EX-0114-01", "/",
        "fresh server, nothing playing",
        "One task at a time: get some music playing; tell me what will play after this song; keep "
        "a different mix for later without stopping this one; tell me who made one song.",
        "each of the four counted on its own: sound starts; the next song is named; a draft exists "
        "and playback never stopped; the right artist is named",
    ),
    TaskCard(
        "EX-0115-01", "/",
        "fresh server; the facilitator never says a page name",
        "Before clicking, say where you would go to: see what is playing; start a new mix from an "
        "idea; find a mix you kept earlier; check a song's details; see why a song is not ready. "
        "Then go there.",
        "per destination, the first click lands on it (Listen, Make a Mix, My Mixes, Library, "
        "Workspace); a second click counts as a hesitation, not a success",
    ),
    TaskCard(
        "EX-0116-01", "/listen",
        "the facilitator starts the current mix, then hands over",
        "Tell me what is playing and who it is by, pause it, then tell me what comes next.",
        "song and artist named, playback paused, the next song named, all from Listen",
    ),
    TaskCard(
        "EX-0117-01", "/mixes",
        "nothing playing",
        "Start a mix that suits a relaxed evening. You may change it first, but need not.",
        "music from a mix idea starts within 2 minutes by either path; record which path was used",
    ),
    TaskCard(
        "EX-0118-01", "/mixes",
        "nothing playing; counterbalance with the EX-0118-05 `orders` command",
        "Look at these mix ideas. Without pressing anything, pick one and tell me what each of its "
        "buttons would do and what music it would draw from.",
        "for the card chosen: one button replaces what plays, one opens the mix for changes first, "
        "one keeps it without changing playback; one real fact from the card named",
    ),
    TaskCard(
        "EX-0119-01", "/mixes/mine",
        "current mix playing; one saved draft; one draft put in the render line (Prioritize)",
        "Show me the mix you are hearing now, a mix kept for later, and anything still being "
        "prepared. For each one, would pressing it change what you hear?",
        "all three pointed to correctly and the playback answer right for each",
    ),
    TaskCard(
        "EX-0120-01", "/mix/current/edit",
        "current mix of 2 songs; the 20 and 100-song runs need a larger made-up mix-ready fixture "
        "(the server has 12 mix-ready songs) prepared before the sessions",
        "Change how the music moves from the first song into the second without changing either "
        "song. Then swap the second song for a different one.",
        "the move changed through the transition, the song changed through the song row, and "
        "neither action selected the other",
    ),
    TaskCard(
        "EX-0122-02", "/mix/current/edit",
        "server with SELECTA_E2E_STEMS=1, current mix of its first two songs",
        "During the change between the first two songs, keep the first song's singing out and let "
        "the second song's drums play all the way through. Then tell me what you changed.",
        "the two parts set as asked, nothing else changed, and the explanation names voice and "
        "drums correctly",
    ),
    TaskCard(
        "EX-0124-02", "/listen",
        "current mix playing; the facilitator requested two songs, one ready, one still waiting",
        "Some songs have been asked for. Which would you expect to hear soon, which might never "
        "play, and why?",
        "ready and waiting told apart, and no play time or queue place claimed for either",
    ),
    TaskCard(
        "EX-0126-01", "/",
        "`selecta web` on a new empty SELECTA_HOME; the card names a song FILE in the made-up "
        "music folder as 'your music'",
        "Your music is at the address on this card. Add it to SelectaDJ.",
        "after the file address is refused, the participant follows the advice and starts with the "
        "folder that holds it",
    ),
    TaskCard(
        "EX-0128-01", "/workshop",
        "plain server: its made-up library has one song that could not be analysed, which "
        "What needs you lists with its fix link",
        "Something is stopping SelectaDJ from getting all your songs ready. Find out what it is "
        "and what you would do about it.",
        "the blocker named in the participant's words and its fix link followed",
    ),
)


def card_text(card: TaskCard) -> str:
    """A printable card for the facilitator."""
    return "\n".join([
        f"## {card.entry} (condition {card.condition})",
        f"Server: {SERVER}",
        f"Start at: {card.route}",
        f"Setup: {card.setup}",
        f"Consent, read first: {CONSENT_LINE}",
        f"Prompt, read once, no hints: {card.prompt}",
        f"Success: {card.success}",
        f"Hesitation: {HESITATION_RULE}",
        f"Record: {', '.join(RECORD_FIELDS)}",
    ])


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["orders"] and len(args) >= 4:
        for number, order in enumerate(balanced_orders(args[2:], int(args[1])), 1):
            print(f"P{number:02d}: {' -> '.join(order)}")
        return 0
    if args[:1] == ["template"]:
        print(json.dumps([TEMPLATE], indent=2))
        return 0
    if args[:1] == ["cards"]:
        chosen = [card for card in TASK_CARDS if len(args) < 2 or card.entry in args[1:]]
        print("\n\n".join(card_text(card) for card in chosen))
        return 0 if chosen else 2
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
