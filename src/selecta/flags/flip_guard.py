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
  `check_flip` takes the answer as a bool so it stays pure. The mechanical half of that
  comparison (`hosted_coexistence.grandfather.audit_grandfather_rules`, ADR-0465) is passed in
  as `grandfather_missing`; `check_flip_now` computes it from the database.
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
    grandfather_missing: Sequence[str] = (),
) -> list[str]:
    """Every reason turning `cloud.local_first` default on must be refused right now.

    `rules` is a `RuleSnapshot` (or a flag-to-rules mapping, or `cloud.hosted_media`'s own rule
    list); `flags_effective` is `flags.effective()` unless the caller holds another build's
    states; `grandfather_verified` is whether the BF-0465-01 verification is recorded (see
    `grandfather_marker_recorded`); `gates_green` is the gate register's answer;
    `grandfather_missing` is the audit's missing workspace ids
    (`hosted_coexistence.grandfather.audit_grandfather_rules(...).missing`), so a marker recorded
    before a later miss still refuses. Empty means the flip may proceed - subject, always, to the
    owner's recorded decision (BF-0467-06)."""
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
    missing = sorted(set(grandfather_missing))
    if missing:
        more = len(missing) - 5
        shown = ", ".join(missing[:5]) + (f" and {more} more" if more > 0 else "")
        refusals.append(
            f"the grandfather audit finds {len(missing)} workspace(s) with a completed upload"
            f" that {HOSTED_MEDIA}'s rules do not grant ({shown}): add them to a WORKSPACES"
            " grant above the catch-all"
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
    through `conn`, derives `grandfather_verified` from the recorded marker, and re-runs the
    BF-0465-01 audit (detection query against the stored rules) for `grandfather_missing`.
    `gates_green` stays a human answer, read from the gate register. Run it in a system
    transaction (no workspace scope) so the detection query sees every workspace."""
    from selecta.flags import rules as rule_store
    from selecta.hosted_coexistence.grandfather import audit_grandfather_rules

    snapshot = rule_store.load_snapshot(conn)
    history = rule_store.history(conn, HOSTED_MEDIA, limit=history_limit)
    audit = audit_grandfather_rules(conn, snapshot.for_flag(HOSTED_MEDIA))
    return check_flip(
        snapshot,
        flags_effective,
        grandfather_verified=grandfather_marker_recorded(history),
        gates_green=gates_green,
        grandfather_missing=audit.missing,
    )


# --- Dashboards before percentage (BF-0467-04) ---------------------------------------------------
#
# ADR-0467 step 4 (percentage) may begin only once the per-mode cost dashboard (BF-0464-05) and an
# error-rate view per flag cohort exist and are watched. The check below refuses any rule change
# that raises `cloud.local_first`'s highest percentage above what is saved now, until:
#
# - each named dashboard is live: the cost dashboard shows real data for both account modes
#   (`usage.unit_economics.is_live`), and the error-rate view per cohort exists. No such view is
#   built yet (request metrics carry no cohort label), so it answers not-live and the check names
#   it; whoever builds it flips `ERROR_RATE_VIEW` to its admin path;
# - the owner recorded that they are green: a `cloud.local_first` rule change whose reason holds
#   `DASHBOARDS_MARKER`, or the reason of this very change (the step ledger links the evidence).
#
# Lowering or freezing a percentage is never refused: rollback is the flag alone (ADR-0467).

DASHBOARDS_MARKER = "[dashboards-green]"
COST_DASHBOARD = "GET /api/admin/economics/cost-per-mode"
ERROR_RATE_VIEW = (
    "infra/observability/generated/dashboards/local_first_cohort_error_rate.json"
)
DASHBOARDS = ("cost_per_mode", "error_rate_per_cohort")


def highest_percentage(rules: Sequence[Rule]) -> float:
    """The largest enabled, valid percentage in a flag's rules (0 when there is none)."""
    return max(
        (
            float(rule.params.get("percent") or 0)
            for rule in rules
            if rule.enabled and not rule.problems and rule.kind == RuleKind.PERCENTAGE
        ),
        default=0.0,
    )


def raises_percentage(current: Sequence[Rule], proposed: Sequence[Rule]) -> bool:
    return highest_percentage(proposed) > highest_percentage(current)


def check_percentage_step(
    current: Sequence[Rule],
    proposed: Sequence[Rule],
    *,
    dashboards_live: Mapping[str, bool],
    dashboards_green: bool,
) -> list[str]:
    """Every reason this `cloud.local_first` rule change may not begin or widen step 4. Empty when
    the change does not raise the percentage, or when every dashboard is live and recorded
    green. Pure: the caller answers which dashboards are live and whether the marker exists."""
    if not raises_percentage(current, proposed):
        return []
    refusals: list[str] = []
    for name in DASHBOARDS:
        if not dashboards_live.get(name, False):
            where = {
                "cost_per_mode": f"{COST_DASHBOARD} shows no real data for both account modes",
                "error_rate_per_cohort": "no error-rate view per flag cohort exists yet",
            }[name]
            refusals.append(
                f"step 4 needs the {name.replace('_', ' ')} dashboard live first: {where}"
                " (BF-0467-04, docs/verification/bf-step-ledger.md)"
            )
    if not dashboards_green:
        refusals.append(
            "the dashboards are not recorded green: save the cloud.local_first rules with a reason"
            f" containing {DASHBOARDS_MARKER} once the owner has reviewed them"
        )
    return refusals


def dashboards_marker_recorded(history: Iterable[Version], reason: str = "") -> bool:
    """Whether the dashboard review applies to the current rule state.

    A marker on the proposed change can approve that exact change. Otherwise, only the latest
    saved rule change or rollback can carry the approval forward. An older marker expires when
    the rollout rules are subsequently changed, so stale dashboard review cannot authorize a
    later percentage increase.
    """
    if DASHBOARDS_MARKER in reason:
        return True
    for version in history:
        if version.flag_id == LOCAL_FIRST and version.change in ("rules", "rollback"):
            return DASHBOARDS_MARKER in version.reason
    return False


def check_percentage_step_now(
    conn: Connection, proposed: Sequence[Rule], *, reason: str = "", month: str | None = None
) -> list[str]:
    """`check_percentage_step` against the stored rules, the live cost dashboard and the
    recorded marker. Cheap when the change doesn't raise the percentage (nothing is measured)."""
    from selecta.flags import rules as rule_store

    current = rule_store.current_rules(conn, LOCAL_FIRST)
    if not raises_percentage(current, proposed):
        return []
    import datetime as dt

    from selecta.persistence import db_now
    from selecta.usage.unit_economics import cost_report

    month = month or dt.datetime.fromtimestamp(db_now(conn), dt.UTC).strftime("%Y-%m")
    import os

    from selecta.observability import metrics

    # The dashboard is provisioned from the repository, while telemetry is configured by the
    # deployment. Merely having a JSON panel in source is not enough to advance a cohort: the
    # metrics exporter and the metrics flag must both be live. The owner marker still requires a
    # human to review real data from both cohorts before widening the percentage.
    error_rate_configured = (
        ERROR_RATE_VIEW is not None
        and metrics.enabled()
        and bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip())
    )
    # Configuration only proves the exporter could ship samples. The owner marker is recorded
    # after reviewing non-empty hosted and browser_first denominators in the deployed view, so
    # readiness must not label a configured-but-empty Grafana dashboard as live.
    history = rule_store.history(conn, LOCAL_FIRST, limit=500)
    dashboards_green = dashboards_marker_recorded(history, reason)
    error_rate_live = error_rate_configured and dashboards_green
    live = {
        "cost_per_mode": bool(cost_report(conn, month)["live"]),
        "error_rate_per_cohort": error_rate_live,
    }
    return check_percentage_step(
        current,
        proposed,
        dashboards_live=live,
        dashboards_green=dashboards_green,
    )
