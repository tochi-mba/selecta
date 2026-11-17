"""The release-gate check that refuses turning `cloud.local_first` default on (BF-0467-01).

ADR-0467 step 5: the default flips only after the grandfather rule exists, is verified against
the detection query, and the ADR-0466 release-critical gates are green; the refusal names what is
missing, and no manual override exists below the owner. This module is that check, pure: hand it
the rule state and the answers, get back a list of refusals, empty when the flip may proceed.

What it checks, and why, in ADR-0414 terms (`flags/targeting.py`):

- Rules are first-match-wins and an unmatched context keeps the flag **on**, so per-account
  granting of `cloud.hosted_media` is grant rules first and a trailing catch-all off rule for
  everyone else. The canonical catch-all is a `percentage` rule at 0 percent with no segment
  conditions: it matches every context and answers off (and is later the staged dial). A kill
  switch is never the catch-all, because it wins over the grants wherever it sits.
- A cloud flag that is off at the build layer never reaches its rules, so `cloud.hosted_media`
  must be on in this build's flags (`SELECTA_FLAGS`) for the grants to count.
- The grandfather verification (BF-0465-01: the detection query compared against the grants) is
  a human act recorded in the flag's own change history: the rules are saved with a reason
  containing `GRANDFATHER_MARKER` once the comparison passed (docs/operations/
  bf-rollout-runbook.md). `grandfather_marker_recorded` reads it from `rules.history` rows;
  `check_flip` takes the answer as a bool so it stays pure.
- The gates answer (`gates_green`) comes from the human-maintained register,
  docs/verification/bf-gate-register.md: every release-critical row GO. No code can know that.

`check_flip` is the pure core; `check_flip_now` is the convenience that reads the rule store
through a connection. Neither touches FastAPI, and neither flips anything: the caller flips only
on an empty list.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING

from selecta import flags
from selecta.flags.matching import SEGMENT_KEYS, Rule, RuleKind, RuleSnapshot

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

    from selecta.flags.rules import Version

HOSTED_MEDIA = "cloud.hosted_media"
LOCAL_FIRST = "cloud.local_first"
# Written into a rule change's reason once the grandfather grants were verified against the
# detection query (docs/operations/bf-rollout-runbook.md, step 4).
GRANDFATHER_MARKER = "[grandfather-verified]"
GRANT_KINDS = (RuleKind.USERS, RuleKind.WORKSPACES)


def _hosted_rules(
    rules: RuleSnapshot | Mapping[str, Sequence[Rule]] | Sequence[Rule],
) -> tuple[Rule, ...]:
    """The `cloud.hosted_media` rules, from a snapshot, a flag-to-rules mapping, or the flag's
    own rule list."""
    if isinstance(rules, RuleSnapshot):
        return rules.for_flag(HOSTED_MEDIA)
    if isinstance(rules, Mapping):
        return tuple(rules.get(HOSTED_MEDIA, ()))
    return tuple(rules)


def _is_grant(rule: Rule) -> bool:
    """An enabled USERS or WORKSPACES rule that switches the flag on for named accounts."""
    return (
        rule.enabled
        and not rule.problems
        and rule.kind in GRANT_KINDS
        and rule.params.get("on") is True
        and bool(rule.params.get("ids"))
    )


def _is_catch_all_off(rule: Rule) -> bool:
    """A zero-percent percentage rule with no segment conditions: matches every context and
    answers off, so every account the grants did not name gets no hosted media."""
    return (
        rule.enabled
        and not rule.problems
        and rule.kind == RuleKind.PERCENTAGE
        and rule.params.get("percent") == 0
        and not (SEGMENT_KEYS & set(rule.params))
    )


def check_flip(
    rules: RuleSnapshot | Mapping[str, Sequence[Rule]] | Sequence[Rule],
    flags_effective: Mapping[str, flags.State] | None = None,
    *,
    grandfather_verified: bool,
    gates_green: bool,
) -> list[str]:
    """Every reason turning `cloud.local_first` default on must be refused right now.

    `rules` is a `RuleSnapshot` (or a flag-to-rules mapping, or `cloud.hosted_media`'s own rule
    list); `flags_effective` is `flags.effective()` unless the caller holds another build's
    states; `grandfather_verified` is whether the BF-0465-01 verification is recorded (see
    `grandfather_marker_recorded`); `gates_green` is the gate register's answer. Empty means the
    flip may proceed - subject, always, to the owner's recorded decision (BF-0467-06)."""
    refusals: list[str] = []

    states = flags.effective() if flags_effective is None else flags_effective
    state = states.get(HOSTED_MEDIA)
    if state is None:
        refusals.append(
            f"{HOSTED_MEDIA} is not in this build's flags: register it and turn it on"
            f" (SELECTA_FLAGS +{HOSTED_MEDIA}) so its grant rules can run"
        )
    elif not state.on:
        refusals.append(
            f"{HOSTED_MEDIA} is off at the build layer ({state.why}), so its grant rules never"
            f" run: add +{HOSTED_MEDIA} to SELECTA_FLAGS"
        )

    rule_list = _hosted_rules(rules)
    for position, rule in enumerate(rule_list, start=1):
        if rule.problems:
            refusals.append(
                f"{HOSTED_MEDIA} rule {position} is broken and would be skipped:"
                f" {'; '.join(rule.problems)}"
            )
    enabled = [rule for rule in rule_list if rule.enabled]
    if any(rule.kind == RuleKind.KILL_SWITCH for rule in enabled):
        refusals.append(
            f"an enabled kill switch sits in {HOSTED_MEDIA}'s rules: it turns the flag off for"
            " everyone, grandfathered grants included; remove it before the flip"
        )
    if not any(_is_grant(rule) for rule in rule_list):
        refusals.append(
            f"no USERS or WORKSPACES grant with on=true exists for {HOSTED_MEDIA}: the"
            " grandfathered accounts (every account with a completed upload) have no grant"
        )
    if not enabled or not _is_catch_all_off(enabled[-1]):
        refusals.append(
            f"the last enabled rule for {HOSTED_MEDIA} is not a catch-all off rule (a percentage"
            " rule at 0 percent with no segment conditions): unmatched accounts would keep"
            " hosted media by default"
        )

    if not grandfather_verified:
        refusals.append(
            "the grandfather verification is not recorded: compare the detection query against"
            f" the grants, then save the rules with a reason containing {GRANDFATHER_MARKER}"
            " (docs/operations/bf-rollout-runbook.md, step 4)"
        )
    if not gates_green:
        refusals.append(
            "the ADR-0466 release-critical gates are not green:"
            " docs/verification/bf-gate-register.md"
        )
    return refusals


def grandfather_marker_recorded(history: Iterable[Version]) -> bool:
    """Whether any rule change for `cloud.hosted_media` recorded the verification marker in its
    reason. `history` is `selecta.flags.rules.history(conn, HOSTED_MEDIA)` rows (any change that
    replaced the rules counts: a plain save or a rollback, never a preview toggle)."""
    return any(
        version.flag_id == HOSTED_MEDIA
        and version.change in ("rules", "rollback")
        and GRANDFATHER_MARKER in version.reason
        for version in history
    )


def check_flip_now(
    conn: Connection,
    *,
    gates_green: bool,
    flags_effective: Mapping[str, flags.State] | None = None,
    history_limit: int = 500,
) -> list[str]:
    """`check_flip` against the stored rules: loads the snapshot and the flag's change history
    through `conn` and derives `grandfather_verified` from the recorded marker. `gates_green`
    stays a human answer, read from the gate register."""
    from selecta.flags import rules as rule_store

    snapshot = rule_store.load_snapshot(conn)
    history = rule_store.history(conn, HOSTED_MEDIA, limit=history_limit)
    return check_flip(
        snapshot,
        flags_effective,
        grandfather_verified=grandfather_marker_recorded(history),
        gates_green=gates_green,
    )
