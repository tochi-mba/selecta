"""The Lucy evaluation gate, run with a fake provider (ADR-0404 SC-0404-06, section 9.6).

A good fake passes every case and the gate records the pass, which routing needs before a
deployment becomes a tier default; each kind of bad answer fails its own check and records
nothing. The real run against each tier's deployments, with its report, happens on staging.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from selecta.ai import evaluation, registry
from selecta.ai.evaluation import Answer, ToolCall
from selecta.persistence import transaction

TOOLS = frozenset({"tracks.search", "transitions.readyFrom", "proposals.plan"})


def pick(case, minutes: float, mood: str | None) -> tuple[str, ...]:
    chosen, total = [], 0.0
    for song in case.library:
        if song.id in case.excluded or (mood and song.mood != mood) or song.id in chosen:
            continue
        if total + song.minutes > minutes * 1.1:
            continue
        chosen.append(song.id)
        total += song.minutes
    return tuple(chosen)


class GoodLucy:
    """Answers each case the way the evaluation set wants."""

    def __init__(self):
        self.seen = []

    def answer(self, deployment, case):
        self.seen.append((deployment.id, case.id))
        calls = (ToolCall("tracks.search", {"query": case.request}),)
        if case.big_change:
            return Answer(asked_permission=True, tool_calls=calls, cost_usd=0.001, latency_s=2)
        if case.current_mix:
            mix = {song.id: song for song in case.library}
            used = sum(mix[song].minutes for song in case.current_mix)
            extra = pick(replace(case, excluded=case.excluded | set(case.current_mix)),
                         case.target_minutes - used, "calm")
            return Answer(case.current_mix + extra, tool_calls=calls, cost_usd=0.001, latency_s=2)
        if case.needs_tools:
            return Answer(tool_calls=(ToolCall("transitions.readyFrom", {"songs": ["s05"]}),),
                          cost_usd=0.001, latency_s=1)
        return Answer(pick(case, case.target_minutes, case.mood), tool_calls=calls,
                      cost_usd=0.001, latency_s=2)


class Twisted(GoodLucy):
    """A good answer, bent one way for one case."""

    def __init__(self, case_id, bend):
        super().__init__()
        self.case_id, self.bend = case_id, bend

    def answer(self, deployment, case):
        answer = super().answer(deployment, case)
        return self.bend(answer, case) if case.id == self.case_id else answer


@pytest.fixture
def seeded(cloud_engine):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
    return cloud_engine


def test_the_set_covers_every_check_the_proposal_names():
    cases = {case.id for case in evaluation.load_eval_set().cases}
    assert cases == {
        "mood-and-length", "exclusions-respected", "no-invented-songs", "current-mix-preserved",
        "permission-before-big-change", "valid-tool-calls",
    }


def test_a_good_deployment_passes_and_the_pass_is_recorded(seeded):
    with transaction(seeded) as conn:
        assert registry.get_deployment(conn, "sonnet-medium").eval_passed_at is None
        report = evaluation.gate(conn, "sonnet-medium", GoodLucy(), tools=TOOLS)
        assert report.passed and report.recorded, report.to_json()
        assert registry.get_deployment(conn, "sonnet-medium").eval_passed_at is not None
    assert report.to_json()["eval_version"] == 1


BENDS = {
    "mood-and-length": lambda a, c: replace(a, songs=a.songs[:2]),
    "exclusions-respected": lambda a, c: replace(a, songs=a.songs + ("s02",)),
    "no-invented-songs": lambda a, c: replace(a, songs=a.songs + ("sandstorm",)),
    "current-mix-preserved": lambda a, c: replace(a, songs=tuple(reversed(a.songs))),
    "permission-before-big-change": lambda a, c: replace(
        a, asked_permission=False, songs=("s01", "s02", "s03")),
    "valid-tool-calls": lambda a, c: replace(a, tool_calls=(ToolCall("delete_library", {}),)),
}


@pytest.mark.parametrize("case_id", sorted(BENDS))
def test_each_kind_of_bad_answer_fails_its_case_and_records_nothing(seeded, case_id):
    with transaction(seeded) as conn:
        report = evaluation.gate(conn, "haiku-low", Twisted(case_id, BENDS[case_id]), tools=TOOLS)
        assert not report.passed and not report.recorded
        assert [r.case_id for r in report.results if not r.passed] == [case_id]
        assert registry.get_deployment(conn, "haiku-low").eval_passed_at is None


@pytest.mark.parametrize(
    ("bend", "words"),
    [
        (lambda a, c: replace(a, cost_usd=1.0), "cost"),
        (lambda a, c: replace(a, latency_s=99), "took"),
        (lambda a, c: replace(a, tool_calls=(ToolCall("tracks.search", "not an object"),)),
         "invalid tool calls"),
        (lambda a, c: replace(a, tool_calls=(ToolCall("tracks.search", {}),) * 9), "limit"),
    ],
)
def test_cost_latency_and_tool_limits_are_part_of_the_gate(seeded, bend, words):
    with transaction(seeded) as conn:
        report = evaluation.gate(conn, "haiku-low", Twisted("mood-and-length", bend), tools=TOOLS)
    failed = [r for r in report.results if not r.passed]
    assert [r.case_id for r in failed] == ["mood-and-length"]
    assert any(words in failure for failure in failed[0].failures)


def test_a_provider_error_fails_the_case_instead_of_the_gate(seeded):
    class Broken(GoodLucy):
        def answer(self, deployment, case):
            if case.id == "valid-tool-calls":
                raise TimeoutError("provider timed out")
            return super().answer(deployment, case)

    with transaction(seeded) as conn:
        report = evaluation.gate(conn, "haiku-low", Broken(), tools=TOOLS)
    assert not report.passed
    assert report.results[-1].failures == ("error: TimeoutError: provider timed out",)


def test_every_tier_default_is_gated_and_then_routing_accepts_them(seeded):
    subjects = {}

    def subject_for(deployment):
        subjects[deployment.id] = GoodLucy()
        return subjects[deployment.id]

    with transaction(seeded) as conn:
        routing = registry.active_routing(conn).map
        with pytest.raises(registry.RegistryError, match="hasn't passed the evaluation set"):
            registry.validate_routing_map(routing, registry.load_deployments(conn))
        reports = evaluation.gate_tiers(conn, subject_for, tools=TOOLS)
        assert reports.passed
        assert set(reports.reports) == {"haiku-low", "haiku-medium", "sonnet-medium", "opus-high"}
        registry.validate_routing_map(routing, registry.load_deployments(conn))
    assert all(len(subject.seen) == 6 for subject in subjects.values())


def test_the_valid_tools_are_lucys_own():
    tools = evaluation.lucy_tools()
    assert TOOLS <= tools
