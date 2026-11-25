"""The check that refuses an unsafe change to `lucy.usage_windows`'s rules (ADR-0487 rule 5,
LM-0487-07).

The rollout goes staff accounts, then 5%, 25% and 100% of workspaces, each step held for a full
week and none past staff until the release gates are green. `check` is the pure core: hand it
the rules as saved and as proposed, the change's reason, when the percentage last went up and
the time now, and get back a list of refusals in plain sentences, empty when the change may go
ahead. What it refuses:

- **A salt other than `SALT`.** A percentage rule puts each workspace in a fixed place worked
  out from the flag, the salt and the workspace id. A new salt gives everyone a new place, so
  most of the workspaces already switched would silently go back mid-week and others would be
  switched with no notice.
- **A raise too soon, or with nobody answering for the gates.** The highest percentage may go
  up only when `DWELL_DAYS` have passed since it last went up, and only when the reason carries
  `MARKER`: a person saying docs/verification/lm-gate-register.md is green. The first raise
  above nothing needs the marker too. No code can know the register's state.
- **A percentage rule with no staff rule in front of it.** A percentage rule answers for
  everyone: on inside its share, off outside. Placed first it would switch off the staff
  accounts outside the share, so a WORKSPACES rule granting the staff accounts goes before it.

Going back is never refused. A change that only removes or disables rules, lowers percentages,
or adds a kill switch or a rule that switches accounts off passes whatever the rules look like.

The week between raises is counted here from when the raise was saved. A workspace switches at
its next month start (rule 6), which is later, so this is the least the wait can be: the
operator still holds each step for a full week after its switch (the step ledger).

`check_change_now` is the same check against the stored rules and history. The admin change
path runs it when a change is proposed, and again when a change that waited as a delayed action
is carried out, since another raise may have been saved meanwhile. Neither changes anything.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from selecta.flags.flip_guard import highest_percentage
from selecta.flags.matching import Rule, RuleKind

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

    from selecta.flags.rules import Version

FLAG = "lucy.usage_windows"
SALT = "lm-usage-windows"
DWELL_DAYS = 7
MARKER = "[lm-gates-green]"
DAY = 86_400.0
GATE_REGISTER = "docs/verification/lm-gate-register.md"
RUNBOOK = "docs/operations/lucy-usage-rollout-runbook.md"
ROLLOUT_ACTION_REFUSAL = (
    f"the rollout action is not used for {FLAG}: it puts its rule in front of the staff rule "
    "and makes up a new salt. Save the whole rule list with set_rules, the staff WORKSPACES "
    f"rule first and the percentage rule after it with the salt {SALT!r} ({RUNBOOK})"
)
_OFF_KINDS = (RuleKind.USERS, RuleKind.WORKSPACES, RuleKind.SEGMENT)


def _is_off_rule(rule: Rule) -> bool:
    """A kill switch, or a rule that only switches the accounts it names off."""
    if rule.kind == RuleKind.KILL_SWITCH:
        return True
    return rule.kind in _OFF_KINDS and rule.params.get("on", False) is not True


def _shape(rule: Rule) -> tuple[str, dict[str, Any]]:
    """What a rule is apart from its note and how large its percentage is."""
    params: Mapping[str, Any] = rule.params
    return rule.kind, {
        key: value for key, value in params.items() if key not in ("note", "percent")
    }


def _percent(rule: Rule) -> float:
    value = rule.params.get("percent")
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0.0


def _no_wider(old: Rule, new: Rule) -> bool:
    if _shape(old) != _shape(new):
        return False
    if old.kind == RuleKind.PERCENTAGE and _percent(new) > _percent(old):
        return False
    return old.enabled or not new.enabled


def is_retreat(before: Sequence[Rule], after: Sequence[Rule]) -> bool:
    """Whether the change only goes back: every rule that can switch an account on was already
    there, in the same order, and no percentage is higher. Rules may be removed, disabled or
    lowered, and kill switches and off rules may be added anywhere."""
    waiting = list(before)
    for rule in after:
        if not rule.enabled or _is_off_rule(rule):
            continue
        while waiting and not _no_wider(waiting[0], rule):
            waiting.pop(0)
        if not waiting:
            return False
        waiting.pop(0)
    return True


def _is_staff_grant(rule: Rule) -> bool:
    return (
        rule.enabled
        and not rule.problems
        and rule.kind == RuleKind.WORKSPACES
        and rule.params.get("on") is True
        and bool(rule.params.get("ids"))
    )


def check(
    before_rules: Sequence[Rule],
    after_rules: Sequence[Rule],
    *,
    reason: str,
    last_raise_at: float | None,
    now: float,
) -> list[str]:
    """Every reason this change to `lucy.usage_windows`'s rules must be refused. Empty when it
    may go ahead. `last_raise_at` is when the highest percentage last went up (`last_raise_at`
    below reads it from the rule history), or None when it never has."""
    if is_retreat(before_rules, after_rules):
        return []
    refusals: list[str] = []

    for position, rule in enumerate(after_rules, start=1):
        if rule.kind == RuleKind.PERCENTAGE and rule.params.get("salt") != SALT:
            refusals.append(
                f"rule {position} is a percentage rule with the salt"
                f" {rule.params.get('salt', '')!r}: every percentage rule on {FLAG} uses the"
                f" salt {SALT!r}. A new salt gives every workspace a new place, so most of"
                " those already switched would go back and others would be switched with no"
                " notice"
            )

    staff_seen = False
    for position, rule in enumerate(after_rules, start=1):
        staff_seen = staff_seen or _is_staff_grant(rule)
        if rule.enabled and rule.kind == RuleKind.PERCENTAGE and not staff_seen:
            refusals.append(
                f"rule {position} is a percentage rule with no staff rule in front of it: put"
                " a WORKSPACES rule with on=true naming the staff workspaces before it. A"
                " percentage rule answers off outside its share, so placed first it switches"
                " those staff accounts off"
            )
            break

    was, wanted = highest_percentage(before_rules), highest_percentage(after_rules)
    if wanted > was:
        if MARKER not in reason:
            refusals.append(
                f"raising {FLAG} from {was:g}% to {wanted:g}% needs a person to say the release"
                f" gates are green: check {GATE_REGISTER}, then put {MARKER} in the reason"
            )
        if last_raise_at is not None and now - last_raise_at < DWELL_DAYS * DAY:
            waited = max(0.0, now - last_raise_at) / DAY
            refusals.append(
                f"the percentage last went up {waited:.1f} days ago: each step is held for at"
                f" least {DWELL_DAYS} days so every account passes a weekly reset before more"
                " are added (ADR-0487 rule 5)"
            )
    return refusals


def raise_time(history: Iterable[Version]) -> float | None:
    """When the highest percentage last went up, from `rules.history(conn, FLAG)` rows (newest
    first). Only changes that replaced the rules count, never a preview toggle."""
    saves = [
        version for version in history
        if version.flag_id == FLAG and version.change in ("rules", "rollback")
    ]
    for index, version in enumerate(saves):
        older = saves[index + 1].rules if index + 1 < len(saves) else ()
        if highest_percentage(version.rules) > highest_percentage(older):
            return version.created_at
    return None


def last_raise_at(conn: Connection, *, history_limit: int = 500) -> float | None:
    """`raise_time` read from the stored rule history."""
    from selecta.flags import rules as rule_store

    return raise_time(rule_store.history(conn, FLAG, limit=history_limit))


def check_change_now(
    conn: Connection, action: str, proposed: Sequence[Rule], *, reason: str = "",
    now: float | None = None,
) -> list[str]:
    """`check` against the stored rules and history, for one admin change. The "rollout" action
    is refused outright: it adds its rule first and makes up a salt."""
    from selecta.flags import rules as rule_store
    from selecta.persistence import db_now

    if action == "rollout":
        return [ROLLOUT_ACTION_REFUSAL]
    return check(
        rule_store.current_rules(conn, FLAG),
        proposed,
        reason=reason,
        last_raise_at=last_raise_at(conn),
        now=db_now(conn) if now is None else now,
    )


__all__ = [
    "DWELL_DAYS",
    "FLAG",
    "MARKER",
    "ROLLOUT_ACTION_REFUSAL",
    "SALT",
    "check",
    "check_change_now",
    "is_retreat",
    "last_raise_at",
    "raise_time",
]
