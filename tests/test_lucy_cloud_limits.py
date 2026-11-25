"""Lucy's limits as a person meets them in Cloud: the turns meter after real turns, which kind of
turn a message counts as, and what Lucy says when no model can answer.

These run whole turns through the routes with a scripted model (`test_lucy_cloud`'s fixtures).
Alice is on Premium, Carol on Free (`cloud_party`).
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, CAROL, auth
from test_lucy_cloud import converse, lucy, script, send, snapshot, songs  # noqa: F401

from selecta.ai import allowance, gateway, spend
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.schema import ai_runs
from selecta.lucy import cloud_agent
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)
USED_TURNS = "used this month's Lucy turns"
AI_LIMIT = "monthly limit on Lucy's AI"


def usage(party, token: str) -> dict:
    """The turns meter as Lucy's settings page gets it."""
    answer = party.client.get("/api/account/lucy", headers=auth(token))
    assert answer.status_code == 200, answer.text
    return answer.json()["usage"]


def account_usage(party, token: str) -> dict:
    """The same meter as Plan & billing gets it."""
    answer = party.client.get("/api/account", headers=auth(token))
    assert answer.status_code == 200, answer.text
    return answer.json()["usage"]["lucy_turns_month"]


def lines(found: dict) -> dict[str, int]:
    return {entry["purpose"]: entry["used"] for entry in found["classes"]}


def say(party, token: str, text: str, reply: str = "Done.") -> str:
    """One whole turn in a new conversation; what Lucy answered."""
    script(party, [{"chunks": [reply]}])
    conversation = converse(party, token)
    sent = send(party, token, conversation, text)
    assert sent.status_code == 200, sent.text
    return snapshot(party, token, conversation)["messages"][-1]["content"]


def spend_all(party, token: str, tier: Tier) -> None:
    """Put the account at its plan's monthly dollar ceiling without using a turn."""
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        month = allowance.month_key(gateway.db_now(conn), "UTC")
        allowance.record_usage(
            conn, workspace, month, RequestClass.EVERYDAY, tokens_in=0, tokens_out=0,
            cost_usd=spend.TIER_LIMITS[tier].monthly_cost_ceiling_usd,
        )


# The meter after real turns ---------------------------------------------------------------------


def test_the_turns_meter_moves_when_lucy_answers(lucy):  # noqa: F811
    assert usage(lucy, CAROL)["used"] == 0

    assert say(lucy, CAROL, "hi", "Hello!") == "Hello!"
    first = usage(lucy, CAROL)
    say(lucy, CAROL, "play Rema")
    second = usage(lucy, CAROL)

    assert (first["used"], first["limit"]) == (1, 40)
    assert (second["used"], second["limit"]) == (2, 40)
    assert second["resets_at"] > 0


def test_settings_and_plan_and_billing_show_the_same_turns(lucy):  # noqa: F811
    say(lucy, CAROL, "hi")
    say(lucy, ALICE, "hi")
    say(lucy, ALICE, "what's playing next?")
    for token in (CAROL, ALICE):
        assert usage(lucy, token) == account_usage(lucy, token)
    assert usage(lucy, CAROL)["used"] == 1  # each account sees only its own turns


def test_a_turn_the_model_failed_is_not_left_on_the_meter(lucy):  # noqa: F811
    script(lucy, [{"error": "The provider took too long.", "code": "timeout"}])
    conversation = converse(lucy, CAROL)
    send(lucy, CAROL, conversation, "hello")
    reply = snapshot(lucy, CAROL, conversation)["messages"][-1]

    assert "didn't use one of your turns" in reply["content"]
    assert usage(lucy, CAROL)["used"] == 0  # what Lucy said and what the meter shows agree


def test_sending_the_same_message_twice_counts_one_turn(lucy):  # noqa: F811
    script(lucy, [{"chunks": ["Hello!"]}])
    conversation = converse(lucy, CAROL)
    send(lucy, CAROL, conversation, "hi")
    send(lucy, CAROL, conversation, "hi")
    assert usage(lucy, CAROL)["used"] == 1


def test_lucy_switched_off_counts_nothing(lucy):  # noqa: F811
    lucy.client.put("/api/lucy-cloud/settings", headers=auth(CAROL), json={"enabled": False})
    conversation = converse(lucy, CAROL)
    assert send(lucy, CAROL, conversation, "hello").status_code == 403
    assert usage(lucy, CAROL)["used"] == 0


# Which kind of turn a message is ----------------------------------------------------------------


def test_premium_messages_count_as_the_kind_of_turn_they_are(lucy):  # noqa: F811
    say(lucy, ALICE, "what's playing next?")
    say(lucy, ALICE, "play Rema")
    say(lucy, ALICE, "make a 1 hour mix for a house party")
    say(lucy, ALICE, "make a 3 hour mix for a wedding")

    found = usage(lucy, ALICE)

    # planning counts as everyday on Premium; quick is fair use and outside the total
    assert lines(found) == {"everyday": 2, "deep_plan": 1, "quick": 1}
    assert (found["used"], found["limit"], found["fair_use"]) == (3, 175, True)
    with transaction(lucy.engine) as conn:
        asked = conn.execute(
            sa.select(ai_runs.c.requested_class)
            .where(ai_runs.c.workspace_id == lucy.workspaces[ALICE])
        ).scalars().all()
    assert sorted(asked) == ["deep_plan", "everyday", "planning", "quick"]


def test_on_free_every_kind_of_message_counts_as_one_everyday_turn(lucy):  # noqa: F811
    for text in ("what's playing next?", "play Rema", "make a 1 hour mix", "make a 3 hour mix"):
        say(lucy, CAROL, text)
    found = usage(lucy, CAROL)
    assert lines(found) == {"everyday": 4} and found["used"] == 4


def test_a_quick_question_leaves_premiums_everyday_turns_alone(lucy, monkeypatch):  # noqa: F811
    quick = {RequestClass.EVERYDAY: 0, RequestClass.DEEP_PLAN: 0, RequestClass.QUICK: 1_000}
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.PREMIUM, quick)

    reply = say(lucy, ALICE, "what's playing next?", "Burna Boy is next.")

    assert reply == "Burna Boy is next."  # answered by the model, on the fair-use allowance
    assert lines(usage(lucy, ALICE))["quick"] == 1


# What Lucy says at each limit -------------------------------------------------------------------


def test_out_of_turns_says_turns_and_the_day_they_come_back(lucy, monkeypatch):  # noqa: F811
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.FREE, {RequestClass.EVERYDAY: 0})
    songs(lucy, CAROL, [("Calm Down", "Rema")])
    provider = script(lucy, [{"chunks": ["never called"]}])
    conversation = converse(lucy, CAROL)
    send(lucy, CAROL, conversation, "Play Rema")
    reply = snapshot(lucy, CAROL, conversation)["messages"][-1]["content"]

    assert USED_TURNS in reply and "come back on 1 " in reply
    assert AI_LIMIT not in reply
    assert "Calm Down - Rema" in reply and provider.seen == []


def test_at_the_dollar_ceiling_lucy_does_not_say_the_turns_are_used(lucy):  # noqa: F811
    """The fault this fixes: the ceiling stopped the turn while turns were left, and Lucy said
    "You've used this month's Lucy turns"."""
    songs(lucy, CAROL, [("Calm Down", "Rema")])
    spend_all(lucy, CAROL, Tier.FREE)
    provider = script(lucy, [{"chunks": ["never called"]}])
    conversation = converse(lucy, CAROL)
    send(lucy, CAROL, conversation, "Play Rema")
    reply = snapshot(lucy, CAROL, conversation)["messages"][-1]["content"]

    assert AI_LIMIT in reply and "separate from your turns" in reply
    assert USED_TURNS not in reply
    assert "comes back on 1 " in reply
    assert "Calm Down - Rema" in reply and provider.seen == []
    found = usage(lucy, CAROL)
    assert (found["used"], found["limit"]) == (0, 40)  # turns really are left, as she said
    with transaction(lucy.engine) as conn:
        assert conn.execute(sa.select(ai_runs.c.limited)).scalar_one() == "spend"


def test_with_turns_and_dollars_both_used_lucy_names_the_limit_that_stopped_her(
    lucy, monkeypatch,  # noqa: F811
):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.FREE, {RequestClass.EVERYDAY: 0})
    spend_all(lucy, CAROL, Tier.FREE)

    reply = say(lucy, CAROL, "Play Rema", "never said")

    # the ceiling is checked first, and its words are true whether or not turns are left
    assert AI_LIMIT in reply and USED_TURNS not in reply
    assert "Make a Mix still works" in reply


def test_premium_at_its_ceiling_is_told_about_the_ceiling(lucy):  # noqa: F811
    spend_all(lucy, ALICE, Tier.PREMIUM)
    reply = say(lucy, ALICE, "make a 3 hour mix", "never said")
    assert AI_LIMIT in reply and USED_TURNS not in reply
    assert usage(lucy, ALICE)["used"] == 0


def test_near_the_ceiling_a_lighter_model_still_answers_and_says_nothing(lucy):  # noqa: F811
    workspace = lucy.workspaces[ALICE]
    with transaction(lucy.engine, workspace) as conn:
        month = allowance.month_key(gateway.db_now(conn), "UTC")
        allowance.record_usage(conn, workspace, month, RequestClass.EVERYDAY, tokens_in=0,
                               tokens_out=0, cost_usd=6.2)

    reply = say(lucy, ALICE, "play Rema", "Here you go.")

    assert reply == "Here you go."  # stepping down a model is not a limit the person has hit
    assert usage(lucy, ALICE)["used"] == 1


def test_the_platform_cap_is_not_blamed_on_the_person(lucy, monkeypatch):  # noqa: F811
    monkeypatch.setenv("SELECTA_AI_DAILY_CAP_USD", "0.000001")

    reply = say(lucy, CAROL, "Play Rema", "never said")

    assert "very busy right now" in reply
    assert USED_TURNS not in reply and AI_LIMIT not in reply and "come back" not in reply
    assert usage(lucy, CAROL)["used"] == 0  # the turn was given back


def job(limited: str | None, month: str = "2026-11") -> SimpleNamespace:
    return SimpleNamespace(text="rema", plan=SimpleNamespace(limited=limited, month=month))


@pytest.fixture
def library(monkeypatch):
    found = {"songs": [{"title": "Calm Down", "artist": "Rema"}]}
    monkeypatch.setattr(cloud_agent.cloud_tools, "search_songs", lambda ctx, **_: found)
    return found


@pytest.mark.parametrize(("limited", "says", "never"), [
    ("allowance", [USED_TURNS, "come back on 1 December"], [AI_LIMIT, "busy", "reachable"]),
    ("spend", [AI_LIMIT, "separate from your turns", "comes back on 1 December"],
     [USED_TURNS, "busy", "reachable"]),
    ("platform", ["very busy right now"], [USED_TURNS, AI_LIMIT, "December"]),
    ("no_model", ["isn't reachable right now"], [USED_TURNS, AI_LIMIT, "December"]),
    (None, ["isn't reachable right now"], [USED_TURNS, AI_LIMIT, "December"]),
    ("a reason added later", ["isn't reachable right now"], [USED_TURNS, AI_LIMIT, "December"]),
])
def test_each_cause_has_its_own_true_words(library, limited, says, never):
    words = cloud_agent.builtin_words(job(limited), ctx=None)
    for phrase in says:
        assert phrase in words
    for phrase in never:
        assert phrase not in words
    assert "I can't think this one through" in words
    assert "Calm Down - Rema" in words and words.endswith(".")
    assert chr(0x2014) not in words  # the house rule: no em dashes


@pytest.mark.parametrize("limited", ["allowance", "spend", "platform", "no_model"])
def test_with_nothing_found_lucy_says_what_still_works(library, limited):
    library["songs"] = []
    words = cloud_agent.builtin_words(job(limited), ctx=None)
    assert words.endswith("Your mixes and music are unaffected, and Make a Mix still works.")


def test_the_two_limit_messages_are_different_sentences(library):
    turns = cloud_agent.builtin_words(job("allowance"), ctx=None)
    dollars = cloud_agent.builtin_words(job("spend"), ctx=None)
    assert turns != dollars


# The day the limit ends -------------------------------------------------------------------------


@pytest.mark.parametrize(("month", "day"), [
    ("2026-11", "1 December"),
    ("2026-12", "1 January"),  # the year turns over
    ("2027-01", "1 February"),
    ("2028-02", "1 March"),  # a leap February
    ("2026-03", "1 April"),  # across the change to summer time
    ("2026-10", "1 November"),  # and back
])
def test_the_day_named_is_the_first_of_the_next_month(month, day):
    assert cloud_agent._resets_words(job("allowance", month)) == day


@pytest.mark.parametrize("zone", [
    "UTC", "Pacific/Auckland", "Pacific/Kiritimati", "America/Los_Angeles", "Etc/GMT+12",
    "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe",
])
@pytest.mark.parametrize("moment", [
    "2026-11-30T09:59:00", "2026-11-30T10:01:00", "2026-11-30T23:59:59", "2026-12-01T00:00:00",
    "2026-12-01T11:59:00", "2026-12-01T12:01:00", "2026-12-31T23:30:00", "2026-03-29T01:30:00",
])
def test_the_day_lucy_names_is_the_day_the_meter_resets_in_every_time_zone(zone, moment):
    """Checked because it looked wrong: the date is formatted in UTC. It is right, because the
    month it starts from is already the account's own."""
    now = dt.datetime.fromisoformat(moment).replace(tzinfo=dt.UTC).timestamp()
    month = allowance.month_key(now, zone)  # what `gateway.plan_turn` gives the turn

    said = cloud_agent._resets_words(job("allowance", month))

    resets = dt.datetime.fromtimestamp(allowance.month_resets_at(month, zone), ZoneInfo(zone))
    assert said == f"{resets.day} {resets:%B}"
    assert resets.day == 1 and (resets.hour, resets.minute) == (0, 0)
    assert resets.timestamp() > now

