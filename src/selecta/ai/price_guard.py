"""The check on a model price changed in a running database (ADR-0487 rule 10, LM-0487-09).

One usage unit is a millionth of a US dollar of model cost at the prices of the deployment that
answered, and the gateway reads those prices from the `model_deployments` table, not from the
code. So a new price on a stored row changes how fast every allowance is spent, with no code
change for `audit.lucy_price_baseline` to notice. `registry.save_deployment` is the one place a
stored price is written, and it runs `check` whenever it would replace a price with another.

`check` is the pure core: hand it the stored prices, the wanted ones and the change's reason,
and get back a list of refusals in plain sentences, empty when the change may go ahead. What it
refuses:

- **A change with no reason.** Any change to either price needs words saying why. They are
  kept in the audit trail beside the old and new figures (`audit_fields`).
- **A large change with nobody answering for the measurement.** A change of more than
  `THRESHOLD_PERCENT` percent to either price, up or down, also needs `MARKER` in the reason:
  a person saying the procedure in `PROCEDURE` was followed (the measurement run again, the
  code and baseline changed to match). No code can know that. A cut is held to the same rule as
  a rise, since it makes the committed baseline and its measurement untrue just the same.

A save that leaves both prices as they are (a rollout share, a status, a limit) is not checked,
and nor is a new deployment: it has no stored price to change, and it answers no turn until
routing or a staged rollout sends it some. Nothing here changes anything.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from selecta.ai.registry import Prices

MARKER = "[lm-price-change]"
THRESHOLD_PERCENT = 20
PROCEDURE = "docs/operations/lucy-price-change.md"
AUDIT_ACTION = "models.deployments.price_change"
_FIELDS = (("input_usd_per_mtok", "input price"), ("output_usd_per_mtok", "output price"))


def _percent(old: float, new: float) -> float:
    """How far `new` is from `old`, as a signed percentage. A price that was nothing has no
    percentage to speak of, so any change to it counts as beyond every threshold."""
    if old <= 0:
        return float("inf") if new > 0 else 0.0
    return round((new - old) / old * 100, 6)


def changed(old: Prices, new: Prices) -> bool:
    return any(_percent(getattr(old, key), getattr(new, key)) != 0 for key, _ in _FIELDS)


def check(deployment_id: str, old: Prices, new: Prices, *, reason: str) -> list[str]:
    """Every reason this change to a stored deployment's prices must be refused. Empty when it
    may go ahead, as it always may when neither price moves."""
    if not changed(old, new):
        return []
    refusals: list[str] = []
    if not reason.replace(MARKER, "").strip():
        refusals.append(
            f"changing the prices of {deployment_id} needs a reason: a price decides how fast"
            " every Lucy allowance is spent, and the reason is kept in the audit trail"
        )
    if MARKER in reason:
        return refusals
    for key, words in _FIELDS:
        was, wanted = float(getattr(old, key)), float(getattr(new, key))
        moved = _percent(was, wanted)
        if abs(moved) > THRESHOLD_PERCENT:
            refusals.append(
                f"the {words} of {deployment_id} would go from {was:g} to {wanted:g} US dollars"
                f" per million tokens ({moved:+.0f}%): a change of more than"
                f" {THRESHOLD_PERCENT}% needs a person to say the measurement was run again."
                f" Follow {PROCEDURE}, then put {MARKER} in the reason"
            )
    return refusals


def audit_fields(old: Prices, new: Prices, *, reason: str) -> dict[str, Any]:
    """The old and new figures for the audit row of a change that went ahead."""
    return {
        "old": {key: float(getattr(old, key)) for key, _ in _FIELDS},
        "new": {key: float(getattr(new, key)) for key, _ in _FIELDS},
        "marker": MARKER in reason,
        "threshold_percent": THRESHOLD_PERCENT,
    }


__all__ = ["AUDIT_ACTION", "MARKER", "PROCEDURE", "THRESHOLD_PERCENT", "audit_fields", "changed",
           "check"]
