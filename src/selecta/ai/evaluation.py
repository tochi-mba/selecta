"""The Lucy evaluation gate for a model deployment (ADR-0404 SC-0404-06, section 9.6).

A fixed evaluation set (`eval_set.json`: synthetic libraries and scripted requests) is run against
a deployment through a `Subject`: anything that takes a case and returns what Lucy proposed. Each
case is scored on the checks the proposal names: mood and length, exclusions respected, no
invented songs, the current mix kept unless the person approved a change, permission asked
before a big change, valid tool calls, and cost and latency within limits. The gate passes only
when every case passes; then `gate` records the pass on the deployment, which
`registry.validate_routing_map(require_eval=True)` needs before the deployment can be a tier
default. `gate_tiers` runs it for each tier's first-choice deployments in the active routing.

The real subject drives the Lucy agent with the deployment's provider and key; that run, and its
report, happen against staging. Tests use a fake subject.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy.engine import Connection

from selecta.ai import registry
from selecta.ai.registry import Deployment

EVAL_SET = Path(__file__).with_name("eval_set.json")
LENGTH_TOLERANCE = 0.15
MOOD_SHARE = 0.8


@dataclass(frozen=True)
class Song:
    id: str
    title: str
    artist: str
    minutes: float
    mood: str


@dataclass(frozen=True)
class Case:
    id: str
    library: tuple[Song, ...]
    request: str
    target_minutes: float | None = None
    mood: str | None = None
    excluded: frozenset[str] = frozenset()
    current_mix: tuple[str, ...] = ()
    big_change: bool = False
    needs_tools: bool = False


@dataclass(frozen=True)
class EvalSet:
    version: int
    max_latency_s: float
    cases: tuple[Case, ...]


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: Any


@dataclass(frozen=True)
class Answer:
    """What Lucy proposed for one case."""

    songs: tuple[str, ...] = ()
    asked_permission: bool = False
    tool_calls: tuple[ToolCall, ...] = ()
    cost_usd: float = 0.0
    latency_s: float = 0.0


class Subject(Protocol):
    def answer(self, deployment: Deployment, case: Case) -> Answer: ...


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    failures: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not self.failures


@dataclass(frozen=True)
class Report:
    deployment_id: str
    eval_version: int
    results: tuple[CaseResult, ...]
    recorded: bool = False

    @property
    def passed(self) -> bool:
        return bool(self.results) and all(result.passed for result in self.results)

    def to_json(self) -> dict[str, Any]:
        return {
            "deployment_id": self.deployment_id, "eval_version": self.eval_version,
            "passed": self.passed, "recorded": self.recorded,
            "cases": [asdict(result) | {"passed": result.passed} for result in self.results],
        }


def load_eval_set(path: Path = EVAL_SET) -> EvalSet:
    data = json.loads(Path(path).read_text("utf-8"))
    libraries = {
        name: tuple(Song(**song) for song in songs) for name, songs in data["libraries"].items()
    }
    cases = tuple(
        Case(
            id=raw["id"], library=libraries[raw["library"]], request=raw["request"],
            target_minutes=raw.get("target_minutes"), mood=raw.get("mood"),
            excluded=frozenset(raw.get("excluded", ())),
            current_mix=tuple(raw.get("current_mix", ())),
            big_change=bool(raw.get("big_change", False)),
            needs_tools=bool(raw.get("needs_tools", False)),
        )
        for raw in data["cases"]
    )
    return EvalSet(int(data["version"]), float(data["max_latency_s"]), cases)


def lucy_tools() -> frozenset[str]:
    """The tools Lucy offers a model, by name."""
    from selecta.lucy.tools import TITLES

    return frozenset(TITLES)


def score(
    case: Case, answer: Answer, deployment: Deployment, *, max_latency_s: float,
    tools: Iterable[str],
) -> CaseResult:
    failures: list[str] = []
    library = {song.id: song for song in case.library}
    invented = [song for song in answer.songs if song not in library]
    if invented:
        failures.append(f"invented songs: {invented}")
    excluded = sorted(set(answer.songs) & case.excluded)
    if excluded:
        failures.append(f"used excluded songs: {excluded}")
    known = [library[song] for song in answer.songs if song in library]
    if case.big_change:
        if not answer.asked_permission:
            failures.append("made a big change without asking first")
        elif case.current_mix and tuple(answer.songs) not in {(), case.current_mix}:
            failures.append("changed the mix before the person said yes")
    elif case.current_mix and tuple(answer.songs[: len(case.current_mix)]) != case.current_mix:
        failures.append("did not keep the current mix as it was")
    if case.target_minutes:
        total = sum(song.minutes for song in known)
        if abs(total - case.target_minutes) > case.target_minutes * LENGTH_TOLERANCE:
            failures.append(f"length {total:g} min, asked about {case.target_minutes:g}")
    if case.mood and known:
        share = sum(song.mood == case.mood for song in known) / len(known)
        if share < MOOD_SHARE:
            failures.append(f"only {share:.0%} of songs are {case.mood}")
    if case.mood and not known and not case.big_change:
        failures.append("proposed no songs")
    allowed = frozenset(tools)
    bad = [call.name for call in answer.tool_calls
           if call.name not in allowed or not isinstance(call.arguments, Mapping)]
    if bad:
        failures.append(f"invalid tool calls: {bad}")
    if case.needs_tools and not answer.tool_calls:
        failures.append("answered without looking anything up")
    if len(answer.tool_calls) > deployment.max_tool_cycles:
        failures.append(f"{len(answer.tool_calls)} tool calls, limit {deployment.max_tool_cycles}")
    if answer.cost_usd > deployment.per_turn_cost_cap_usd:
        failures.append(f"cost ${answer.cost_usd:.4f} over ${deployment.per_turn_cost_cap_usd}")
    if answer.latency_s > max_latency_s:
        failures.append(f"took {answer.latency_s:.1f} s, limit {max_latency_s:g}")
    return CaseResult(case.id, tuple(failures))


def run(
    deployment: Deployment, subject: Subject, eval_set: EvalSet | None = None,
    tools: Iterable[str] | None = None,
) -> Report:
    eval_set = eval_set or load_eval_set()
    allowed = frozenset(tools) if tools is not None else lucy_tools()
    results = []
    for case in eval_set.cases:
        try:
            answer = subject.answer(deployment, case)
        except Exception as error:  # noqa: BLE001 - a crash is a failed case, not a crashed gate
            results.append(CaseResult(case.id, (f"error: {type(error).__name__}: {error}",)))
            continue
        results.append(score(case, answer, deployment, max_latency_s=eval_set.max_latency_s,
                             tools=allowed))
    return Report(deployment.id, eval_set.version, tuple(results))


def gate(
    conn: Connection, deployment_id: str, subject: Subject, eval_set: EvalSet | None = None,
    tools: Iterable[str] | None = None,
) -> Report:
    """Run the set against a stored deployment and record the pass only when every case passed."""
    deployment = registry.get_deployment(conn, deployment_id)
    if deployment is None:
        raise registry.RegistryError(f"{deployment_id} unknown")
    report = run(deployment, subject, eval_set, tools)
    if report.passed:
        report = Report(report.deployment_id, report.eval_version, report.results,
                        recorded=registry.record_eval_pass(conn, deployment_id))
    return report


@dataclass
class TierReports:
    reports: dict[str, Report] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return bool(self.reports) and all(report.passed for report in self.reports.values())


def first_choices(conn: Connection) -> list[str]:
    """Every non-built-in deployment that is some tier's first choice in the active routing."""
    routing = registry.active_routing(conn)
    deployments = registry.load_deployments(conn)
    chosen: list[str] = []
    for classes in routing.map.values():
        for ids in classes.values():
            if ids and ids[0] not in chosen and not deployments[ids[0]].is_builtin:
                chosen.append(ids[0])
    return chosen


def gate_tiers(
    conn: Connection, subject_for: Callable[[Deployment], Subject],
    eval_set: EvalSet | None = None, tools: Sequence[str] | None = None,
) -> TierReports:
    """The gate for each tier's first-choice deployment in the active routing."""
    reports = TierReports()
    for deployment_id in first_choices(conn):
        deployment = registry.get_deployment(conn, deployment_id)
        reports.reports[deployment_id] = gate(conn, deployment_id, subject_for(deployment),
                                              eval_set, tools)
    return reports


__all__ = [
    "Answer", "Case", "CaseResult", "EvalSet", "Report", "Song", "Subject", "TierReports",
    "ToolCall", "first_choices", "gate", "gate_tiers", "load_eval_set", "run", "score",
]
