"""Who gets a feature in the cloud, decided per request, job or Lucy turn (ADR-0414).

A feature reaches someone only if four layers all say yes (docs/saas/11b-feature-flags.md §11B.2):

1. Build: `SELECTA_FLAGS` and the JSON defaults, exactly as today (`flags.resolve`).
2. Mode: the flag's `modes` include the runtime mode (local or cloud).
3. Plan: the account's plan includes it, if any plan gates it. This is the only layer that can
   lock a feature for an account; targeting rules can never undo it.
4. Rules: the admin's targeting rules for that flag, in order, the first that matches deciding.
   When none match, the flag stays as the layers above left it: on.

Then today's `requires` cascade runs over the result, and the person's own preference comes last.
`user_prefs` maps a flag to `True` or `False`. `False` switches any feature off for that person.
`True` only counts for a `beta` flag (a "Labs" setting): in the cloud a beta feature is on only
when every layer above allows it and the person has switched it on. Local mode keeps today's
behaviour, so a beta flag there needs no opt-in and, with no preferences given, every decision
matches `flags.resolve()`.

Rules switch features off or roll them out; they never grant what the build, the mode or the plan
doesn't allow, and core flags can't be targeted at all. An enabled kill switch wins over every
other rule and over staff previews, wherever it sits in the list. Local mode has no plans and no
rules: a decision there is the build and mode layers, the cascade and the person's preference.

Everything here is pure: the caller hands in the build states, a `RuleSnapshot` and the plan's
flags, so a decision never touches the database and the same inputs always give the same answer.
The rules themselves, and how each one matches, are in `flags/matching.py`; `flags/rules.py`
stores them and keeps a snapshot per process.
"""

from __future__ import annotations

import enum
import time
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from selecta import flags
from selecta.billing import plans as plan_catalogue
from selecta.flags.matching import (
    BUCKETS,
    EMPTY,
    Context,
    Rule,
    RuleKind,
    RuleSnapshot,
    bucket,
    parse_version,
    unit_for,
)

__all__ = [
    "BUCKETS",
    "EMPTY",
    "Context",
    "Decision",
    "Decisions",
    "Explanation",
    "Impact",
    "Layer",
    "Rule",
    "RuleKind",
    "RuleSnapshot",
    "Step",
    "bucket",
    "decide",
    "decide_all",
    "dependents_of",
    "explain",
    "parse_version",
    "preview_impact",
    "unit_for",
]

# Why a feature is off, as machine codes. `needs:<flag>` names the flag it needs.
CORE = "core"
BUILD_OFF = "build_off"
MODE_OFF = "mode_off"
PLAN_LOCKED = "plan_locked"
RULE_OFF = "rule_off"
USER_OFF = "user_off"
NEEDS = "needs:"
# Why a feature is on, when it isn't core.
DEFAULT = "default"
RULE_ON = "rule_on"
PREVIEW = "preview"


def _plan_rank(plan_id: str) -> tuple[int, str]:
    """Cheapest first, for naming the plan that unlocks several features at once. A plan the
    catalogue doesn't know ranks below every real one."""
    try:
        return plan_catalogue.plan_for(plan_id).rank, plan_id
    except plan_catalogue.UnknownPlan:
        return -1, plan_id


class Layer(enum.StrEnum):
    CORE = "core"
    BUILD = "build"
    MODE = "mode"
    PLAN = "plan"
    RULES = "rules"
    REQUIRES = "requires"
    USER = "user"


@dataclass(frozen=True)
class Decision:
    on: bool
    layer: str
    reason: str


class _Evaluator:
    """One context's decisions, worked out once each and shared, so the `requires` cascade
    never evaluates a flag twice."""

    def __init__(
        self,
        ctx: Context,
        *,
        build_states: Mapping[str, flags.State],
        rules: RuleSnapshot | Mapping[str, Sequence[Rule]],
        entitled: Collection[str],
        plan_gated: Collection[str],
        user_prefs: Mapping[str, bool] | None,
        now: float | None,
        registry: Mapping[str, flags.Flag] | None,
    ) -> None:
        self.ctx = ctx
        self.build_states = build_states
        self.snapshot = rules if isinstance(rules, RuleSnapshot) else RuleSnapshot(0, rules)
        self.entitled = frozenset(entitled)
        self.plan_gated = frozenset(plan_gated)
        self.user_prefs = user_prefs or {}
        self.now = time.time() if now is None else now
        self.registry = flags.registry() if registry is None else registry
        self.local = ctx.mode == "local"
        self.decided: dict[str, Decision] = {}
        self.teasers: dict[str, str | None] = {}

    def flag(self, flag_id: str) -> flags.Flag:
        if flag_id not in self.registry:
            raise KeyError(f"There's no flag called {flag_id!r}.")
        return self.registry[flag_id]

    def build_ok(self, flag: flags.Flag) -> tuple[bool, str]:
        state = self.build_states.get(flag.id)
        if state is None:
            return False, "not in this build's flags"
        # "needs X" is the cascade's to explain, with the reason X is off.
        return state.on or state.why.startswith("needs "), state.why

    def rule_verdict(self, flag: flags.Flag) -> tuple[Decision, str]:
        rules = [rule for rule in self.snapshot.for_flag(flag.id) if rule.enabled]
        if any(rule.kind == RuleKind.KILL_SWITCH for rule in rules):
            return Decision(False, Layer.RULES, RULE_OFF), "kill switch: off for everyone"
        if self.snapshot.previewing(flag.id, self.ctx.user_id, self.now):
            return Decision(True, Layer.RULES, PREVIEW), "staff preview on this account"
        for position, rule in enumerate(self.snapshot.for_flag(flag.id), start=1):
            if not rule.enabled or rule.matcher is None:
                continue
            verdict = rule.matcher(flag, self.ctx, self.now)
            if verdict is None:
                continue
            reason = RULE_ON if verdict else RULE_OFF
            return Decision(verdict, Layer.RULES, reason), f"rule {position} ({rule.kind}) decided"
        return Decision(True, Layer.RULES, DEFAULT), "no rule matched"

    def layers(self, flag: flags.Flag) -> Decision:
        """Layers 1 to 4, before the cascade and the person's preference."""
        if flag.core:
            return Decision(True, Layer.CORE, CORE)
        if not self.build_ok(flag)[0]:
            return Decision(False, Layer.BUILD, BUILD_OFF)
        if self.ctx.mode not in flag.modes:
            return Decision(False, Layer.MODE, MODE_OFF)
        if self.local:
            return Decision(True, Layer.BUILD, DEFAULT)
        if flag.id in self.plan_gated and flag.id not in self.entitled:
            return Decision(False, Layer.PLAN, PLAN_LOCKED)
        return self.rule_verdict(flag)[0]

    def decide(self, flag_id: str, path: tuple[str, ...] = ()) -> Decision:
        if flag_id in self.decided:
            return self.decided[flag_id]
        flag = self.flag(flag_id)
        found = self.layers(flag)
        if found.on and not flag.core:
            for need in flag.requires:
                # A missing flag or a circle can't be satisfied: off, never an error mid-request.
                if need not in self.registry or need in path or need == flag_id:
                    found = Decision(False, Layer.REQUIRES, NEEDS + need)
                    break
                if not self.decide(need, (*path, flag_id)).on:
                    found = Decision(False, Layer.REQUIRES, NEEDS + need)
                    break
        if found.on and not flag.core and not self.preference(flag)[0]:
            found = Decision(False, Layer.USER, USER_OFF)
        self.decided[flag_id] = found
        return found

    def preference(self, flag: flags.Flag) -> tuple[bool, str]:
        """The person's own say, and why. A beta flag needs them to have switched it on (in the
        cloud); any other flag is on unless they switched it off, and `True` changes nothing."""
        choice = self.user_prefs.get(flag.id)
        if flag.kind == "beta" and not self.local:
            if choice is True:
                return True, "switched on in Labs"
            return False, "beta, not switched on in Labs" if choice is None else "switched off"
        if choice is False:
            return False, "switched off"
        if choice is None:
            return True, "no choice made"
        return True, "switched on, which only counts for beta features"

    def teaser(self, flag_id: str, lock_plans: Mapping[str, str]) -> str | None:
        """The plan a locked feature names as a teaser, or None when it's on or hidden.

        A feature its own plan gate locks is a teaser when its `when_locked` says so and it has
        an unlocking plan. A feature that's off only because it needs locked features is a
        teaser when every one of those is, naming the dearest of their plans, the one that
        unlocks them all. Either way it must be unlockable: a feature a rule or kill switch
        switched off is hidden, never teased, and so is anything that needs one."""
        if flag_id not in self.teasers:
            self.teasers[flag_id] = self._teaser(flag_id, lock_plans)
        return self.teasers[flag_id]

    def _teaser(self, flag_id: str, lock_plans: Mapping[str, str]) -> str | None:
        flag = self.flag(flag_id)
        decided = self.decide(flag_id)
        if decided.on or not self.unlockable(flag_id, ()):
            return None
        if decided.reason == PLAN_LOCKED:
            return lock_plans.get(flag_id) if flag.when_locked == "teaser" else None
        # Off through what it needs: unlockable, so at least one need is off and none is missing.
        named = [
            self.teaser(need, lock_plans) for need in flag.requires if not self.decide(need).on
        ]
        if None in named:
            return None
        return max(named, key=_plan_rank)

    def unlockable(self, flag_id: str, path: tuple[str, ...]) -> bool:
        """Off only because the plan leaves it, or something it needs, out: its own layers and a
        rule would leave it on, and everything it needs is on or unlockable too, all the way
        down. A needed flag is checked through its own rules, since a plan lock decides before
        the rules do and would hide a kill switch."""
        flag = self.flag(flag_id)
        reason = self.decide(flag_id).reason
        if reason == PLAN_LOCKED:
            if not self.rule_verdict(flag)[0].on:
                return False
        elif not (reason.startswith(NEEDS) and self.layers(flag).on):
            return False
        for need in flag.requires:
            if need not in self.registry or need in path or need == flag_id:
                return False
            if not self.decide(need).on and not self.unlockable(need, (*path, flag_id)):
                return False
        return True


def decide(
    flag_id: str,
    ctx: Context,
    *,
    build_states: Mapping[str, flags.State],
    rules: RuleSnapshot | Mapping[str, Sequence[Rule]],
    entitled: Collection[str],
    plan_gated: Collection[str],
    user_prefs: Mapping[str, bool] | None = None,
    now: float | None = None,
    registry: Mapping[str, flags.Flag] | None = None,
) -> Decision:
    """One flag's decision for one context.

    `build_states` is `flags.effective()` (or `flags.resolve(...)`); `entitled` is the flags the
    account's plan includes, with any entitlement override; `plan_gated` is
    `billing.plans.plan_gated_flags()`; `user_prefs` maps a flag to the person's own choice
    (`False` switches it off; `True` switches on a beta flag and does nothing for others);
    `now` is the epoch time schedules compare against, fixed per request."""
    evaluator = _Evaluator(
        ctx,
        build_states=build_states,
        rules=rules,
        entitled=entitled,
        plan_gated=plan_gated,
        user_prefs=user_prefs,
        now=now,
        registry=registry,
    )
    return evaluator.decide(flag_id)


@dataclass(frozen=True)
class Decisions:
    """Every flag decided for one context, plus teasers: `locks` maps a plan-locked flag whose
    `when_locked` is `teaser`, or a feature that only needs such flags, to the plan that unlocks
    it (`_Evaluator.teaser`)."""

    version: int
    decisions: Mapping[str, Decision]
    locks: Mapping[str, str]

    def on(self, flag_id: str) -> bool:
        return self.decisions[flag_id].on

    def snapshot(self) -> dict[str, bool]:
        """Every decided flag and whether it's on, for `/api/me`. Never the rules."""
        return {flag_id: decision.on for flag_id, decision in self.decisions.items()}


def decide_all(
    ctx: Context,
    *,
    build_states: Mapping[str, flags.State],
    rules: RuleSnapshot | Mapping[str, Sequence[Rule]],
    entitled: Collection[str],
    plan_gated: Collection[str],
    user_prefs: Mapping[str, bool] | None = None,
    now: float | None = None,
    registry: Mapping[str, flags.Flag] | None = None,
    lock_plans: Mapping[str, str] | None = None,
) -> Decisions:
    """Every flag for one context. A Room guest only gets the guest-scoped flags back (the
    cascade still sees every flag), so the guest page learns nothing about the host's."""
    evaluator = _Evaluator(
        ctx,
        build_states=build_states,
        rules=rules,
        entitled=entitled,
        plan_gated=plan_gated,
        user_prefs=user_prefs,
        now=now,
        registry=registry,
    )
    lock_plans = plan_catalogue.unlocking_plans() if lock_plans is None else lock_plans
    decisions: dict[str, Decision] = {}
    locks: dict[str, str] = {}
    for flag_id, flag in evaluator.registry.items():
        if ctx.is_guest and flag.scope != "guest":
            continue
        decisions[flag_id] = evaluator.decide(flag_id)
        plan = evaluator.teaser(flag_id, lock_plans)
        if plan is not None:
            locks[flag_id] = plan
    return Decisions(
        evaluator.snapshot.version, MappingProxyType(decisions), MappingProxyType(locks)
    )


@dataclass(frozen=True)
class Step:
    """One layer's say on a flag. `on` is None when the layer doesn't apply (local mode has no
    plans or rules; a core flag skips everything)."""

    layer: str
    on: bool | None
    reason: str
    detail: str


@dataclass(frozen=True)
class Explanation:
    flag_id: str
    decision: Decision
    steps: tuple[Step, ...]

    def lines(self) -> list[str]:
        marks = {True: "yes", False: "no", None: "n/a"}
        return [
            f"{step.layer}: {marks[step.on]} ({step.reason}) {step.detail}" for step in self.steps
        ]


def explain(
    flag_id: str,
    ctx: Context,
    *,
    build_states: Mapping[str, flags.State],
    rules: RuleSnapshot | Mapping[str, Sequence[Rule]],
    entitled: Collection[str],
    plan_gated: Collection[str],
    user_prefs: Mapping[str, bool] | None = None,
    now: float | None = None,
    registry: Mapping[str, flags.Flag] | None = None,
) -> Explanation:
    """What every layer says about one flag for one context, and the decision: the answer to
    "what does this user see, and why?". Every layer is shown, even after one says no."""
    ev = _Evaluator(
        ctx,
        build_states=build_states,
        rules=rules,
        entitled=entitled,
        plan_gated=plan_gated,
        user_prefs=user_prefs,
        now=now,
        registry=registry,
    )
    flag = ev.flag(flag_id)
    decision = ev.decide(flag_id)
    if flag.core:
        step = Step(Layer.CORE, True, CORE, flag.core)
        return Explanation(flag_id, decision, (step,))
    steps: list[Step] = []
    build_on, why = ev.build_ok(flag)
    steps.append(Step(Layer.BUILD, build_on, "on" if build_on else BUILD_OFF, why))
    mode_on = ctx.mode in flag.modes
    steps.append(
        Step(
            Layer.MODE,
            mode_on,
            "on" if mode_on else MODE_OFF,
            f"{ctx.mode}; runs in {', '.join(flag.modes)}",
        )
    )
    if ev.local:
        steps.append(Step(Layer.PLAN, None, "local", "local mode has no plans"))
        steps.append(Step(Layer.RULES, None, "local", "local mode has no rules"))
    else:
        gated = flag_id in ev.plan_gated
        plan_on = not gated or flag_id in ev.entitled
        plan_name = ctx.plan or "no plan"
        detail = (
            "every plan has it"
            if not gated
            else f"{plan_name} {'includes' if plan_on else 'does not include'} it"
        )
        steps.append(Step(Layer.PLAN, plan_on, "on" if plan_on else PLAN_LOCKED, detail))
        verdict, detail = ev.rule_verdict(flag)
        steps.append(Step(Layer.RULES, verdict.on, verdict.reason, detail))
    needs = [(need, ev.decide(need) if need in ev.registry else None) for need in flag.requires]
    blocked = [need for need, got in needs if got is None or not got.on]
    detail = (
        ", ".join(f"{need} {got.reason if got else 'missing'}" for need, got in needs)
        or "needs nothing"
    )
    steps.append(Step(Layer.REQUIRES, not blocked, NEEDS + blocked[0] if blocked else "on", detail))
    user_on, detail = ev.preference(flag)
    steps.append(Step(Layer.USER, user_on, "on" if user_on else USER_OFF, detail))
    return Explanation(flag_id, decision, tuple(steps))


@dataclass
class Counts:
    total: int = 0
    changed: int = 0
    turned_on: int = 0
    turned_off: int = 0

    def add(self, before: bool, after: bool) -> None:
        self.total += 1
        if before != after:
            self.changed += 1
            if after:
                self.turned_on += 1
            else:
                self.turned_off += 1


@dataclass(frozen=True)
class FlagImpact:
    flag_id: str
    counts: Counts
    by_plan: dict[str, Counts]


@dataclass(frozen=True)
class Impact:
    """What a proposed rule change would do: per flag (the changed ones and everything that
    needs them), how many of the given contexts change, broken down by plan."""

    contexts: int
    flags: dict[str, FlagImpact]
    dependents: tuple[str, ...]


def dependents_of(
    flag_ids: Iterable[str], registry: Mapping[str, flags.Flag] | None = None
) -> list[str]:
    """Every flag that needs one of these, directly or through others, in registry order."""
    registry = flags.registry() if registry is None else registry
    reached = set(flag_ids)
    grew = True
    while grew:
        grew = False
        for flag in registry.values():
            if flag.id not in reached and any(need in reached for need in flag.requires):
                reached.add(flag.id)
                grew = True
    start = set(flag_ids)
    return [flag_id for flag_id in registry if flag_id in reached and flag_id not in start]


def preview_impact(
    proposed: Mapping[str, Sequence[Rule]],
    contexts: Iterable[Context],
    *,
    build_states: Mapping[str, flags.State],
    current: RuleSnapshot,
    plan_gated: Collection[str] | None = None,
    entitled_for: Callable[[Context], Collection[str]] | None = None,
    user_prefs_for: Callable[[Context], Mapping[str, bool] | None] | None = None,
    now: float | None = None,
    registry: Mapping[str, flags.Flag] | None = None,
) -> Impact:
    """Count, before saving, how many contexts each affected flag changes for. `contexts` is
    whatever the admin page wants counted: accounts, or active sessions."""
    registry = flags.registry() if registry is None else registry
    gated = plan_catalogue.plan_gated_flags() if plan_gated is None else plan_gated
    entitled_for = entitled_for or (lambda c: plan_catalogue.entitled_flags(c.plan, c.plan_version))
    now = time.time() if now is None else now
    after = current.replacing(proposed)
    dependents = dependents_of(proposed, registry)
    affected = [flag_id for flag_id in proposed if flag_id in registry] + dependents
    totals = {flag_id: Counts() for flag_id in affected}
    by_plan: dict[str, dict[str, Counts]] = {flag_id: {} for flag_id in affected}
    seen = 0
    for ctx in contexts:
        seen += 1
        shared = {
            "build_states": build_states,
            "entitled": entitled_for(ctx),
            "plan_gated": gated,
            "user_prefs": user_prefs_for(ctx) if user_prefs_for else None,
            "now": now,
            "registry": registry,
        }
        old = _Evaluator(ctx, rules=current, **shared)
        new = _Evaluator(ctx, rules=after, **shared)
        plan = ctx.plan or "none"
        for flag_id in affected:
            was, will = old.decide(flag_id).on, new.decide(flag_id).on
            totals[flag_id].add(was, will)
            by_plan[flag_id].setdefault(plan, Counts()).add(was, will)
    return Impact(
        contexts=seen,
        flags={
            flag_id: FlagImpact(flag_id, totals[flag_id], by_plan[flag_id]) for flag_id in affected
        },
        dependents=tuple(dependents),
    )
