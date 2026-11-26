"""The Labs opening for music on the member's devices (ADR-0467 step 3, BF-0467-05).

`cloud.local_first` is a release flag, so the generic Labs page (which lists `beta` flags and
stores a preference) cannot open it. ADR-0467 allows a companion instead: `cloud.local_first_labs`
owns the self-serve opt-in surface, and opting in writes a **per-user targeting rule** on
`cloud.local_first` itself, so the beta experience is the real flag decided by the real layers.

- **Opt in** adds the member's user id to the Labs cohort rule: one USERS rule with `on: true`
  and the note `COHORT_NOTE`, created first in the list when absent (rules are first-match-wins;
  an enabled kill switch still wins wherever it sits). The change is refused, and nothing is
  saved, unless `cloud.local_first` would then really be on for this member: the build layer
  must carry `+cloud.local_first`, the plan must allow it, no kill switch may be engaged. So the
  member is never told they are in when they are not (the truthful experience).
- **Opt out** removes the id (and the rule once it is empty). It is owned by the always-on
  `account.labs` feature, never by the Labs companion, so closing Labs can never trap a member in.
- **Feedback** is captured as an audit event (`labs.local_first.feedback`) with the member's
  words scrubbed of secrets; staff read it on the admin audit page.
- **Every layer.** The opt-in and feedback routes are owned by `cloud.local_first_labs`, which
  the account middleware decides per member (build, mode, plan, rules, kill switch), so the owner
  opens Labs to a beta cohort with ordinary rules on the companion and closes it with a kill
  switch or by removing the cohort rule (step ledger rollback for step 3).

The functions are pure over rules plus small database helpers; `routes.local_first_labs` serves
them.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy.engine import Connection

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags import targeting
from selecta.flags.matching import MAX_IDS, Context, Rule, RuleKind, RuleSnapshot

LOCAL_FIRST = "cloud.local_first"
LABS_FLAG = "cloud.local_first_labs"
COHORT_NOTE = "labs: self-serve beta cohort for cloud.local_first (BF-0467-05)"
FEEDBACK_ACTION = "labs.local_first.feedback"
MAX_FEEDBACK = 2000


class LabsRefused(Exception):
    """Opting in would not turn the experience on; `reason` is the decision's machine code."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


def is_cohort_rule(rule: Rule) -> bool:
    return (
        rule.kind == RuleKind.USERS
        and rule.params.get("note") == COHORT_NOTE
        and rule.params.get("on") is True
    )


def cohort(rules: Sequence[Rule]) -> frozenset[str]:
    """Every user id the Labs cohort rules name."""
    return frozenset(
        user_id for rule in rules if is_cohort_rule(rule) for user_id in rule.params.get("ids", ())
    )


def enrolled(rules: Sequence[Rule], user_id: str) -> bool:
    return user_id in cohort(rules)


def _cohort_rule(ids: Collection[str]) -> Rule:
    return Rule(RuleKind.USERS, {"ids": sorted(ids), "on": True, "note": COHORT_NOTE})


def with_member(rules: Sequence[Rule], user_id: str) -> tuple[Rule, ...]:
    """The rules with `user_id` in the cohort: added to the first cohort rule with room, or a new
    cohort rule placed first."""
    if enrolled(rules, user_id):
        return tuple(rules)
    out = list(rules)
    for position, rule in enumerate(out):
        ids = list(rule.params.get("ids", ()))
        if is_cohort_rule(rule) and len(ids) < MAX_IDS:
            out[position] = Rule(rule.kind, {**rule.params, "ids": sorted([*ids, user_id])},
                                 rule.enabled)
            return tuple(out)
    return (_cohort_rule([user_id]), *out)


def without_member(rules: Sequence[Rule], user_id: str) -> tuple[Rule, ...]:
    """The rules with `user_id` out of every cohort rule; an emptied cohort rule is removed."""
    out: list[Rule] = []
    for rule in rules:
        if is_cohort_rule(rule) and user_id in rule.params.get("ids", ()):
            ids = [item for item in rule.params["ids"] if item != user_id]
            if ids:
                out.append(Rule(rule.kind, {**rule.params, "ids": ids}, rule.enabled))
            continue
        out.append(rule)
    return tuple(out)


@dataclass(frozen=True)
class Layers:
    """What a decision needs besides the rules: the caller's context and plan answers."""

    context: Context
    entitled: Collection[str]
    plan_gated: Collection[str]
    user_prefs: Mapping[str, bool]
    now: float
    build_states: Mapping[str, flags.State] | None = None


def decide(snapshot: RuleSnapshot, layers: Layers, flag_id: str = LOCAL_FIRST):
    return targeting.decide(
        flag_id,
        layers.context,
        build_states=flags.effective() if layers.build_states is None else layers.build_states,
        rules=snapshot,
        entitled=layers.entitled,
        plan_gated=layers.plan_gated,
        user_prefs=layers.user_prefs,
        now=layers.now,
    )


REFUSALS = {
    targeting.BUILD_OFF: "Music on your devices isn't switched on in this build.",
    targeting.MODE_OFF: "Music on your devices isn't available on this site.",
    targeting.PLAN_LOCKED: "Your plan doesn't include music on your devices.",
    targeting.RULE_OFF: "Music on your devices is paused right now.",
    targeting.USER_OFF: "You've switched music on your devices off.",
}


def status(snapshot: RuleSnapshot, layers: Layers) -> dict:
    """What the Labs card shows: is the member in the cohort, and is the experience really on."""
    user_id = layers.context.user_id or ""
    decision = decide(snapshot, layers)
    return {
        "flag": LOCAL_FIRST,
        "enrolled": enrolled(snapshot.for_flag(LOCAL_FIRST), user_id),
        "on": decision.on,
        "reason": decision.reason,
        "rule_version": snapshot.version,
    }


def join(conn: Connection, snapshot: RuleSnapshot, layers: Layers, *, author: str) -> dict:
    """Opt the member in, only if that really turns the experience on (see the module notes)."""
    user_id = layers.context.user_id
    if not user_id:
        raise LabsRefused("no_user", "Sign in to join Labs.")
    current = flag_rules.current_rules(conn, LOCAL_FIRST)
    proposed = with_member(current, user_id)
    after = decide(snapshot.replacing({LOCAL_FIRST: proposed}), layers)
    if not after.on:
        message = REFUSALS.get(after.reason, "Music on your devices can't be switched on for you.")
        raise LabsRefused(after.reason, message)
    version = snapshot.version
    if proposed != current:
        saved = flag_rules.save(
            conn, LOCAL_FIRST, proposed, author=author, reason="Labs opt-in (BF-0467-05)"
        )
        version = saved.version
    return {"flag": LOCAL_FIRST, "enrolled": True, "on": True, "reason": after.reason,
            "rule_version": version}


def leave(conn: Connection, user_id: str, *, author: str) -> dict:
    """Opt the member out. Always allowed; a member who wasn't in is simply not in."""
    current = flag_rules.current_rules(conn, LOCAL_FIRST)
    proposed = without_member(current, user_id)
    version = None
    if proposed != current:
        saved = flag_rules.save(
            conn, LOCAL_FIRST, proposed, author=author, reason="Labs opt-out (BF-0467-05)"
        )
        version = saved.version
    return {"flag": LOCAL_FIRST, "enrolled": False, "rule_version": version}


def feedback(
    conn: Connection,
    *,
    user_id: str,
    workspace_id: str,
    text: str,
    enrolled_now: bool,
    request_id: str | None = None,
) -> str:
    """Record one piece of Labs feedback; returns the audit event id."""
    from selecta.authz import audit

    words = (text or "").strip()
    if not words:
        raise ValueError("Say what you noticed.")
    return audit.record(
        conn,
        action=FEEDBACK_ACTION,
        result=audit.AuditResult.SUCCESS,
        actor_id=user_id,
        resource_type="flag",
        resource_id=LOCAL_FIRST,
        workspace_id=workspace_id,
        reason=words[:MAX_FEEDBACK],
        request_id=request_id,
        metadata={"enrolled": enrolled_now},
    )


__all__ = [
    "COHORT_NOTE",
    "FEEDBACK_ACTION",
    "LABS_FLAG",
    "LOCAL_FIRST",
    "Layers",
    "LabsRefused",
    "cohort",
    "enrolled",
    "feedback",
    "is_cohort_rule",
    "join",
    "leave",
    "status",
    "with_member",
    "without_member",
]
