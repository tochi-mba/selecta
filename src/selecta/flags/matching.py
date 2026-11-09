"""The targeting rule language: who is asking (`Context`), the rules an admin writes, and how
each rule matches (ADR-0414, docs/saas/11b-feature-flags.md §11B.3).

A rule is checked when it's made: `Rule.problems` says everything wrong with it, in words an
admin can act on, and only a rule with no problems gets a matcher. A matcher answers on, off, or
"not for this context", and the first rule that answers decides (see `flags/targeting.py`).

Percentage rollouts hash `flag_id|salt|id` with SHA-256 into a bucket from 0 to 9,999, where the
id is chosen by the flag's `scope`. The same account gets the same bucket on every device and every
instance, and raising the percentage only ever adds accounts.
"""

from __future__ import annotations

import enum
import hashlib
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from selecta import flags
from selecta.billing import plans as plan_catalogue

BUCKETS = 10_000
MAX_IDS = 10_000


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
