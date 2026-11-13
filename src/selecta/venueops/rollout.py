"""Phased rollout, honest status and P0 no-go gates for Autopilot (ADR-0440).

Four tools, each a pure check that returns reasons rather than a bare yes:

- `PHASES`: the dependency order of ADR-0417 to ADR-0440 from the roadmap
  (docs/adr/selecta-autopilot-roadmap.md) as data, with the flags that switch each phase on.
  `order_problems()` proves the order has no cycles, names every ADR once, uses only flags that
  exist, and never lets a phase's flag need a flag from a later phase (AV-0440-01).
- `honest_status_problems()`: reads the Autopilot implementation checklist and fails when a
  ticked line has no Evidence, a ticked line still says Not started, or a line claims
  independent verification without naming an independent reviewer (AV-0440-02).
- `rollback_flags()` and `ROLLBACK_SPEC`: every `venue.*` and `autopilot.*` flag, and the
  `SELECTA_FLAGS` text that turns them all off. tests/test_apb_rollout.py builds the local app
  with them off and on and proves existing routes and flags are unchanged (AV-0440-03).
- `decide()`: the P0 no-go gates from docs/adr/selecta-autopilot-release-gates.md. It returns
  NO-GO with every reason, or ELIGIBLE FOR SIGNED GO. It never returns GO: the release decision
  is a signed person step recorded in docs/autopilot/go-no-go-record.md (AV-0440-04, -05).

    python -m selecta.venueops.rollout            # order and honest-status checks
"""

from __future__ import annotations

import re
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags

FLAG = "venue.rollout_gates"
ROOT = Path(__file__).resolve().parents[3]
CHECKLIST = ROOT / "docs" / "adr" / "selecta-autopilot-implementation-checklist.md"
ADR_RANGE = tuple(range(417, 441))


@dataclass(frozen=True)
class Phase:
    id: int
    title: str
    adrs: tuple[int, ...]
    flags: tuple[str, ...]
    depends_on: tuple[int, ...]


PHASES: tuple[Phase, ...] = (
    Phase(1, "Protect what exists", (417, 434), (), ()),
    Phase(
        2, "Close core experience gaps", (418, 419, 420, 421, 422, 423),
        ("cloud.mix_create", "cloud.single_audio_owner", "cloud.account_states",
         "cloud.library_states", "rooms.nickname_confirm", "mixes.intent_language"),
        (1,),
    ),
    Phase(
        3, "Build autonomy", (424, 425, 426, 427, 428),
        ("autopilot.venue_mode", "autopilot.venue_policy", "autopilot.horizon",
         "autopilot.safe_transitions", "autopilot.ai_director"),
        (2,),
    ),
    Phase(
        4, "Make it operational", (429, 430, 431, 432, 433, 435, 436),
        ("venue.continuity", "venue.fault_injection", "venue.speakers", "venue.staff_dashboard",
         "venue.moderated_requests", "venue.learning", "venue.rights_gate", "venue.roles",
         "venue.safe_gain", "venue.health"),
        (3,),
    ),
    Phase(5, "Demonstrate product-market fit", (437, 438, 439), ("venue.soak",), (4,)),
    Phase(6, "Gate the release", (440,), ("venue.rollout_gates",), (5,)),
)
"""ADR-0434 (rights) sits in phase 1 as clearance work; its runtime check, venue.rights_gate,
needs autopilot.venue_mode and so switches on in phase 4."""


def topological(phases: Iterable[Phase]) -> list[int]:
    """Phase ids in dependency order; raises ValueError on a cycle or an unknown dependency."""
    by_id = {p.id: p for p in phases}
    done: list[int] = []
    state: dict[int, str] = {}

    def visit(pid: int, path: tuple[int, ...]) -> None:
        if pid not in by_id:
            raise ValueError(f"Phase {path[-1]} depends on unknown phase {pid}.")
        if state.get(pid) == "done":
            return
        if state.get(pid) == "visiting":
            raise ValueError("Phases depend on each other in a circle: "
                             + " -> ".join(str(p) for p in (*path, pid)))
        state[pid] = "visiting"
        for dep in by_id[pid].depends_on:
            visit(dep, (*path, pid))
        state[pid] = "done"
        done.append(pid)

    for pid in sorted(by_id):
        visit(pid, ())
    return done


def order_problems(phases: Iterable[Phase] = PHASES,
                   registry: Mapping[str, flags.Flag] | None = None) -> list[str]:
    phases = list(phases)
    registry = flags.registry() if registry is None else registry
    problems: list[str] = []
    try:
        order = topological(phases)
    except ValueError as error:
        return [str(error)]
    rank = {pid: n for n, pid in enumerate(order)}
    seen: dict[int, int] = {}
    for phase in phases:
        for adr in phase.adrs:
            if adr in seen:
                problems.append(f"ADR-0{adr} is in phase {seen[adr]} and phase {phase.id}.")
            seen[adr] = phase.id
    missing = sorted(set(ADR_RANGE) - set(seen))
    if missing:
        problems.append("Not in any phase: " + ", ".join(f"ADR-0{a}" for a in missing))
    flag_phase: dict[str, int] = {}
    for phase in phases:
        for flag_id in phase.flags:
            if flag_id not in registry:
                problems.append(f"Phase {phase.id} names flag {flag_id}, which doesn't exist.")
            flag_phase[flag_id] = phase.id
    for phase in phases:
        for flag_id in phase.flags:
            for need in getattr(registry.get(flag_id), "requires", ()):
                need_phase = flag_phase.get(need)
                if need_phase is not None and rank[need_phase] > rank[phase.id]:
                    problems.append(f"{flag_id} (phase {phase.id}) needs {need} "
                                    f"from later phase {need_phase}.")
    return problems


# --- Honest status ---------------------------------------------------------------------------

TASK = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+\*\*(AV-\d{4}-\d{2})\b")
EVIDENCE = re.compile(r"evidence:\**\s*(.*)", re.IGNORECASE)
INDEPENDENT_YES = re.compile(r"independently\s+verified:\**\s*yes", re.IGNORECASE)
PLAIN_VERIFIED_YES = re.compile(r"(?<!independently )\bverified:\**\s*yes", re.IGNORECASE)
REVIEWER = re.compile(r"independent reviewer:\**\s*([^.;*]+)", re.IGNORECASE)
NOT_INDEPENDENT = re.compile(
    r"^(?:-|none|n/a|tbd|claude.*|codex.*|autopilot-[ab].*|ap[ab]\d*.*|.*agent.*)$",
    re.IGNORECASE,
)
EMPTY = {"", "-", "none", "n/a", "pending", "tbd", "todo", "not started"}


@dataclass(frozen=True)
class StatusProblem:
    line: int
    task: str
    problem: str


def honest_status_problems(text: str) -> list[StatusProblem]:
    problems: list[StatusProblem] = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = TASK.match(line)
        if not match:
            continue
        ticked, task = match.group(1).lower() == "x", match.group(2)
        found = EVIDENCE.search(line)
        evidence = found.group(1).strip().strip("*").strip().rstrip(".") if found else ""
        if ticked and evidence.casefold() in EMPTY:
            problems.append(StatusProblem(number, task, "ticked without Evidence"))
        if ticked and re.search(r"implementation:\**\s*not started", line, re.IGNORECASE):
            problems.append(StatusProblem(number, task, "ticked but Implementation is Not started"))
        if INDEPENDENT_YES.search(line) or PLAIN_VERIFIED_YES.search(line):
            reviewer = REVIEWER.search(line)
            name = reviewer.group(1).strip() if reviewer else ""
            if not name or NOT_INDEPENDENT.match(name):
                problems.append(StatusProblem(
                    number, task, "claims Verified without a named independent reviewer"))
    return problems


def audit_checklist(path: Path = CHECKLIST) -> list[StatusProblem]:
    return honest_status_problems(path.read_text("utf-8"))


# --- Flag-off rollback -----------------------------------------------------------------------

ROLLBACK_PREFIXES = ("venue.", "autopilot.")
ROLLBACK_SPEC = "-venue.* -autopilot.*"
ENABLE_SPEC = "+autopilot.* +venue.*"


def rollback_flags(registry: Mapping[str, flags.Flag] | None = None) -> list[str]:
    registry = flags.registry() if registry is None else registry
    return [fid for fid in registry if fid.startswith(ROLLBACK_PREFIXES)]


def outside_dependents(registry: Mapping[str, flags.Flag] | None = None) -> list[str]:
    """Flags outside the rollback set that need one inside it: rollback would switch them off."""
    registry = flags.registry() if registry is None else registry
    inside = set(rollback_flags(registry))
    return sorted(fid for fid, flag in registry.items()
                  if fid not in inside and inside.intersection(flag.requires))


# --- P0 no-go gates --------------------------------------------------------------------------


@dataclass(frozen=True)
class Gate:
    id: str
    title: str
    p0: bool = True


GATES: tuple[Gate, ...] = (
    Gate("licensed_content_and_models", "No unlicensed content or model"),
    Gate("originals_intact", "No missing or modified original song"),
    Gate("right_song_revision_seam", "No wrong song, revision or seam"),
    Gate("consented_bridging", "No unauthorized request bridging"),
    Gate("no_speaker_overlap", "No overlapping speakers"),
    Gate("no_uncommanded_gap_or_resume", "No uncommanded gap or resume"),
    Gate("emergency_stop_accessible", "Emergency Stop is accessible"),
    Gate("no_data_leakage", "No venue or guest data leakage"),
    Gate("flag_off_rollback", "Venue features turn off without changing existing ones"),
    Gate("six_hour_real_audio", "Six-hour real-audio soak on a supported speaker"),
    Gate("features_preserved", "Every existing Local/Cloud feature preserved", p0=False),
    Gate("human_checks", "Human AT, blind listening and venue pilot done", p0=False),
)
GATE_IDS = {g.id for g in GATES}
REAL_SOAK_MODES = {"realtime", "played-log"}


@dataclass(frozen=True)
class GateEvidence:
    status: str  # "pass", "fail" or "missing"
    evidence: str = ""
    sha: str | None = None
    reviewer: str | None = None


@dataclass
class Decision:
    verdict: str  # "NO-GO" or "ELIGIBLE FOR SIGNED GO"
    reasons: list[str] = field(default_factory=list)
    sha: str | None = None

    @property
    def no_go(self) -> bool:
        return self.verdict == "NO-GO"


def soak_gate(evidence: Mapping) -> GateEvidence:
    """Read a soak evidence file (selecta.venueops.soak) into the six-hour gate."""
    mode = evidence.get("mode")
    night_s = float(evidence.get("night_s") or evidence.get("continuity", {}).get("night_s", 0))
    if mode not in REAL_SOAK_MODES:
        return GateEvidence("missing", f"soak mode {mode!r} is not real audio")
    if night_s < 6 * 3600 - 1:
        return GateEvidence("fail", f"soak covered {night_s / 3600:.2f} h, not six")
    if not evidence.get("passed"):
        return GateEvidence("fail", "soak failed its continuity or resource targets")
    return GateEvidence("pass", "soak evidence passed", evidence.get("git_sha"))


def decide(
    evidence: Mapping[str, GateEvidence],
    *,
    release_sha: str | None,
    open_tasks: Iterable[str] = (),
    status_problems: Iterable[StatusProblem] = (),
) -> Decision:
    """NO-GO with every reason, or ELIGIBLE FOR SIGNED GO when nothing blocks."""
    reasons: list[str] = []
    if not release_sha:
        reasons.append("No exact release SHA named.")
    unknown = sorted(set(evidence) - GATE_IDS)
    if unknown:
        reasons.append("Evidence for unknown gates: " + ", ".join(unknown))
    for gate in GATES:
        item = evidence.get(gate.id)
        label = f"{'P0 ' if gate.p0 else ''}{gate.title}"
        if item is None or item.status == "missing":
            reasons.append(f"{label}: no evidence.")
        elif item.status != "pass":
            reasons.append(f"{label}: failed ({item.evidence or 'no detail'}).")
        elif not item.evidence.strip():
            reasons.append(f"{label}: marked pass without evidence.")
        elif release_sha and item.sha and item.sha != release_sha:
            reasons.append(f"{label}: evidence is for {item.sha[:12]}, not the release SHA.")
        elif release_sha and not item.sha:
            reasons.append(f"{label}: evidence names no SHA.")
    open_tasks = sorted(open_tasks)
    if open_tasks:
        shown = ", ".join(open_tasks[:10]) + (" ..." if len(open_tasks) > 10 else "")
        reasons.append(f"{len(open_tasks)} Autopilot tasks are not done: {shown}")
    for problem in status_problems:
        reasons.append(f"Checklist line {problem.line} ({problem.task}): {problem.problem}.")
    verdict = "NO-GO" if reasons else "ELIGIBLE FOR SIGNED GO"
    return Decision(verdict, reasons, release_sha)


def open_tasks(text: str) -> list[str]:
    return [m.group(2) for line in text.splitlines()
            if (m := TASK.match(line)) and m.group(1) == " "]


def main(argv: list[str] | None = None) -> int:
    problems = order_problems()
    for problem in problems:
        print(f"order: {problem}")
    status = audit_checklist()
    for item in status:
        print(f"status: line {item.line} {item.task}: {item.problem}")
    text = CHECKLIST.read_text("utf-8")
    decision = decide({}, release_sha=None, open_tasks=open_tasks(text), status_problems=status)
    print(f"{decision.verdict}: {len(decision.reasons)} reasons")
    return 1 if problems or status else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
