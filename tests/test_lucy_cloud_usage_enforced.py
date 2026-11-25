"""Lucy on the session and week allowance, through the routes (ADR-0483, ADR-0484).

An account is put on the new model the way production does it: a rule grants it
`lucy.usage_windows` and its cutover time has passed. A scripted provider stands in for the
model. Alice is on Premium, Carol on Free (`cloud_party`).
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, CAROL, auth
from test_lucy_cloud import converse, events, lucy, script, send, snapshot, songs  # noqa: F401

from selecta import flags
from selecta.ai import usage_mode
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_state
from selecta.flags.matching import Rule, RuleKind
from selecta.flags.rules import RuleSnapshot
from selecta.lucy import cloud_limits
from selecta.lucy.providers import ScriptedProvider
from selecta.persistence import db_now, transaction

pytest_plugins = ("cloud_party",)
PLANS = {ALICE: "premium", CAROL: "free"}


@pytest.fixture
def windows(lucy):  # noqa: F811
    """Alice and Carol switched to the new allowance; Bob left on turns."""
    flags.use("+cloud.local_media +lucy.cloud_conversation +lucy.usage_shadow")
    ids = [lucy.workspaces[ALICE], lucy.workspaces[CAROL]]
    rule = Rule(RuleKind.WORKSPACES, {"ids": ids, "on": True})
    lucy.app.state.flag_rules = RuleSnapshot(1, {WINDOWS_FLAG: (rule,)})
    for token in (ALICE, CAROL):
        workspace = lucy.workspaces[token]
        with transaction(lucy.engine, workspace) as conn:
            now = db_now(conn)
            usage_mode.set_cutover(conn, workspace, at=now - 10, plan_id=PLANS[token], now=now)
    return lucy


def spend(party, token: str, *, session: bool = False, week: bool = False) -> None:
    """Use up a window by writing what admission reads, as settled turns would have."""
    workspace = party.workspaces[token]
    values = {}
    if week:
        values["week_used"] = lucy_usage_state.c.week_limit
    with transaction(party.engine, workspace) as conn:
        if session:
            now = db_now(conn)
            values.update(session_seq=lucy_usage_state.c.session_seq + 1,
                          session_ends_at=now + 3600,
                          session_used=lucy_usage_state.c.session_limit)
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace).values(**values))


def say(party, token: str, text: str, reply: str = "Done.") -> dict:
    script(party, [{"chunks": [reply]}])
    conversation = converse(party, token)
    assert send(party, token, conversation, text).status_code == 200
    message = snapshot(party, token, conversation)["messages"][-1]
    return {"message": message, "events": events(party, token, conversation)}


def limit_of(turn: dict) -> dict | None:
    return (turn["message"].get("meta") or {}).get("limit")


# The note the page reads ------------------------------------------------------------------------


def test_a_spent_week_answers_in_words_and_tells_the_page_what_to_offer(windows):
    spend(windows, CAROL, week=True)

    turn = say(windows, CAROL, "play Rema", "never said")

    assert "used all of Lucy's allowance for this week" in turn["message"]["content"]
    note = limit_of(turn)
    assert note["cause"] == "week" and note["next"] == ["wait", "plans"]
    assert note["resets_at"] > 0 and note["back_words"]
    done = [e for e in turn["events"] if e["type"] == "message.completed"][-1]
    assert done["payload"]["meta"]["limit"] == note  # the live page gets the same note


def test_the_top_plan_is_not_offered_a_higher_plan(windows):
    spend(windows, ALICE, week=True)
    assert limit_of(say(windows, ALICE, "play Rema", "never said"))["next"] == ["wait"]


def test_a_spent_session_on_free_goes_to_the_planner_with_the_session_note(windows):
    spend(windows, CAROL, session=True)

    turn = say(windows, CAROL, "play Rema", "never said")

    assert "for this session" in turn["message"]["content"]
    note = limit_of(turn)
    assert note["cause"] == "session" and note["next"] == ["wait", "plans"]


def test_a_spent_session_on_premium_is_answered_by_a_lighter_lucy_and_said_once(windows):
    spend(windows, ALICE, session=True)

    first = say(windows, ALICE, "play Rema", "Here you go.")
    second = say(windows, ALICE, "and another", "Here is another.")

    assert first["message"]["content"] == "Here you go."  # a model answered
    note = limit_of(first)
    assert note["cause"] == "session_lighter" and note["next"] == []
    notices = [e for e in first["events"] if e["type"] == "run.limit"]
    assert [n["payload"]["limit"] for n in notices] == ["lighter"]
    assert "lighter Lucy" in notices[0]["payload"]["text"]
    assert limit_of(second) is None  # said once per session
    assert not [e for e in second["events"] if e["type"] == "run.limit"]


def test_a_turn_under_no_limit_carries_no_note(windows):
    assert limit_of(say(windows, CAROL, "hi", "Hello!")) is None


def test_an_account_on_turns_never_gets_the_note(lucy):  # noqa: F811
    assert limit_of(say(lucy, CAROL, "hi", "Hello!")) is None


# What Lucy is told about herself ----------------------------------------------------------------


class Listening(ScriptedProvider):
    """A scripted model that keeps the system prompt it was given."""

    def __init__(self, steps):
        super().__init__(steps)
        self.systems: list[list[str]] = []

    async def turn(self, system, messages, tools, on_text):
        self.systems.append(list(system))
        return await super().turn(system, messages, tools, on_text)


def heard(party, token: str) -> str:
    provider = Listening([{"chunks": ["ok"]}])
    party.extra["script"]["provider"] = provider
    conversation = converse(party, token)
    send(party, token, conversation, "how much have I got left?")
    return "\n".join(provider.systems[-1])


def test_on_the_new_allowance_lucy_is_told_her_state_not_turn_counts(windows):
    prompt = heard(windows, CAROL)
    assert "Your allowance right now" in prompt and "this week has" in prompt
    assert "turns a month" not in prompt and "40 turns" not in prompt


def test_on_turns_lucy_is_told_the_turn_counts_as_before(lucy):  # noqa: F811
    prompt = heard(lucy, CAROL)
    assert "40 turns a month" in prompt and "Your allowance right now" not in prompt


def test_the_settings_route_sends_the_windows_only_to_an_account_on_them(windows):
    on = windows.client.get("/api/account/lucy", headers=auth(CAROL)).json()
    assert set(on["usage_windows"]) >= {"session", "week"}
    off = windows.client.get("/api/account/lucy", headers=auth(BOB)).json()
    assert "usage_windows" not in off  # Bob is still on turns


# The helpers, on their own ----------------------------------------------------------------------

METER = {"session": {"left": 0, "state": "spent", "resets_at": 100.0, "back_words": "16:40",
                     "open": True, "segments": 0},
         "week": {"left": 62, "state": "ok", "resets_at": 900.0, "back_words": "Thursday 09:00",
                  "segments": 3}}


@pytest.mark.parametrize(("limited", "plan", "extra", "cause", "steps"), [
    ("session", "free", False, "session", ["wait", "plans"]),
    ("session", "premium", False, "session", ["wait"]),
    ("week", "standard", False, "week", ["wait", "plans"]),
    ("week", "standard", True, "week", ["wait", "plans", "extra"]),
    ("week", "premium", True, "week", ["wait", "extra"]),
    ("session", "standard", True, "session", ["wait", "plans"]),  # extra is for the week only
    ("lighter", "premium", True, "session_lighter", []),
])
def test_the_note_names_the_cause_and_only_the_steps_that_apply(limited, plan, extra, cause,
                                                               steps):
    note = cloud_limits.signal(limited, METER, plan_id=plan, extra_available=extra)
    assert (note["cause"], note["next"]) == (cause, steps)
    window = "week" if cause == "week" else "session"
    assert note["resets_at"] == METER[window]["resets_at"]
    assert note["back_words"] == METER[window]["back_words"]


@pytest.mark.parametrize("limited", [None, "allowance", "spend", "platform", "no_model", "x"])
def test_other_reasons_carry_no_note(limited):
    assert cloud_limits.signal(limited, METER, plan_id="free") is None


def test_the_note_survives_a_missing_meter():
    note = cloud_limits.signal("week", None, plan_id="free")
    assert note == {"cause": "week", "resets_at": None, "back_words": None,
                    "next": ["wait", "plans"]}


def test_state_words_say_shares_and_times_and_never_a_count():
    words = cloud_limits.state_words(METER)
    assert "this session has none of its share left, back at 16:40" in words
    assert "this week has most of its allowance left, back Thursday 09:00" in words
    digits = words.replace("16:40", "").replace("09:00", "")
    assert not any(ch.isdigit() for ch in digits)
    assert chr(0x2014) not in words


@pytest.mark.parametrize(("left", "share"), [
    (0, "none"), (1, "a little"), (19, "a little"), (20, "less than half"),
    (44, "less than half"), (45, "about half"), (55, "about half"), (56, "most"), (99, "most"),
    (100, "all"),
])
def test_a_share_is_put_in_words(left, share):
    meter = {"session": None, "week": {"left": left, "back_words": None}}
    assert f"this week has {share} of its allowance left" in cloud_limits.state_words(meter)


def test_a_session_not_yet_started_reads_as_full_and_no_meter_reads_as_nothing():
    fresh = {"session": {"left": 100, "open": False, "resets_at": None, "back_words": None},
             "week": {"left": 100, "back_words": None}}
    assert "this session has not started" in cloud_limits.state_words(fresh)
    assert cloud_limits.state_words(None) == ""
    assert cloud_limits.state_words({"session": None, "week": None}) == ""


def test_an_account_with_lucy_switched_off_is_told_so_and_not_that_it_used_anything(windows):
    workspace = windows.workspaces[CAROL]
    with transaction(windows.engine, workspace) as conn:
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace)
                     .values(override_multiplier_milli=0, week_limit=0, session_limit=0))

    turn = say(windows, CAROL, "play Rema", "never said")

    words = turn["message"]["content"]
    assert "switched off for this account" in words and "used all" not in words
    assert limit_of(turn) == {"cause": "lucy_off", "resets_at": None, "back_words": None,
                              "next": []}
