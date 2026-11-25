"""What the page and Lucy's prompt are told about the allowance of ADR-0481 to ADR-0484.

`signal` is the structured note put on an assistant message's `meta.limit` when a limit shaped
the reply, so the page can offer the next step (ADR-0483 rule 6). `state_words` is the one
sentence Lucy's prompt gets about what is left, so she answers "how much have I got left?" the
way the meter does (ADR-0484 rule 9): shares in words and reset times, never units or turns.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import usage_units, usage_windows
from selecta.ai.allowance import month_resets_at
from selecta.ai.usage_schema import lucy_usage_state

# `ai_runs.limited` -> the cause the page knows, and the window whose reset it names.
# "backstop" is the plan's monthly ceiling on Lucy's AI, kept above the weekly limit (ADR-0482
# rule 9); "turn" is one message reaching the most work a single message may do (ADR-0483 rule 3).
CAUSES = {"session": ("session", "session"), "week": ("week", "week"),
          "lighter": ("session_lighter", "session"), "off": ("lucy_off", "week"),
          "backstop": ("backstop", "month"), "turn": ("turn", None)}
NO_STEPS = {"session_lighter", "lucy_off", "turn"}
TOP_PLAN = "premium"


def signal(limited: str | None, meter: dict[str, Any] | None, *, plan_id: str,
           extra_available: bool = False) -> dict[str, Any] | None:
    """The `meta.limit` note for a reply shaped by `limited`, or None when no limit did."""
    if limited not in CAUSES:
        return None
    cause, window = CAUSES[limited]
    line = (meter or {}).get(window) or {}
    steps: list[str] = []
    if cause not in NO_STEPS:
        steps.append("wait")
        if plan_id != TOP_PLAN:
            steps.append("plans")
        if cause == "week" and extra_available:
            steps.append("extra")
    if cause == "lucy_off":  # no reset to wait for: a person switched it off
        return {"cause": cause, "resets_at": None, "back_words": None, "next": steps}
    return {"cause": cause, "resets_at": line.get("resets_at"),
            "back_words": line.get("back_words"), "next": steps}


def month_line(month: str, time_zone: str | None, now: float) -> dict[str, Any]:
    """When the account's month starts again, shaped like a line of the meter, for the note of
    a turn the monthly ceiling stopped."""
    resets_at = month_resets_at(month, time_zone)
    return {"resets_at": resets_at,
            "back_words": usage_windows.back_words(resets_at, time_zone, now)}


def switched_off(conn: Connection, workspace_id: str, *, now: float) -> bool:
    """Whether staff have switched Lucy's AI off for this workspace (a factor of 0)."""
    view = usage_units.units_view(conn, workspace_id, now=now)
    return bool(view) and view.get("override_multiplier_milli") == 0


def enforced_meter(conn: Connection, workspace_id: str, *, now: float) -> dict[str, Any] | None:
    """The read model for a workspace that has switched to the new allowance, else None."""
    cutover = conn.scalar(sa.select(lucy_usage_state.c.cutover_at)
                          .where(lucy_usage_state.c.workspace_id == workspace_id))
    if cutover is None or cutover > now:
        return None
    return usage_units.read_model(conn, workspace_id, now=now)


def _share(left: int) -> str:
    if left <= 0:
        return "none"
    if left < 20:
        return "a little"
    if left < 45:
        return "less than half"
    if left <= 55:
        return "about half"
    if left < 100:
        return "most"
    return "all"


def _back(line: dict[str, Any]) -> str:
    words = line.get("back_words")
    if not words:
        return ""
    return f", back at {words}" if words[0].isdigit() else f", back {words}"


def state_words(meter: dict[str, Any] | None) -> str:
    """Lucy's allowance right now in plain words, or "" for an account on the turn model."""
    if not meter:
        return ""
    parts = []
    session, week = meter.get("session"), meter.get("week")
    if session:
        if session.get("open") is False or session.get("resets_at") is None:
            parts.append("this session has not started, so all of its share is left")
        else:
            parts.append(f"this session has {_share(int(session['left']))} of its share left"
                         f"{_back(session)}")
    if week:
        parts.append(f"this week has {_share(int(week['left']))} of its allowance left"
                     f"{_back(week)}")
    if not parts:
        return ""
    return ("Your allowance right now: " + "; ".join(parts) + ". If asked how much is left, say "
            "it in these words; never give a number of turns, tokens or units.")


__all__ = ["CAUSES", "enforced_meter", "month_line", "signal", "state_words", "switched_off"]
