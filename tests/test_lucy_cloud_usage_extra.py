"""Extra-usage packs spent at the weekly limit, and the meter's third line (ADR-0486 rules 3
and 7, LM-0486-04 and LM-0486-06).

Through the routes: Alice (Premium) and Carol (Free) are on the new allowance the way
`test_lucy_cloud_usage_enforced` puts them there, and a scripted provider stands in for the
model. A pack is credited the way the webhook credits one, and the weekly yes is recorded the
way `POST /api/billing/lucy-packs/confirm` records it. The pack sizes are test figures.
"""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, CAROL, auth
from test_lucy_cloud import converse, events, lucy, script, send, snapshot, songs  # noqa: F401
from test_lucy_cloud_usage_enforced import limit_of, say, spend, windows  # noqa: F401

from selecta import flags
from selecta.ai import usage_extra, usage_units
from selecta.ai.schema import ai_runs
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_packs, lucy_usage_state
from selecta.billing import lucy_packs as packs
from selecta.flags.matching import Rule, RuleKind
from selecta.flags.rules import RuleSnapshot
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now, transaction

pytest_plugins = ("cloud_party",)
DAY = 86_400.0
PACK = 2_000_000
# Friday 15 January 2027, 08:00 UTC.
T0 = 1_800_000_000.0


def rules_for(workspace_ids: list[str], *, extra: bool = True) -> RuleSnapshot:
    rule = Rule(RuleKind.WORKSPACES, {"ids": workspace_ids, "on": True})
    found = {WINDOWS_FLAG: (rule,)}
    if extra:
        found[usage_extra.FLAG] = (rule,)
    return RuleSnapshot(1, found)


@pytest.fixture
def extra(windows):  # noqa: F811
    """Alice and Carol on the new allowance and decided on for `lucy.extra_usage`."""
    ids = [windows.workspaces[ALICE], windows.workspaces[CAROL]]
    windows.app.state.flag_rules = rules_for(ids)
    return windows


def credit(party, token: str, units: int = PACK, *, payment: str = "pi_1",
           bought_ago: float = 0.0) -> str:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        packs.credit(conn, workspace_id=workspace, payment_id=payment, units=units,
                     now=db_now(conn) - bought_ago)
        return conn.execute(sa.select(lucy_usage_packs.c.id).where(
            lucy_usage_packs.c.payment_id == payment)).scalar_one()


def confirm(party, token: str) -> None:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        week = usage_units.units_view(conn, workspace, now=db_now(conn))["week_seq"]
        assert packs.confirm_week(conn, workspace, week)


def left(party, token: str) -> int:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        return packs.balance(conn, workspace, db_now(conn))["remaining_units"]


def week(party, token: str) -> dict:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        row = conn.execute(sa.select(lucy_usage_state).where(
            lucy_usage_state.c.workspace_id == workspace)).first()
    return dict(row._mapping)


def ledger(party, token: str) -> list[dict]:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        rows = conn.execute(
            sa.select(lucy_usage_ledger).where(lucy_usage_ledger.c.workspace_id == workspace)
            .order_by(lucy_usage_ledger.c.created_at, lucy_usage_ledger.c.id)
        ).all()
    return [dict(row._mapping) for row in rows]


def runs(party, token: str) -> list[dict]:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        rows = conn.execute(
            sa.select(ai_runs.c.deployment_id, ai_runs.c.fallback_used, ai_runs.c.limited)
            .where(ai_runs.c.workspace_id == workspace)
            .order_by(ai_runs.c.started_at, ai_runs.c.id)
        ).all()
    return [dict(row._mapping) for row in rows]


def ask(party, token: str, text: str, reply: str = "Here you go.", **step) -> dict:
    """One message answered by a model that reports what it used."""
    step = {"chunks": [reply], "tokens_in": 4_000, "tokens_out": 900, **step}
    script(party, [step])
    conversation = converse(party, token)
    assert send(party, token, conversation, text).status_code == 200
    message = snapshot(party, token, conversation)["messages"][-1]
    return {"message": message, "events": events(party, token, conversation)}


def meter(party, token: str) -> dict:
    return party.client.get("/api/account/lucy", headers=auth(token)).json()["usage_windows"]


# Spending at the weekly limit ---------------------------------------------------------------


def test_a_spent_week_with_a_confirmed_pack_is_answered_on_the_plans_own_model(extra):
    ask(extra, ALICE, "play Rema")  # an ordinary turn, to learn the plan's own model
    credit(extra, ALICE)
    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)
    before = week(extra, ALICE)

    turn = ask(extra, ALICE, "and another", "Here is another.")

    assert turn["message"]["content"] == "Here is another."  # a model answered
    assert limit_of(turn) is None
    ordinary, paid = runs(extra, ALICE)
    assert paid == ordinary, "the same model, no step down and no limit on the run"
    entry = ledger(extra, ALICE)[-1]
    assert (entry["pool"], entry["mode"], entry["session_seq"]) == ("extra", "enforced", None)
    assert 0 < entry["charged_units"] < entry["reserved_units"]
    assert left(extra, ALICE) == PACK - entry["charged_units"], "only the real cost is kept"
    after = week(extra, ALICE)
    assert after["week_used"] == before["week_used"] == before["week_limit"]
    assert after["week_reserved"] == before["week_reserved"]
    assert (after["session_used"], after["session_reserved"]) == (
        before["session_used"], before["session_reserved"]), "the session is not charged"


def test_a_spent_session_as_well_does_not_stop_a_confirmed_pack(extra):
    credit(extra, ALICE)
    spend(extra, ALICE, week=True, session=True)
    confirm(extra, ALICE)

    turn = ask(extra, ALICE, "play Rema")

    assert turn["message"]["content"] == "Here you go."
    assert ledger(extra, ALICE)[-1]["pool"] == "extra" and left(extra, ALICE) < PACK
    assert runs(extra, ALICE)[-1]["fallback_used"] is False


def test_without_this_weeks_yes_the_planner_answers_and_the_page_may_offer_extra(extra):
    credit(extra, ALICE)
    spend(extra, ALICE, week=True)

    turn = say(extra, ALICE, "play Rema", "never said")

    assert "used all of Lucy's allowance for this week" in turn["message"]["content"]
    assert limit_of(turn)["next"] == ["wait", "extra"]
    done = [e for e in turn["events"] if e["type"] == "message.completed"][-1]
    assert done["payload"]["meta"]["limit"]["next"] == ["wait", "extra"]
    assert left(extra, ALICE) == PACK and ledger(extra, ALICE) == []


def test_a_yes_for_an_earlier_week_does_not_count_for_this_one(extra):
    credit(extra, ALICE)
    confirm(extra, ALICE)
    workspace = extra.workspaces[ALICE]
    with transaction(extra.engine, workspace) as conn:
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace)
                     .values(week_seq=lucy_usage_state.c.week_seq + 1))
    spend(extra, ALICE, week=True)

    turn = say(extra, ALICE, "play Rema", "never said")

    assert "for this week" in turn["message"]["content"] and left(extra, ALICE) == PACK


def test_with_the_flag_off_a_pack_is_never_offered_and_never_spent(windows):  # noqa: F811
    credit(windows, ALICE)
    spend(windows, ALICE, week=True)
    confirm(windows, ALICE)

    turn = say(windows, ALICE, "play Rema", "never said")

    assert "for this week" in turn["message"]["content"]
    assert limit_of(turn)["next"] == ["wait"]
    assert left(windows, ALICE) == PACK and ledger(windows, ALICE) == []


def test_with_no_balance_extra_is_never_offered(extra):
    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)

    turn = say(extra, ALICE, "play Rema", "never said")

    assert "for this week" in turn["message"]["content"]
    assert limit_of(turn)["next"] == ["wait"]


def test_a_spent_session_with_week_left_steps_down_and_leaves_the_pack_alone(extra):
    credit(extra, ALICE)
    confirm(extra, ALICE)
    spend(extra, ALICE, session=True)

    turn = ask(extra, ALICE, "play Rema")

    assert turn["message"]["content"] == "Here you go."
    assert limit_of(turn)["cause"] == "session_lighter"
    assert left(extra, ALICE) == PACK
    assert [entry["pool"] for entry in ledger(extra, ALICE)] == ["plan"]
    assert runs(extra, ALICE)[-1]["fallback_used"] is True


def test_a_turn_with_week_left_never_touches_the_pack(extra):
    credit(extra, ALICE)
    confirm(extra, ALICE)

    ask(extra, ALICE, "play Rema")

    assert left(extra, ALICE) == PACK
    assert [entry["pool"] for entry in ledger(extra, ALICE)] == ["plan"]
    assert week(extra, ALICE)["week_used"] > 0


def test_a_turn_that_fails_returns_its_whole_reservation_to_the_pack(extra):
    credit(extra, ALICE)
    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)
    script(extra, [{"error": "The provider took too long.", "code": "timeout"}] * 6)
    conversation = converse(extra, ALICE)

    send(extra, ALICE, conversation, "play Rema")

    entry = ledger(extra, ALICE)[-1]
    assert entry["pool"] == "extra" and entry["reserved_units"] > 0
    assert entry["outcome"] in usage_units.REFUNDED_OUTCOMES and entry["charged_units"] == 0
    assert left(extra, ALICE) == PACK
    assert week(extra, ALICE)["week_used"] == week(extra, ALICE)["week_limit"]


def test_a_balance_too_small_for_one_turn_is_not_spent_and_never_goes_negative(extra):
    credit(extra, ALICE, units=25)
    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)

    turn = say(extra, ALICE, "play Rema", "never said")

    assert "for this week" in turn["message"]["content"]
    assert limit_of(turn)["next"] == ["wait", "extra"], "a balance exists, so it is offered"
    assert left(extra, ALICE) == 25 and ledger(extra, ALICE) == []


def test_expired_and_refunded_packs_are_not_spent_or_offered(extra):
    old = credit(extra, ALICE, payment="pi_old", bought_ago=packs.LIFETIME_SECONDS + DAY)
    undone = credit(extra, ALICE, payment="pi_undone")
    workspace = extra.workspaces[ALICE]
    with transaction(extra.engine, workspace) as conn:
        assert packs.mark_refunded(conn, undone, db_now(conn))
    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)

    turn = say(extra, ALICE, "play Rema", "never said")

    assert "for this week" in turn["message"]["content"]
    assert limit_of(turn)["next"] == ["wait"]
    with transaction(extra.engine, workspace) as conn:
        kept = dict(conn.execute(
            sa.select(lucy_usage_packs.c.id, lucy_usage_packs.c.remaining_units)).all())
    assert kept == {old: PACK, undone: PACK}
    assert "extra" not in meter(extra, ALICE)


def test_free_with_a_pack_left_from_a_paid_plan_spends_it_on_frees_own_model(extra):
    ask(extra, CAROL, "play Rema")
    credit(extra, CAROL)
    spend(extra, CAROL, week=True)
    confirm(extra, CAROL)

    ask(extra, CAROL, "and another")

    ordinary, paid = runs(extra, CAROL)
    assert paid == ordinary and left(extra, CAROL) < PACK


# The meter's third line ---------------------------------------------------------------------


def test_the_meter_has_the_extra_line_only_while_a_balance_exists(extra):
    assert "extra" not in meter(extra, ALICE)

    credit(extra, ALICE)
    assert meter(extra, ALICE)["extra"]["left"] == 100

    spend(extra, ALICE, week=True)
    confirm(extra, ALICE)
    ask(extra, ALICE, "play Rema")
    shown = meter(extra, ALICE)["extra"]
    assert set(shown) == {"left", "expires_at"}
    assert 0 < shown["left"] < 100, "some is spent, so not all"

    workspace = extra.workspaces[ALICE]
    with transaction(extra.engine, workspace) as conn:
        conn.execute(sa.update(lucy_usage_packs).values(remaining_units=0))
    assert "extra" not in meter(extra, ALICE)
    assert "extra" not in meter(extra, CAROL), "one workspace's pack is not another's"


def test_the_extra_line_is_a_share_of_the_pack_bought_last_and_never_above_all(extra):
    credit(extra, ALICE, units=1_000, payment="pi_small", bought_ago=DAY)
    credit(extra, ALICE, units=4_000, payment="pi_large")
    assert meter(extra, ALICE)["extra"]["left"] == 100  # 5,000 of a 4,000 pack

    workspace = extra.workspaces[ALICE]
    with transaction(extra.engine, workspace) as conn:
        assert packs.spend(conn, workspace_id=workspace, units=3_000, now=db_now(conn)) == 3_000
    assert meter(extra, ALICE)["extra"]["left"] == 50
    shown = meter(extra, ALICE)["extra"]
    assert set(shown) == {"left", "expires_at"}, "a share and its expiry, never units"
    assert shown["expires_at"] > 0


# The rules on their own, with the time passed in -----------------------------------------------


def account(engine, workspace="w", user="user-w") -> RuleSnapshot:
    """A workspace with an owner, a spent week on the new allowance and a yes for that week."""
    flags.use("+cloud.local_media +lucy.cloud_conversation +lucy.usage_shadow")
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=T0 - 30 * DAY))
        conn.execute(workspaces.insert().values(
            id=workspace, name="Mine", kind="personal", owner_user_id=user,
            created_at=T0 - 30 * DAY))
    with transaction(engine, workspace) as conn:
        usage_units.ensure_state(conn, workspace, plan_id="free", now=T0)
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace)
                     .values(week_used=lucy_usage_state.c.week_limit))
        assert packs.confirm_week(conn, workspace, 1)
    return rules_for([workspace])


@pytest.fixture
def flags_reset():
    yield
    flags.use(None)


def reserve(engine, rules, run: str, now: float = T0, units: int = 20_000,
            workspace: str = "w") -> bool:
    with transaction(engine, workspace) as conn:
        return usage_extra.reserve(conn, workspace_id=workspace, run_id=run, tier="free",
                                   now=now, reserved_units=units, rules=rules)


def pack(engine, payment: str, units: int, now: float = T0, workspace: str = "w") -> None:
    with transaction(engine, workspace) as conn:
        packs.credit(conn, workspace_id=workspace, payment_id=payment, units=units, now=now)


def remaining(engine, workspace: str = "w") -> list[int]:
    with transaction(engine, workspace) as conn:
        return list(conn.scalars(
            sa.select(lucy_usage_packs.c.remaining_units)
            .where(lucy_usage_packs.c.workspace_id == workspace)
            .order_by(lucy_usage_packs.c.expires_at, lucy_usage_packs.c.id)))


def settle(engine, run: str, charged: int, outcome: str = "completed", now: float = T0 + 60):
    with transaction(engine, "w") as conn:
        return usage_units.settle(conn, run_id=run, outcome=outcome, charged_units=charged,
                                  answered_deployment_id="deployment-1", now=now)


def test_a_reservation_takes_one_turns_cap_and_settlement_returns_the_rest(
    cloud_engine, flags_reset
):
    rules = account(cloud_engine)
    pack(cloud_engine, "pi_soon", 15_000)
    pack(cloud_engine, "pi_later", 30_000, now=T0 + DAY)

    assert reserve(cloud_engine, rules, "run-1") is True
    assert remaining(cloud_engine) == [0, 25_000], "soonest expiry is spent first"
    assert reserve(cloud_engine, rules, "run-1") is False, "one run is reserved for once"
    assert remaining(cloud_engine) == [0, 25_000]

    assert settle(cloud_engine, "run-1", 4_000) is True
    assert remaining(cloud_engine) == [15_000, 26_000], "no pack is lifted above its size"
    assert settle(cloud_engine, "run-1", 4_000) is False
    assert remaining(cloud_engine) == [15_000, 26_000], "settling twice returns nothing more"


def test_a_cost_above_the_reservation_is_taken_from_the_pack_as_far_as_it_goes(
    cloud_engine, flags_reset
):
    rules = account(cloud_engine)
    pack(cloud_engine, "pi_1", 21_000)
    assert reserve(cloud_engine, rules, "run-1") is True

    settle(cloud_engine, "run-1", 23_000)

    assert remaining(cloud_engine) == [0]


@pytest.mark.parametrize("outcome", sorted(usage_units.REFUNDED_OUTCOMES))
def test_an_outcome_that_is_no_fault_of_the_member_returns_everything(
    cloud_engine, flags_reset, outcome
):
    rules = account(cloud_engine)
    pack(cloud_engine, "pi_1", 50_000)
    assert reserve(cloud_engine, rules, "run-1") is True

    settle(cloud_engine, "run-1", usage_units.charge_for(outcome, 0.5), outcome=outcome)

    assert remaining(cloud_engine) == [50_000]


def test_each_rule_on_its_own_stops_a_pack_being_spent(cloud_engine, flags_reset):
    rules = account(cloud_engine)
    pack(cloud_engine, "pi_1", 50_000)

    def set_state(**values) -> None:
        with transaction(cloud_engine, "w") as conn:
            conn.execute(sa.update(lucy_usage_state).values(**values))

    assert reserve(cloud_engine, None, "run-a") is False, "no rules, so the flag is off"
    assert reserve(cloud_engine, rules_for(["w"], extra=False), "run-b") is False
    assert reserve(cloud_engine, rules_for(["someone-else"]), "run-c") is False
    set_state(week_used=lucy_usage_state.c.week_limit - 1)
    assert reserve(cloud_engine, rules, "run-d") is False, "the week has room"
    set_state(week_used=lucy_usage_state.c.week_limit, extra_confirmed_week_seq=None)
    assert reserve(cloud_engine, rules, "run-e") is False, "no yes this week"
    set_state(extra_confirmed_week_seq=1, override_multiplier_milli=0)
    assert reserve(cloud_engine, rules, "run-f") is False, "Lucy's AI is switched off"
    set_state(override_multiplier_milli=None)
    assert reserve(cloud_engine, rules, "run-g", now=T0 + packs.LIFETIME_SECONDS) is False
    assert remaining(cloud_engine) == [50_000]

    assert reserve(cloud_engine, rules, "run-h") is True
    assert remaining(cloud_engine) == [30_000]


def test_the_plans_per_turn_cap_bounds_what_one_turn_reserves(cloud_engine, flags_reset):
    rules = account(cloud_engine)
    pack(cloud_engine, "pi_1", 500_000)

    assert reserve(cloud_engine, rules, "run-1", units=450_000) is True

    assert remaining(cloud_engine) == [500_000 - usage_units.targets("free").turn_cap]


def test_units_given_back_never_lift_a_pack_above_what_was_bought(cloud_engine):
    pack(cloud_engine, "pi_soon", 1_000)
    pack(cloud_engine, "pi_later", 1_000, now=T0 + DAY)
    pack(cloud_engine, "pi_undone", 1_000, now=T0 + 2 * DAY)
    with transaction(cloud_engine, "w") as conn:
        assert packs.spend(conn, workspace_id="w", units=1_400, now=T0 + 2 * DAY) == 1_400
        assert packs.give_back(conn, workspace_id="w", units=5_000, now=T0 + 3 * DAY) == 1_400
    assert remaining(cloud_engine) == [1_000, 1_000, 1_000]

    with transaction(cloud_engine, "w") as conn:
        packs.spend(conn, workspace_id="w", units=1_500, now=T0 + 3 * DAY)
        gone = T0 + packs.LIFETIME_SECONDS + 1  # the first pack has expired by now
        assert packs.give_back(conn, workspace_id="w", units=1_500, now=gone) == 500
    assert remaining(cloud_engine) == [0, 1_000, 1_000]


def test_sends_racing_for_the_last_of_a_pack_admit_only_what_fits(postgres_engine, flags_reset):
    engine = postgres_engine
    rules = account(engine)
    pack(engine, "pi_1", 30_000)
    pack(engine, "pi_2", 20_000, now=T0 + 1)
    count = 8
    admitted, errors, ready = [], [], threading.Barrier(count)

    def one(number: int) -> None:
        try:
            ready.wait(timeout=30)
            admitted.append(reserve(engine, rules, f"run-{number}"))
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one, args=(number,)) for number in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert count * 20_000 > 50_000, "the sends ask for more than there is"
    assert sorted(admitted) == [False] * (count - 2) + [True] * 2
    assert sum(remaining(engine)) == 10_000 and min(remaining(engine)) >= 0
    with transaction(engine, "w") as conn:
        rows = conn.execute(sa.select(lucy_usage_ledger.c.pool, lucy_usage_ledger.c.reserved_units)
                            .where(lucy_usage_ledger.c.workspace_id == "w")).all()
    assert [tuple(row) for row in rows] == [("extra", 20_000)] * 2
