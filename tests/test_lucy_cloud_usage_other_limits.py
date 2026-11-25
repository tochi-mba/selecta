"""The two limits besides the session and the week, through the routes (ADR-0482 rule 9,
ADR-0483 rule 3): the plan's monthly ceiling on Lucy's AI, kept as a backstop above the weekly
limit, and the most work one message may do.

On the new allowance each says what happened and what to do, carries its own `meta.limit`
cause, and never speaks of turns. An account still on turns hears what it always heard.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import CAROL
from test_lucy_cloud import converse, events, lucy, script, send, snapshot, songs  # noqa: F401
from test_lucy_cloud_limits import AI_LIMIT, spend_all
from test_lucy_cloud_usage_enforced import limit_of, say, windows  # noqa: F401

from selecta.ai import allowance, usage_units
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.schema import ai_runs, ai_usage
from selecta.lucy import cloud_limits
from selecta.persistence import db_now, transaction

pytest_plugins = ("cloud_party",)
BACKSTOP = "monthly safety limit on Lucy's AI"
TURN_CAP = "one message can only do so much work"
OLD_TURN_CAP = "that was as much work as one message allows"
# One round of work that costs far more than Free's cap for a message, then asks for more.
HEAVY = [{"chunks": ["Looking. "], "calls": [{"name": "search_songs", "input": {"query": "x"}}],
          "tokens_in": 2_000_000, "tokens_out": 1000},
         {"chunks": ["never said"]}]


def heavy(party, token: str) -> dict:
    script(party, HEAVY)
    conversation = converse(party, token)
    assert send(party, token, conversation, "find me something").status_code == 200
    message = snapshot(party, token, conversation)["messages"][-1]
    return {"message": message, "events": events(party, token, conversation)}


def last_run(party, token: str):
    with transaction(party.engine) as conn:
        return conn.execute(
            sa.select(ai_runs).where(ai_runs.c.workspace_id == party.workspaces[token])
            .order_by(ai_runs.c.started_at.desc(), ai_runs.c.id.desc()).limit(1)
        ).first()


# The monthly backstop ---------------------------------------------------------------------------


def test_the_monthly_backstop_says_so_and_names_the_day_it_comes_back(windows):  # noqa: F811
    spend_all(windows, CAROL, Tier.FREE)

    turn = say(windows, CAROL, "play Rema", "never said")

    words = turn["message"]["content"]
    assert BACKSTOP in words and "It comes back on 1 " in words
    assert "turn" not in words.lower()  # nothing about turns on the new allowance
    assert "used all of Lucy's allowance" not in words  # nor is the week or session spent
    assert last_run(windows, CAROL).limited == "spend"
    note = limit_of(turn)
    assert note["cause"] == "backstop" and note["next"] == ["wait", "plans"]
    with transaction(windows.engine) as conn:
        month = allowance.month_key(db_now(conn), "UTC")
    assert note["resets_at"] == allowance.month_resets_at(month, "UTC")
    assert note["back_words"]
    done = [e for e in turn["events"] if e["type"] == "message.completed"][-1]
    assert done["payload"]["meta"]["limit"] == note


def test_on_turns_the_monthly_ceiling_reads_as_it_always_did(lucy):  # noqa: F811
    spend_all(lucy, CAROL, Tier.FREE)

    turn = say(lucy, CAROL, "play Rema", "never said")

    words = turn["message"]["content"]
    assert AI_LIMIT in words and "separate from your turns" in words
    assert BACKSTOP not in words and limit_of(turn) is None


def test_the_months_turn_count_never_stops_an_account_on_the_new_allowance(windows):  # noqa: F811
    """Only the dollar ceiling is a backstop there: with every turn of the month counted, a
    model still answers and nothing is said about turns."""
    workspace = windows.workspaces[CAROL]
    with transaction(windows.engine, workspace) as conn:
        month = allowance.month_key(db_now(conn), "UTC")
        for _ in range(allowance.ALLOWANCES[Tier.FREE][RequestClass.EVERYDAY]):
            allowance.start_turn_unchecked(conn, workspace, Tier.FREE, RequestClass.EVERYDAY,
                                           month)

    turn = say(windows, CAROL, "play Rema", "Here you go.")

    assert turn["message"]["content"] == "Here you go."
    assert limit_of(turn) is None and last_run(windows, CAROL).limited is None
    with transaction(windows.engine) as conn:
        used = conn.scalar(sa.select(sa.func.sum(ai_usage.c.turns))
                           .where(ai_usage.c.workspace_id == workspace))
    assert used == 41  # still counted, so going back loses nothing


# The most one message may do --------------------------------------------------------------------


def test_a_message_that_reaches_the_per_turn_cap_says_so_with_its_own_note(windows):  # noqa: F811
    turn = heavy(windows, CAROL)

    words = turn["message"]["content"]
    assert words.startswith("Looking.") and "never said" not in words  # the reply so far stands
    assert TURN_CAP in words and "send another message" in words
    assert "turn" not in words.lower() and "month" not in words.lower()
    assert limit_of(turn) == {"cause": "turn", "resets_at": None, "back_words": None,
                              "next": []}
    done = [e for e in turn["events"] if e["type"] == "message.completed"][-1]
    assert done["payload"]["meta"]["limit"] == limit_of(turn)
    assert turn["message"]["status"] == "complete"


def test_on_turns_the_per_turn_cap_reads_as_it_always_did(lucy):  # noqa: F811
    turn = heavy(lucy, CAROL)

    words = turn["message"]["content"]
    assert OLD_TURN_CAP in words and TURN_CAP not in words
    assert limit_of(turn) is None


def test_a_message_within_the_cap_carries_no_note(windows):  # noqa: F811
    script(windows, [{"chunks": ["Looking. "], "tokens_in": 100, "tokens_out": 10,
                      "calls": [{"name": "search_songs", "input": {"query": "x"}}]},
                     {"chunks": ["Nothing found."]}])
    conversation = converse(windows, CAROL)
    send(windows, CAROL, conversation, "find me something")
    message = snapshot(windows, CAROL, conversation)["messages"][-1]
    assert TURN_CAP not in message["content"] and "limit" not in (message.get("meta") or {})


# The helper, on its own -------------------------------------------------------------------------

MONTH = {"month": {"resets_at": 1000.0, "back_words": "Tuesday 1 December 00:00"}}


@pytest.mark.parametrize(("plan", "steps"), [("free", ["wait", "plans"]),
                                             ("standard", ["wait", "plans"]),
                                             ("premium", ["wait"])])
def test_the_backstop_note_names_the_month_and_never_offers_extra_usage(plan, steps):
    note = cloud_limits.signal("backstop", MONTH, plan_id=plan, extra_available=True)
    assert note == {"cause": "backstop", "resets_at": 1000.0,
                    "back_words": "Tuesday 1 December 00:00", "next": steps}


def test_the_per_turn_note_has_no_reset_and_no_steps():
    note = cloud_limits.signal("turn", MONTH, plan_id="free", extra_available=True)
    assert note == {"cause": "turn", "resets_at": None, "back_words": None, "next": []}


def test_the_month_line_is_the_first_of_next_month_in_the_accounts_zone():
    now = allowance.month_resets_at("2026-10", "Europe/London") + 86_400 * 3
    line = cloud_limits.month_line("2026-11", "Europe/London", now)
    assert line["resets_at"] == allowance.month_resets_at("2026-11", "Europe/London")
    assert line["back_words"] == "Tuesday 1 December 00:00"


# A failure on the provider's side ---------------------------------------------------------------

NO_ALLOWANCE = "this didn't use any of your allowance"
NO_TURN = "didn't use one of your turns"
FAILURES = {
    "one worth trying again": ({"error": "The provider took too long.", "code": "timeout"},
                               "Lucy is busy right now"),
    "one that is not": ({"error": "Bad request.", "code": "provider", "recoverable": False},
                        "a problem on SelectaDJ's side"),
}


def failed(party, token: str, step: dict) -> dict:
    script(party, [step])
    conversation = converse(party, token)
    assert send(party, token, conversation, "hello").status_code == 200
    message = snapshot(party, token, conversation)["messages"][-1]
    return {"message": message, "events": events(party, token, conversation)}


def units_used(party, token: str) -> int:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        view = usage_units.units_view(conn, workspace, now=db_now(conn))
    return sum(view[key] for key in ("week_used", "week_reserved", "session_used",
                                     "session_reserved"))


@pytest.mark.parametrize(("step", "opening"), FAILURES.values(), ids=FAILURES.keys())
def test_a_provider_failure_on_the_new_allowance_speaks_of_the_allowance(
    windows, step, opening,  # noqa: F811
):
    turn = failed(windows, CAROL, step)

    words = turn["message"]["content"]
    assert turn["message"]["status"] == "failed"
    assert opening in words and NO_ALLOWANCE in words
    assert "turn" not in words.lower()  # nothing about turns on the new allowance
    said = [e["payload"]["message"] for e in turn["events"] if e["type"] == "error"]
    assert said == [words]  # the live page is told the same
    assert units_used(windows, CAROL) == 0  # and it is true: nothing was charged or held


@pytest.mark.parametrize(("step", "opening"), FAILURES.values(), ids=FAILURES.keys())
def test_on_turns_a_provider_failure_reads_as_it_always_did(lucy, step, opening):  # noqa: F811
    words = failed(lucy, CAROL, step)["message"]["content"]

    assert opening in words and NO_TURN in words
    assert "allowance" not in words
