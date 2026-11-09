"""Who gets a feature in the cloud, decided per request, job or Lucy turn (ADR-0414).

A feature reaches someone only if four layers all say yes (docs/saas/11b-feature-flags.md §11B.2):

1. Build: `SELECTA_FLAGS` and the JSON defaults, exactly as today (`flags.resolve`).
2. Mode: the flag's `modes` include the runtime mode (local or cloud).
3. Plan: the account's plan includes it, if any plan gates it. This is the only layer that can
   lock a feature for an account; targeting rules can never undo it.
4. Rules: the admin's targeting rules for that flag, in order, the first that matches deciding.
   When none match, the flag stays as the layers above left it: on.

Then today's `requires` cascade runs over the result, and the person's own preference comes last.

Rules switch features off or roll them out; they never grant what the build, the mode or the plan
doesn't allow, and core flags can't be targeted at all. An enabled kill switch wins over every
other rule and over staff previews, wherever it sits in the list. Local mode has no plans and no
rules: a decision there is the build and mode layers, the cascade and the person's preference.

Everything here is pure: the caller hands in the build states, a `RuleSnapshot` and the plan's
flags, so a decision never touches the database and the same inputs always give the same answer.
`flags/rules.py` stores the rules and keeps a snapshot per process.
"""

from __future__ import annotations

import enum
import hashlib
import math
import re
import time
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from selecta import flags
from selecta.billing import plans as plan_catalogue

BUCKETS = 10_000
MAX_IDS = 10_000

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


class Layer(enum.StrEnum):
    CORE = "core"
    BUILD = "build"
    MODE = "mode"
    PLAN = "plan"
    RULES = "rules"
    REQUIRES = "requires"
    USER = "user"


class RuleKind(enum.StrEnum):
    KILL_SWITCH = "kill_switch"
    USERS = "users"
    WORKSPACES = "workspaces"
    SEGMENT = "segment"
    PERCENTAGE = "percentage"
    SCHEDULE = "schedule"


@dataclass(frozen=True)
class Context:
    """Who is asking, built once per request, job attempt, SSE connection or Lucy turn.

    A Room guest is a context with `guest_room_id` and no `user_id`; it carries the host's
    workspace and plan, because the host's rules and plan apply to their room."""

    environment: str = "production"
    mode: str = "cloud"
    workspace_id: str | None = None
    user_id: str | None = None
    plan: str | None = None
    plan_version: int | None = None
    staff_roles: frozenset[str] = frozenset()
    account_age_days: float | None = None
    country: str | None = None
    client_version: str | None = None
    device_kind: str | None = None
    guest_room_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "staff_roles", frozenset(self.staff_roles))

    @property
    def is_guest(self) -> bool:
        return self.guest_room_id is not None and self.user_id is None


@dataclass(frozen=True)
class Decision:
    on: bool
    layer: str
    reason: str


# A compiled rule: says on (True), off (False) or "not for this context" (None).
Matcher = Callable[[flags.Flag, Context, float], bool | None]

SEGMENT_KEYS = frozenset(
    {"plans", "staff", "min_account_age_days", "countries", "min_client_version", "device_kinds"}
)
_ALLOWED = {
    RuleKind.KILL_SWITCH: frozenset({"note"}),
    RuleKind.USERS: frozenset({"ids", "on", "note"}),
    RuleKind.WORKSPACES: frozenset({"ids", "on", "note"}),
    RuleKind.SEGMENT: SEGMENT_KEYS | {"on", "note"},
    RuleKind.PERCENTAGE: SEGMENT_KEYS | {"percent", "salt", "note"},
    RuleKind.SCHEDULE: SEGMENT_KEYS | {"from", "until", "on", "note"},
}


@dataclass(frozen=True)
class Rule:
    """One targeting rule. `params` by kind (every kind also takes a free-text `note`):

    - `kill_switch`: nothing. Off for everyone, now.
    - `users` / `workspaces`: `ids`, and `on` (default false): these accounts get `on`.
    - `segment`: any of `plans`, `staff`, `min_account_age_days`, `countries`,
      `min_client_version`, `device_kinds`, all of which must hold; and `on` (default false).
    - `percentage`: `percent` (0 to 100) and `salt`, plus optional segment keys. Within the
      segment, on for that share of accounts, off for the rest.
    - `schedule`: `from` and/or `until` as UTC epoch seconds, `on` (default true), plus optional
      segment keys. Within the segment, `on` inside the window and the opposite outside it.
    """

    kind: str
    params: Mapping[str, Any] = field(default_factory=dict)
    enabled: bool = True
    problems: tuple[str, ...] = field(init=False, repr=False, compare=False)
    matcher: Matcher | None = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        params = dict(self.params)
        found, matcher = _compile(self.kind, params)
        if not isinstance(self.enabled, bool):
            found.append("enabled should be true or false")
        object.__setattr__(self, "params", MappingProxyType(params))
        object.__setattr__(self, "problems", tuple(found))
        object.__setattr__(self, "matcher", None if found else matcher)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Rule:
        return cls(
            kind=str(data.get("kind", "")),
            params=dict(data.get("params") or {}),
            enabled=data.get("enabled", True),
        )

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "params": dict(self.params), "enabled": self.enabled}


@dataclass(frozen=True)
class RuleSnapshot:
    """Every flag's rules and staff previews at one version. Immutable, so a request, job
    attempt or Lucy turn can hold one and never see a flag flip halfway through."""

    version: int = 0
    rules: Mapping[str, tuple[Rule, ...]] = field(default_factory=dict)
    # flag id -> user id -> when the preview ends (epoch seconds), or None for no end.
    previews: Mapping[str, Mapping[str, float | None]] = field(default_factory=dict)

    def for_flag(self, flag_id: str) -> tuple[Rule, ...]:
        return self.rules.get(flag_id, ())

    def previewing(self, flag_id: str, user_id: str | None, now: float) -> bool:
        if user_id is None:
            return False
        users = self.previews.get(flag_id)
        if not users or user_id not in users:
            return False
        ends = users[user_id]
        return ends is None or now < ends

    def replacing(self, changes: Mapping[str, Sequence[Rule]]) -> RuleSnapshot:
        """This snapshot with some flags' rules replaced, for an impact preview."""
        rules = dict(self.rules)
        for flag_id, proposed in changes.items():
            rules[flag_id] = tuple(proposed)
        return RuleSnapshot(self.version, rules, self.previews)

    @property
    def broken(self) -> dict[str, list[str]]:
        """Stored rules that no longer make sense (they're skipped), for the admin page."""
        found: dict[str, list[str]] = {}
        for flag_id, rules in self.rules.items():
            for position, rule in enumerate(rules):
                if rule.problems:
                    found.setdefault(flag_id, []).append(
                        f"rule {position + 1}: " + "; ".join(rule.problems)
                    )
        return found


EMPTY = RuleSnapshot()


def bucket(flag_id: str, salt: str, unit_id: str) -> int:
    """A stable number from 0 to 9,999 for one account and flag. The same on every device and
    every instance; changing the salt reshuffles everyone."""
    digest = hashlib.sha256(f"{flag_id}|{salt}|{unit_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % BUCKETS


def unit_for(scope: str, ctx: Context) -> str | None:
    """The id a flag's scope hashes, so workspace features don't change when a different
    member signs in, and every guest in a room gets the same answer."""
    if scope == "user":
        return ctx.user_id
    if scope == "guest":
        return ctx.guest_room_id
    return ctx.workspace_id


def parse_version(text: str | None) -> tuple[int, ...] | None:
    """`"1.4.2"`, `"v1.4"` or `"1.4.2-beta"` as numbers to compare; None if it has no numbers."""
    if not text:
        return None
    found = re.match(r"^v?(\d+(?:\.\d+)*)", text.strip())
    if not found:
        return None
    return tuple(int(part) for part in found.group(1).split("."))


def _at_least(have: tuple[int, ...], want: tuple[int, ...]) -> bool:
    width = max(len(have), len(want))
    return have + (0,) * (width - len(have)) >= want + (0,) * (width - len(want))


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _strings(value: Any, key: str, found: list[str]) -> list[str]:
    if not isinstance(value, list | tuple) or not value:
        found.append(f"{key} should be a list with at least one entry")
        return []
    if len(value) > MAX_IDS:
        found.append(f"{key} can list at most {MAX_IDS:,}")
    if not all(isinstance(item, str) and item.strip() for item in value):
        found.append(f"{key} should only hold non-empty text")
        return []
    return list(value)


def _segment(params: Mapping[str, Any], found: list[str]) -> list[Callable[[Context], bool]]:
    tests: list[Callable[[Context], bool]] = []
    if "plans" in params:
        named = _strings(params["plans"], "plans", found)
        unknown = [plan for plan in named if plan not in plan_catalogue.PLAN_IDS]
        if unknown:
            found.append(f"plans names {', '.join(unknown)}, which aren't plans")
        plans = frozenset(named)
        tests.append(lambda ctx: ctx.plan in plans)
    if "staff" in params:
        staff = params["staff"]
        if not isinstance(staff, bool):
            found.append("staff should be true or false")
        tests.append(lambda ctx: bool(ctx.staff_roles) == staff)
    if "min_account_age_days" in params:
        days = params["min_account_age_days"]
        if not _is_number(days) or days < 0:
            found.append("min_account_age_days should be a number of days, 0 or more")
        tests.append(lambda ctx: ctx.account_age_days is not None and ctx.account_age_days >= days)
    if "countries" in params:
        codes = [code.upper() for code in _strings(params["countries"], "countries", found)]
        if any(not re.fullmatch(r"[A-Z]{2}", code) for code in codes):
            found.append("countries should be two-letter codes such as GB")
        countries = frozenset(codes)
        tests.append(lambda ctx: (ctx.country or "").upper() in countries)
    if "min_client_version" in params:
        raw = params["min_client_version"]
        want = parse_version(raw) if isinstance(raw, str) else None
        if want is None:
            found.append("min_client_version should be a version such as 1.4.0")
            want = ()
        tests.append(lambda ctx: _client_at_least(ctx, want))
    if "device_kinds" in params:
        kinds = frozenset(
            kind.lower() for kind in _strings(params["device_kinds"], "device_kinds", found)
        )
        tests.append(lambda ctx: (ctx.device_kind or "").lower() in kinds)
    return tests


def _client_at_least(ctx: Context, want: tuple[int, ...]) -> bool:
    have = parse_version(ctx.client_version)
    return have is not None and _at_least(have, want)


def _bool_param(params: Mapping[str, Any], key: str, default: bool, found: list[str]) -> bool:
    value = params.get(key, default)
    if not isinstance(value, bool):
        found.append(f"{key} should be true or false")
        return default
    return value


def _compile(kind: str, params: Mapping[str, Any]) -> tuple[list[str], Matcher | None]:
    """Check a rule's params and turn them into a matcher. Problems are said so an admin can
    act on them."""
    try:
        rule_kind = RuleKind(kind)
    except ValueError:
        kinds = ", ".join(kind.value for kind in RuleKind)
        return [f"{kind!r} isn't a kind of rule; kinds are {kinds}"], None
    found: list[str] = []
    extra = sorted(set(params) - _ALLOWED[rule_kind])
    if extra:
        found.append(f"a {rule_kind} rule doesn't take {', '.join(extra)}")
    if "note" in params and not isinstance(params["note"], str):
        found.append("note should be text")

    if rule_kind is RuleKind.KILL_SWITCH:
        return found, lambda flag, ctx, now: False

    if rule_kind in (RuleKind.USERS, RuleKind.WORKSPACES):
        ids = frozenset(_strings(params.get("ids"), "ids", found))
        on = _bool_param(params, "on", False, found)
        if rule_kind is RuleKind.USERS:
            return found, lambda flag, ctx, now: on if ctx.user_id in ids else None
        return found, lambda flag, ctx, now: on if ctx.workspace_id in ids else None

    tests = _segment(params, found)

    if rule_kind is RuleKind.SEGMENT:
        if not tests:
            found.append("a segment needs at least one condition; use a kill switch for everyone")
        on = _bool_param(params, "on", False, found)
        return found, lambda flag, ctx, now: on if all(test(ctx) for test in tests) else None

    if rule_kind is RuleKind.PERCENTAGE:
        percent = params.get("percent")
        if not _is_number(percent) or not 0 <= percent <= 100:
            found.append("percent should be a number from 0 to 100")
            percent = 0
        salt = params.get("salt", "")
        if not isinstance(salt, str):
            found.append("salt should be text")
            salt = ""
        threshold = round(percent * 100)

        def rollout(flag: flags.Flag, ctx: Context, now: float) -> bool | None:
            if not all(test(ctx) for test in tests):
                return None
            if threshold >= BUCKETS:
                return True
            unit = unit_for(flag.scope, ctx)
            # Without an id there's no stable answer, so only a full rollout includes them.
            return unit is not None and bucket(flag.id, salt, unit) < threshold

        return found, rollout

    start, end = params.get("from"), params.get("until")
    for key, value in (("from", start), ("until", end)):
        if value is not None and not _is_number(value):
            found.append(f"{key} should be a time in UTC epoch seconds")
    if start is None and end is None:
        found.append("a schedule needs from, until or both")
    elif _is_number(start) and _is_number(end) and start >= end:
        found.append("a schedule's from should be before its until")
    on = _bool_param(params, "on", True, found)

    def scheduled(flag: flags.Flag, ctx: Context, now: float) -> bool | None:
        if not all(test(ctx) for test in tests):
            return None
        inside = (start is None or now >= start) and (end is None or now < end)
        return on if inside else not on

    return found, scheduled


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
        if found.on and not flag.core and self.user_prefs.get(flag_id) is False:
            found = Decision(False, Layer.USER, USER_OFF)
        self.decided[flag_id] = found
        return found

    def teasable(self, flag_id: str) -> bool:
        """Locked by the plan alone: a rule would leave it on and what it needs is on or locked
        too. A feature a rule switched off is hidden, never teased."""
        flag = self.flag(flag_id)
        if flag.when_locked != "teaser" or self.decide(flag_id).reason != PLAN_LOCKED:
            return False
        if not self.rule_verdict(flag)[0].on:
            return False
        for need in flag.requires:
            if need not in self.registry:
                return False
            decided = self.decide(need)
            if not decided.on and decided.reason != PLAN_LOCKED:
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
    `billing.plans.plan_gated_flags()`; `user_prefs` maps a flag to the person's own choice;
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
    `when_locked` is `teaser` to the cheapest plan that includes it."""

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
        if flag_id in lock_plans and evaluator.teasable(flag_id):
            locks[flag_id] = lock_plans[flag_id]
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
            else f"{plan_name} {'includes' if plan_on else 'leaves out'} it"
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
    choice = ev.user_prefs.get(flag_id)
    user_on = choice is not False
    detail = "no choice made" if choice is None else ("chose on" if choice else "chose off")
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
