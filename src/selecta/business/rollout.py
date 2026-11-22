"""SelectaDJ for Business phases, release gates and the selling switch guard (ADR-0441, ADR-0454).

Pure checks that return reasons, never a bare yes, in the shape of `selecta.venueops.rollout`
(ADR-0440) and `selecta.flags.flip_guard`:

- `PHASES`: B0 Build (dark), B1 Scouting, B2 Paid launch, B3 US and EU (ADR-0441 Decision),
  each with what must be true before it starts. `current_phase()` names the phase the records
  allow; it never moves a phase on by itself.
- `GATES`: Gate P (ready for pilots, P1 to P10) and Gate S (ready to sell, S1 to S8) from
  ADR-0454. Each gate's status is read from the human-kept register,
  docs/verification/bz-gate-register.md. A PASS row needs evidence and a named person who is not
  an agent (Claude, Codex or any "agent"); code and agents never write PASS.
- `decide(...)`: NO-GO with every reason, or ELIGIBLE FOR SIGNED GO. It never answers GO: the
  release decision is the owner's signed record, docs/verification/bz-go-no-go-record.md
  (ADR-0440 AV-0440-05, ADR-0454 S8).
- `check_signups_rules(...)`: BZ-0441-09. A change to `business.signups` targeting that could
  switch selling on for anyone beyond named pilot workspaces or users is refused until
  BZ-0449-11 (legal gate) and BZ-0447-15 (Stripe staging) are Implemented in their ADRs, Gate S
  is recorded PASS and the GO record is signed. Grants to named pilots, kill switches and
  switching it off are never refused. `flags_admin.change` runs it on every save.
- `build_problems(...)`: the same answer for the build layer (`SELECTA_FLAGS +business.signups`),
  which no admin save can see: on in the build with no catch-all off rule means everyone.

    python -m selecta.business.rollout            # phase, gates and the selling switch
"""

from __future__ import annotations

import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags
from selecta.flags.matching import SEGMENT_KEYS, Rule, RuleKind

SIGNUPS = "business.signups"
ROOT = Path(__file__).resolve().parents[3]
REGISTER = ROOT / "docs" / "verification" / "bz-gate-register.md"
GO_RECORD = ROOT / "docs" / "verification" / "bz-go-no-go-record.md"
ADR_DIR = ROOT / "docs" / "adr"

# Tasks that must be Implemented before selling (BZ-0441-09).
SELLING_PREREQUISITES = {
    "BZ-0449-11": "the hard legal gate (a lawyer's written view, recorded by the owner)",
    "BZ-0447-15": "the Stripe test-mode staging run and accountant review",
}

PASS, FAIL, NOT_RECORDED = "PASS", "FAIL", "NOT RECORDED"
STATUSES = (PASS, FAIL, NOT_RECORDED)
NOT_A_PERSON = re.compile(r"^(?:|-|none|n/a|tbd|.*claude.*|.*codex.*|.*agent.*|.*bot.*)$",
                          re.IGNORECASE)


@dataclass(frozen=True)
class Gate:
    id: str
    title: str
    evidence: str
    person: bool = False  # needs a person, not only a CI run


GATES: tuple[Gate, ...] = (
    Gate("P1", "Business code tasks pilots need are Implemented", "Business checklist"),
    Gate("P2", "Every named edge-case test passes on SQLite and PostgreSQL in CI", "CI run id"),
    Gate("P3", "Business invariants B1 to B9 hold after every business test",
         "assert_trace_clean in fixtures"),
    Gate("P4", "ST1 to ST4 pass scaled down and at full size on staging", "Staging reports",
         person=True),
    Gate("P5", "Real-device soak passes on all three kiosk types", "Soak report", person=True),
    Gate("P6", "Accessibility: zero serious axe findings, keyboard sweeps, NVDA on S2, S4, S6",
         "Reports and NVDA speech log", person=True),
    Gate("P7", "Security: cross-organisation sweep, kiosk token copy, stolen tablet, "
         "offboarding drill", "Security test run"),
    Gate("P8", "Customer-facing leak tests (B4) pass for every state", "CI run id"),
    Gate("P9", "Every business feature behind its flag, business.signups off, business.* off "
         "returns today's behaviour", "Flag sweep and rollback drill"),
    Gate("P10", "Pilot agreement in place and each pilot venue's licence attested",
         "Signed agreements", person=True),
    Gate("S1", "Legal review passed", "Lawyer's written view, recorded by the owner",
         person=True),
    Gate("S2", "Pricing validated against the competitive risk", "Owner's pricing decision",
         person=True),
    Gate("S3", "Scouting pilots ran with zero platform-caused silence", "Pilot report",
         person=True),
    Gate("S4", "ST5 to ST10 pass on staging", "Staging reports", person=True),
    Gate("S5", "Stripe live-mode readiness reviewed", "Billing test run and owner review",
         person=True),
    Gate("S6", "Support runbook for silent venues and a status page entry", "Runbook link"),
    Gate("S7", "VoiceOver on iPhone and a real screen-reader user on S4 and S6", "Session notes",
         person=True),
    Gate("S8", "GO decision recorded under ADR-0440", "Signed decision", person=True),
)
GATE_IDS = tuple(g.id for g in GATES)
GATE_P = tuple(g for g in GATES if g.id.startswith("P"))
GATE_S = tuple(g for g in GATES if g.id.startswith("S"))


@dataclass(frozen=True)
class Phase:
    id: str
    title: str
    needs: str


PHASES: tuple[Phase, ...] = (
    Phase("B0", "Build, selling switched off", "nothing: business.* flags ship dark"),
    Phase("B1", "Scouting with 3 to 5 friendly pilot venues", "Gate P recorded PASS"),
    Phase("B2", "Paid launch in the UK", "Gate S recorded PASS, the selling prerequisites "
          "Implemented and the GO record signed"),
    Phase("B3", "US and EU", "B2, plus the owner's signed record naming phase B3"),
)


# --- The register and the GO record -----------------------------------------------------------


@dataclass(frozen=True)
class GateRecord:
    id: str
    status: str = NOT_RECORDED
    evidence: str = ""
    recorded_by: str = ""
    date: str = ""
    problems: tuple[str, ...] = ()

    @property
    def passed(self) -> bool:
        return self.status == PASS and not self.problems


ROW = re.compile(r"^\|\s*([PS]\d{1,2})\s*\|(.*)\|\s*$")


def parse_register(text: str) -> dict[str, GateRecord]:
    """Rows `| id | title | status | evidence | recorded by | date |` into records. A PASS row
    without evidence, or recorded by an agent rather than a person, carries a problem and does
    not count."""
    found: dict[str, GateRecord] = {}
    for line in text.splitlines():
        match = ROW.match(line.strip())
        if not match or match.group(1) not in GATE_IDS:
            continue
        cells = [c.strip() for c in match.group(2).split("|")]
        cells += [""] * (5 - len(cells))
        _title, status, evidence, recorded_by, date = cells[:5]
        status = status.upper() or NOT_RECORDED
        problems: list[str] = []
        if status not in STATUSES:
            problems.append(f"status {status!r} is not one of {', '.join(STATUSES)}")
        if status == PASS:
            if evidence.strip("- ").casefold() in ("", "none", "tbd"):
                problems.append("PASS without evidence")
            if NOT_A_PERSON.match(recorded_by.strip()):
                problems.append("PASS not recorded by a named person (agents cannot pass a gate)")
            if not date.strip("- "):
                problems.append("PASS without a date")
        found[match.group(1)] = GateRecord(match.group(1), status, evidence, recorded_by, date,
                                           tuple(problems))
    return found


def read_register(path: Path = REGISTER) -> dict[str, GateRecord]:
    return parse_register(path.read_text("utf-8")) if path.exists() else {}


FIELD = re.compile(r"^\s*[-*]?\s*\**([A-Za-z ]+?):\**\s*(.*?)\s*$")


@dataclass(frozen=True)
class GoRecord:
    decision: str = ""
    phase: str = ""
    release_sha: str = ""
    signed_by: str = ""
    date: str = ""

    @property
    def signed_go(self) -> bool:
        return (
            self.decision.upper() == "GO"
            and bool(re.fullmatch(r"[0-9a-f]{7,40}", self.release_sha))
            and not NOT_A_PERSON.match(self.signed_by.strip())
            and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.date))
        )


def parse_go_record(text: str) -> GoRecord:
    """The `## Decision` section's `Decision`, `Phase`, `Release SHA`, `Signed by` and `Date`."""
    values: dict[str, str] = {}
    in_decision = False
    for line in text.splitlines():
        if line.startswith("## "):
            in_decision = line.strip().lower() == "## decision"
            continue
        match = FIELD.match(line) if in_decision else None
        if match:
            values[match.group(1).strip().lower()] = match.group(2).strip().strip("`")
    blank = {"", "-", "pending", "none", "tbd"}

    def get(key: str) -> str:
        value = values.get(key, "")
        return "" if value.casefold() in blank else value

    return GoRecord(get("decision"), get("phase"), get("release sha"), get("signed by"),
                    get("date"))


def read_go_record(path: Path = GO_RECORD) -> GoRecord:
    return parse_go_record(path.read_text("utf-8")) if path.exists() else GoRecord()


IMPLEMENTATION = re.compile(r"\*\*Implementation:\*\*\s*([A-Za-z ]+?)[.;(]")


def task_status(task_id: str, adr_dir: Path = ADR_DIR) -> str:
    """A BZ task's Implementation status from its ADR checklist line ('Not found' if absent)."""
    number = task_id.split("-")[1]
    for path in sorted(adr_dir.glob(f"adr-{number}-*.md")):
        for line in path.read_text("utf-8").splitlines():
            if f"**{task_id} " in line or f"**{task_id} -" in line:
                found = IMPLEMENTATION.search(line)
                return found.group(1).strip() if found else "Unknown"
    return "Not found"


def prerequisites(adr_dir: Path = ADR_DIR) -> dict[str, str]:
    return {task: task_status(task, adr_dir) for task in SELLING_PREREQUISITES}


# --- Decisions ---------------------------------------------------------------------------------


@dataclass
class Decision:
    gate: str
    verdict: str  # "NO-GO" or "ELIGIBLE FOR SIGNED GO"; never "GO"
    reasons: list[str] = field(default_factory=list)

    @property
    def no_go(self) -> bool:
        return self.verdict == "NO-GO"


def _gate_reasons(gates: Sequence[Gate], register: Mapping[str, GateRecord]) -> list[str]:
    reasons: list[str] = []
    for gate in gates:
        record = register.get(gate.id)
        who = " (needs a person)" if gate.person else ""
        if record is None or record.status == NOT_RECORDED:
            reasons.append(f"{gate.id} {gate.title}: not recorded{who}.")
        elif record.status == FAIL:
            reasons.append(f"{gate.id} {gate.title}: recorded FAIL ({record.evidence or '-'}).")
        elif record.problems:
            reasons.append(f"{gate.id} {gate.title}: {'; '.join(record.problems)}.")
    return reasons


def decide(
    gate: str,
    register: Mapping[str, GateRecord],
    *,
    task_statuses: Mapping[str, str] | None = None,
    go: GoRecord | None = None,
) -> Decision:
    """Gate "P" (ready for pilots) or "S" (ready to sell, which includes P). Gate S also needs
    the selling prerequisites Implemented; S8 is the signed GO record itself."""
    if gate not in ("P", "S"):
        raise ValueError("gate is P or S")
    reasons = _gate_reasons(GATE_P, register)
    if gate == "S":
        reasons += _gate_reasons(GATE_S, register)
        for task, status in (task_statuses or {}).items():
            if status.casefold() not in ("implemented", "done"):
                reasons.append(f"{task} ({SELLING_PREREQUISITES.get(task, task)}) is {status}.")
        if go is not None and not go.signed_go:
            reasons.append("The GO record is not signed: docs/verification/"
                           "bz-go-no-go-record.md needs Decision GO, a release SHA, a person "
                           "and a date.")
    return Decision(gate, "NO-GO" if reasons else "ELIGIBLE FOR SIGNED GO", reasons)


def current_phase(
    register: Mapping[str, GateRecord], task_statuses: Mapping[str, str], go: GoRecord
) -> Phase:
    """The furthest phase the records allow. Reading records never moves anything."""
    if decide("P", register).no_go:
        return PHASES[0]
    if decide("S", register, task_statuses=task_statuses, go=go).no_go:
        return PHASES[1]
    return PHASES[3] if go.phase.upper() == "B3" else PHASES[2]


# --- The selling switch ------------------------------------------------------------------------


def _is_catch_all_off(rule: Rule) -> bool:
    return (rule.enabled and not rule.problems and rule.kind == RuleKind.PERCENTAGE
            and rule.params.get("percent") == 0 and not (SEGMENT_KEYS & set(rule.params)))


def broad_reasons(rules: Sequence[Rule], *, build_on: bool) -> list[str]:
    """How these `business.signups` rules could switch selling on for people who are not a named
    pilot. Empty when only named workspaces or users get it."""
    found: list[str] = []
    enabled = [r for r in rules if r.enabled and not r.problems]
    if any(r.kind == RuleKind.KILL_SWITCH for r in enabled):
        return []  # a kill switch turns it off for everyone, wherever it sits
    for position, rule in enumerate(enabled, start=1):
        if rule.kind == RuleKind.PERCENTAGE and float(rule.params.get("percent") or 0) > 0:
            found.append(f"rule {position} rolls selling out to {rule.params['percent']}%")
        elif rule.kind == RuleKind.SEGMENT and rule.params.get("on") is True:
            found.append(f"rule {position} switches selling on for a whole segment")
        elif rule.kind == RuleKind.SCHEDULE and rule.params.get("on", True) is True:
            found.append(f"rule {position} switches selling on for everyone on a schedule")
    if build_on and (not enabled or not _is_catch_all_off(enabled[-1])):
        found.append("selling is on in this build and no catch-all off rule (a 0% percentage "
                     "rule with no conditions) closes it for everyone who is not a named pilot")
    return found


def check_signups_rules(
    proposed: Sequence[Rule],
    *,
    build_on: bool,
    gate_s: Decision,
) -> list[str]:
    """Every reason this `business.signups` rule change must be refused (BZ-0441-09)."""
    broad = broad_reasons(proposed, build_on=build_on)
    if not broad or not gate_s.no_go:
        return []
    return [
        "business.signups can only reach named pilot workspaces or users until Gate S is "
        f"eligible and signed: {'; '.join(broad)}",
        *gate_s.reasons,
    ]


def build_problems(
    rules: Sequence[Rule], states: Mapping[str, flags.State], gate_s: Decision
) -> list[str]:
    """`check_signups_rules` for the build layer and the stored rules together."""
    state = states.get(SIGNUPS)
    return check_signups_rules(rules, build_on=bool(state and state.on), gate_s=gate_s)


def gate_s_now(adr_dir: Path = ADR_DIR, register: Path = REGISTER,
               go_record: Path = GO_RECORD) -> Decision:
    return decide("S", read_register(register), task_statuses=prerequisites(adr_dir),
                  go=read_go_record(go_record))


def check_signups_rules_now(conn, proposed: Sequence[Rule]) -> list[str]:
    """`check_signups_rules` with this build's state and the repository's records."""
    del conn  # the records are files; the connection keeps the flip_guard call shape
    state = flags.effective().get(SIGNUPS)
    return check_signups_rules(proposed, build_on=bool(state and state.on), gate_s=gate_s_now())


def report(conn=None) -> dict:
    """Everything the admin readout and the CLI show."""
    register = read_register()
    statuses = prerequisites()
    go = read_go_record()
    gate_p = decide("P", register)
    gate_s = decide("S", register, task_statuses=statuses, go=go)
    rules: Sequence[Rule] = ()
    if conn is not None:
        from selecta.flags import rules as rule_store

        rules = rule_store.current_rules(conn, SIGNUPS)
    states = flags.effective()
    return {
        "phase": _phase_dict(current_phase(register, statuses, go)),
        "phases": [_phase_dict(p) for p in PHASES],
        "gates": [
            {"id": g.id, "title": g.title, "evidence": g.evidence, "person": g.person,
             "status": register.get(g.id, GateRecord(g.id)).status,
             "problems": list(register.get(g.id, GateRecord(g.id)).problems)}
            for g in GATES
        ],
        "gate_p": {"verdict": gate_p.verdict, "reasons": gate_p.reasons},
        "gate_s": {"verdict": gate_s.verdict, "reasons": gate_s.reasons},
        "prerequisites": statuses,
        "go_record": {"decision": go.decision, "signed": go.signed_go, "phase": go.phase},
        "signups": {
            "build_on": bool(states.get(SIGNUPS) and states[SIGNUPS].on),
            "refusals": build_problems(rules, states, gate_s),
        },
    }


def _phase_dict(phase: Phase) -> dict[str, str]:
    return {"id": phase.id, "title": phase.title, "needs": phase.needs}


def main(argv: Iterable[str] | None = None) -> int:
    del argv
    found = report()
    print(f"Phase {found['phase']['id']}: {found['phase']['title']}")
    for name in ("gate_p", "gate_s"):
        decision = found[name]
        print(f"Gate {name[-1].upper()}: {decision['verdict']} ({len(decision['reasons'])} "
              "reasons)")
        for reason in decision["reasons"]:
            print(f"  - {reason}")
    refusals = found["signups"]["refusals"]
    print("Selling switch: " + ("refused" if refusals else "no broad opening"))
    return 1 if refusals else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
