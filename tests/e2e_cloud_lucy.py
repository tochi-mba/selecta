"""Lucy for the cloud browser tests (tests/e2e_cloud_server.py). Never part of the app.

A scripted model stands in for the real one: it answers `REPLY` at once and reports a fixed
token count, so a turn really is admitted, charged and settled through the gateway, and costs
nothing. The gateway asks for a deployment key before it asks the provider, so a stand-in key
goes in the environment; it is never sent anywhere.

Nobody is on the session and week allowance (ADR-0483, ADR-0484) unless a test puts them there:
`lucy.usage_windows` is off with no rule, so every other spec keeps the turns meter.

`POST /test/lucy-usage {"user", ...}` puts one person's workspace where a test needs it, the way
production does (a real workspace rule on `lucy.usage_windows`, and a cutover time):

- `grant`: true adds the rule for this workspace, false takes it away;
- `cutover`: "past" sets a cutover time that has passed, "none" clears it;
- `plan`: "premium" gives an expiring override, "free" revokes it;
- `spend`: `{"session": true, "week": true}` uses a window up, as settled turns would have;
- `used`: `{"session": 40, "week": 85}` sets the percentage of a window already used.

It answers with the mode the workspace is now in and the read model every surface draws.
`POST /test/emit {"user", "topic": "lucy.usage"}` tells open pages to read it again.
"""

from __future__ import annotations

import os
from collections.abc import Callable

import sqlalchemy as sa
from fastapi import Body, FastAPI
from sqlalchemy.engine import Engine

from selecta.ai import usage_mode, usage_units
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_state
from selecta.billing import stripe_sync
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.lucy.providers import ScriptedProvider
from selecta.persistence import db_now, transaction

REPLY = "Here is a short answer from the test Lucy."
NOTE = "e2e lucy usage"
NO_KEY = "e2e-lucy-calls-no-ai"
SESSION_SECONDS = 3600


class FastLucy(ScriptedProvider):
    """Answers every turn with `REPLY`, at once."""

    def __init__(self) -> None:
        super().__init__([])

    async def turn(self, system, messages, tools, on_text):
        self.script = [{"chunks": [REPLY], "tokens_in": 4000, "tokens_out": 400}]
        return await super().turn(system, messages, tools, on_text)


def _mine(rule: Rule, workspace_id: str) -> bool:
    params = rule.to_dict()["params"]
    return (rule.kind == RuleKind.WORKSPACES and params.get("note") == NOTE
            and list(params.get("ids") or ()) == [workspace_id])


def _grant(engine: Engine, workspace_id: str, on: bool) -> None:
    with transaction(engine) as conn:
        current = list(flag_rules.load_snapshot(conn).for_flag(WINDOWS_FLAG))
        rest = [rule for rule in current if not _mine(rule, workspace_id)]
        mine = [Rule(RuleKind.WORKSPACES, {"ids": [workspace_id], "on": True, "note": NOTE})]
        proposed = [*mine, *rest] if on else rest
        if [r.to_dict() for r in proposed] != [r.to_dict() for r in current]:
            flag_rules.save(conn, WINDOWS_FLAG, proposed, author="e2e",
                            reason="browser tests: Lucy's session and week allowance")


def _plan(engine: Engine, workspace_id: str, plan: str) -> None:
    with transaction(engine) as conn:
        now = db_now(conn)
        while (held := stripe_sync.active_override(conn, workspace_id, now)) is not None:
            stripe_sync.revoke_override(conn, held.id, "e2e")
        if plan != "free":
            stripe_sync.grant_override(conn, workspace_id=workspace_id, plan_id=plan,
                                       reason="browser tests", actor="e2e",
                                       expires_at=now + 86_400)


def _counters(conn, workspace_id: str, spend: dict, used: dict, now: float) -> None:
    state = lucy_usage_state.c
    share = {name: min(100, max(0, int(used[name]))) for name in ("session", "week")
             if name in used}
    if spend.get("session"):
        share["session"] = 100
    if spend.get("week"):
        share["week"] = 100
    values: dict = {}
    if "week" in share:
        values["week_used"] = state.week_limit * share["week"] // 100
    if "session" in share:
        # a session is open, as a turn would have opened it
        values.update(session_seq=state.session_seq + 1, session_ends_at=now + SESSION_SECONDS,
                      session_used=state.session_limit * share["session"] // 100,
                      session_reserved=0)
    if values:
        conn.execute(sa.update(lucy_usage_state).where(state.workspace_id == workspace_id)
                     .values(**values))


def install(app: FastAPI, engine: Engine, workspace_of: Callable[[str], str]) -> None:
    """`workspace_of(name)` gives the workspace id of the test person `name`."""
    os.environ.setdefault("ANTHROPIC_API_KEY", NO_KEY)
    app.state.lucy_cloud_provider = lambda settings, plan: FastLucy()

    @app.post("/test/lucy-usage")
    def lucy_usage(body: dict = Body(default={})):  # noqa: B008
        workspace_id = workspace_of(str(body["user"]))
        if body.get("plan") in ("free", "premium"):
            _plan(engine, workspace_id, str(body["plan"]))
        if "grant" in body:
            _grant(engine, workspace_id, bool(body["grant"]))
            # this instance reads the new rules at once, as after any rule change
            app.state.flag_rules.invalidate()
        with transaction(engine, workspace_id) as conn:
            now = db_now(conn)
            plan_id = stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id
            if body.get("cutover") == "past":
                usage_mode.set_cutover(conn, workspace_id, at=now - 10, plan_id=plan_id, now=now)
            elif body.get("cutover") == "none":
                usage_mode.clear_cutover(conn, workspace_id)
            # a plan change lifts the limits before anything is counted against them
            usage_units.roll(conn, workspace_id, plan_id=plan_id, now=now)
            _counters(conn, workspace_id, body.get("spend") or {}, body.get("used") or {}, now)
            return {
                "workspace_id": workspace_id,
                "plan": plan_id,
                "mode": usage_mode.mode_for(conn, workspace_id, app.state.flag_rules, now),
                "usage_windows": usage_units.read_model(conn, workspace_id, now=now),
            }


__all__ = ["REPLY", "FastLucy", "install"]
