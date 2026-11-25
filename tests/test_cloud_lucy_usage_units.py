"""Lucy's allowance in usage units, in its shadow form (`selecta.ai.usage_units`).

Every test moves the figures the way a real turn does, through `record_shadow` and `settle`, and
passes the time in as `now`, so the same rules are proved on SQLite and on PostgreSQL. The few
tests that set a column by hand (an override, a reservation, a venue-style row) do so because
the code that writes those columns is not built yet.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import random
import threading
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.ai import usage_units as units
from selecta.ai import usage_windows as windows
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_state
from selecta.billing import plans
from selecta.identity.schema import users, workspaces
from selecta.persistence import transaction

# Friday 15 January 2027, 08:00 UTC.
T0 = 1_800_000_000.0
HOUR, DAY, WEEK = 3600.0, 86_400.0, 7 * 86_400.0
FREE, STANDARD, PREMIUM = (units.targets(plan) for plan in ("free", "standard", "premium"))


def shadow(engine, run, now, workspace="w", plan="free") -> bool:
    with transaction(engine, workspace) as conn:
        return units.record_shadow(conn, workspace_id=workspace, run_id=run, plan_id=plan,
                                   tier=plan, now=now)


def settle(engine, run, charged, now, workspace="w", outcome="completed") -> bool:
    with transaction(engine, workspace) as conn:
        return units.settle(conn, run_id=run, outcome=outcome, charged_units=charged,
                            answered_deployment_id="deployment-1", now=now)


def roll(engine, now, workspace="w", plan="free") -> None:
    with transaction(engine, workspace) as conn:
        units.roll(conn, workspace, plan_id=plan, now=now)


def stored(engine, workspace="w") -> dict:
    with transaction(engine, workspace) as conn:
        row = conn.execute(
            sa.select(lucy_usage_state).where(lucy_usage_state.c.workspace_id == workspace)
        ).first()
    return dict(row._mapping)


def view(engine, now, workspace="w") -> dict | None:
    with transaction(engine, workspace) as conn:
        return units.units_view(conn, workspace, now=now)


def model(engine, now, workspace="w") -> dict | None:
    with transaction(engine, workspace) as conn:
        return units.read_model(conn, workspace, now=now)


def ledger(engine, workspace="w") -> list[dict]:
    with transaction(engine, workspace) as conn:
        rows = conn.execute(
            sa.select(lucy_usage_ledger).where(lucy_usage_ledger.c.workspace_id == workspace)
            .order_by(lucy_usage_ledger.c.created_at, lucy_usage_ledger.c.run_id)
        ).all()
    return [dict(row._mapping) for row in rows]


def set_columns(engine, workspace="w", **values) -> None:
    with transaction(engine, workspace) as conn:
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace).values(**values))


def make_row(engine, now=T0, workspace="w", plan="free") -> None:
    with transaction(engine, workspace) as conn:
        units.ensure_state(conn, workspace, plan_id=plan, now=now)


def limits(engine, workspace="w") -> tuple:
    row = stored(engine, workspace)
    return row["plan_id"], row["week_limit"], row["session_limit"]


def owned_workspace(engine, workspace, user, time_zone, created_at) -> None:
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=user, auth_subject=f"auth|{user}", email_verified=True, timezone=time_zone,
            age_confirmed=True, created_at=created_at,
        ))
        conn.execute(workspaces.insert().values(
            id=workspace, name="Mine", kind="personal", owner_user_id=user,
            created_at=created_at,
        ))


def test_the_week_resets_on_the_weekday_and_local_hour_the_workspace_was_created(cloud_engine):
    tokyo = ZoneInfo("Asia/Tokyo")
    # Wednesday 6 January 2027, 23:30 in Tokyo, which is still Wednesday afternoon in UTC.
    created = dt.datetime(2027, 1, 6, 23, 30, tzinfo=tokyo).timestamp()
    owned_workspace(cloud_engine, "ws-tokyo", "user-tokyo", "Asia/Tokyo", created)

    assert shadow(cloud_engine, "run-1", T0, workspace="ws-tokyo") is True

    row = stored(cloud_engine, "ws-tokyo")
    assert (row["time_zone"], row["anchor_weekday"], row["anchor_hour"]) == ("Asia/Tokyo", 2, 23)
    for edge in (row["week_started_at"], row["week_ends_at"]):
        local = dt.datetime.fromtimestamp(edge, tokyo)
        assert (local.weekday(), local.hour, local.minute) == (2, 23, 0)
    assert row["week_started_at"] <= T0 < row["week_ends_at"]
    assert row["week_ends_at"] - row["week_started_at"] == WEEK


def test_a_workspace_with_no_account_row_is_anchored_at_now_in_utc(cloud_engine):
    make_row(cloud_engine, T0 + 1234, plan="standard")

    row = stored(cloud_engine)
    assert (row["time_zone"], row["anchor_weekday"], row["anchor_hour"]) == ("UTC", 4, 8)
    assert (row["week_started_at"], row["week_ends_at"]) == (T0, T0 + WEEK)


def test_a_new_row_starts_week_one_with_the_plans_limits_and_no_session_open(cloud_engine):
    make_row(cloud_engine, plan="standard")

    row = stored(cloud_engine)
    assert (row["plan_id"], row["catalogue_version"]) == ("standard", plans.lucy_usage().version)
    assert (row["week_seq"], row["week_limit"]) == (1, STANDARD.week_limit)
    assert (row["session_seq"], row["session_ends_at"]) == (0, None)
    assert row["session_limit"] == STANDARD.session_limit
    used = ("week_used", "week_reserved", "session_used", "session_reserved")
    assert [row[name] for name in used] == [0, 0, 0, 0]
    make_row(cloud_engine, T0 + 3 * DAY, plan="premium")
    assert stored(cloud_engine) == row, "ensuring the row again changes nothing"


def test_targets_come_from_the_allowance_catalogue():
    usage = plans.lucy_usage()
    for plan_id, entry in usage.plans.items():
        found = units.targets(plan_id)
        assert found == units.Targets(
            plan_id, usage.version, usage.base_weekly_units * entry.multiplier_milli // 1000,
            plans.lucy_session_limit(usage, plan_id), entry.max_turn_units,
        )
    assert units.targets("free", override_multiplier_milli=0).week_limit == 0
    assert units.targets("free", override_multiplier_milli=0).session_limit == 0
    assert units.targets("no-such-plan").week_limit == FREE.week_limit


def test_the_first_turn_opens_a_session_that_closes_exactly_five_hours_later(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", 100, T0 + 60)
    shadow(cloud_engine, "run-inside", T0 + 4 * HOUR)
    closes = T0 + 5 * HOUR
    assert stored(cloud_engine)["session_ends_at"] == closes == T0 + windows.SESSION_SECONDS, (
        "a later turn inside the session does not move its end"
    )
    assert [entry["session_seq"] for entry in ledger(cloud_engine)] == [1, 1]

    roll(cloud_engine, closes - 1)
    row = stored(cloud_engine)
    assert (row["session_seq"], row["session_ends_at"], row["session_used"]) == (1, closes, 100)
    assert model(cloud_engine, closes - 1)["session"]["open"] is True

    assert model(cloud_engine, closes)["session"]["open"] is False, "closed at five hours sharp"
    roll(cloud_engine, closes)
    row = stored(cloud_engine)
    assert (row["session_seq"], row["session_ends_at"], row["session_used"]) == (1, None, 0)

    shadow(cloud_engine, "run-2", closes + 1)
    row = stored(cloud_engine)
    assert (row["session_seq"], row["session_ends_at"]) == (2, closes + 1 + 5 * HOUR)
    assert row["week_used"] == 100, "closing a session gives nothing back to the week"


def test_a_row_with_no_session_limit_never_opens_a_session(cloud_engine):
    make_row(cloud_engine)
    set_columns(cloud_engine, session_limit=None)

    shadow(cloud_engine, "run-1", T0 + 1)
    settle(cloud_engine, "run-1", 50, T0 + 2)
    roll(cloud_engine, T0 + WEEK)

    row = stored(cloud_engine)
    assert (row["session_seq"], row["session_ends_at"], row["session_limit"]) == (0, None, None)
    assert ledger(cloud_engine)[0]["session_seq"] is None
    found = model(cloud_engine, T0 + WEEK)
    assert found["session"] is None and found["week"]["left"] == 100


def test_the_weekly_roll_starts_the_next_week_with_nothing_used(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", 900, T0 + 1)

    roll(cloud_engine, T0 + WEEK - 1)
    assert (stored(cloud_engine)["week_seq"], stored(cloud_engine)["week_used"]) == (1, 900)

    roll(cloud_engine, T0 + WEEK)
    row = stored(cloud_engine)
    assert (row["week_seq"], row["week_used"], row["week_reserved"]) == (2, 0, 0)
    assert (row["week_started_at"], row["week_ends_at"]) == (T0 + WEEK, T0 + 2 * WEEK)
    roll(cloud_engine, T0 + WEEK)
    assert stored(cloud_engine) == row, "rolling twice at one moment moves one week only"


def test_a_week_nobody_used_is_skipped_and_the_roll_lands_in_the_week_holding_now(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    later = T0 + 15 * DAY

    shadow(cloud_engine, "run-2", later)

    row = stored(cloud_engine)
    assert row["week_seq"] == 2
    assert (row["week_started_at"], row["week_ends_at"]) == (T0 + 2 * WEEK, T0 + 3 * WEEK)
    assert row["week_started_at"] <= later < row["week_ends_at"]


def test_the_weekly_roll_moves_the_row_to_the_newest_catalogue_version(cloud_engine, monkeypatch):
    shadow(cloud_engine, "run-1", T0, plan="standard")
    first = plans.lucy_usage()
    second = dataclasses.replace(
        first, version=first.version + 1, base_weekly_units=first.base_weekly_units * 3
    )
    monkeypatch.setattr(plans, "LUCY_USAGE", (*plans.LUCY_USAGE, second))

    roll(cloud_engine, T0 + DAY, plan="standard")
    row = stored(cloud_engine)
    assert (row["catalogue_version"], row["week_limit"]) == (first.version, STANDARD.week_limit), (
        "a workspace keeps its version until its weekly reset (ADR-0485 rule 6)"
    )

    roll(cloud_engine, T0 + WEEK, plan="standard")
    row = stored(cloud_engine)
    assert row["catalogue_version"] == second.version
    assert row["week_limit"] == STANDARD.week_limit * 3
    assert row["session_limit"] == plans.lucy_session_limit(second, "standard")


def test_an_upgrade_raises_both_limits_at_once_and_keeps_what_was_used(cloud_engine):
    shadow(cloud_engine, "run-1", T0, plan="free")
    settle(cloud_engine, "run-1", 700, T0 + 1)

    shadow(cloud_engine, "run-2", T0 + 60, plan="premium")

    row = stored(cloud_engine)
    assert limits(cloud_engine) == ("premium", PREMIUM.week_limit, PREMIUM.session_limit)
    assert (row["week_seq"], row["week_used"], row["session_used"]) == (1, 700, 700)


def test_a_downgrade_waits_for_the_weekly_roll(cloud_engine):
    shadow(cloud_engine, "run-1", T0, plan="premium")

    shadow(cloud_engine, "run-2", T0 + DAY, plan="free")
    assert limits(cloud_engine) == ("premium", PREMIUM.week_limit, PREMIUM.session_limit)

    shadow(cloud_engine, "run-3", T0 + WEEK, plan="free")
    assert limits(cloud_engine) == ("free", FREE.week_limit, FREE.session_limit)


@pytest.mark.parametrize("override", [0, 500])
def test_a_lower_override_applies_at_the_weekly_roll(cloud_engine, override):
    shadow(cloud_engine, "run-1", T0, plan="standard")
    set_columns(cloud_engine, override_multiplier_milli=override)
    wanted = units.targets("standard", override_multiplier_milli=override)

    roll(cloud_engine, T0 + DAY, plan="standard")
    assert stored(cloud_engine)["week_limit"] == STANDARD.week_limit

    roll(cloud_engine, T0 + WEEK, plan="standard")
    assert limits(cloud_engine) == ("standard", wanted.week_limit, wanted.session_limit)
    roll(cloud_engine, T0 + WEEK + 1, plan="standard")
    assert stored(cloud_engine)["week_limit"] == wanted.week_limit, "the plan does not undo it"
    if override == 0:
        found = model(cloud_engine, T0 + WEEK + 1)
        assert (found["week"]["state"], found["week"]["left"]) == ("spent", 0)
        assert (found["session"]["state"], found["session"]["segments"]) == ("spent", 0)


def test_a_higher_override_raises_the_limits_at_once(cloud_engine):
    shadow(cloud_engine, "run-1", T0, plan="free")
    set_columns(cloud_engine, override_multiplier_milli=5_000)

    roll(cloud_engine, T0 + 1, plan="free")

    wanted = units.targets("free", override_multiplier_milli=5_000)
    assert limits(cloud_engine) == ("free", wanted.week_limit, wanted.session_limit)


def test_recording_a_run_twice_writes_one_ledger_row(cloud_engine):
    assert shadow(cloud_engine, "run-1", T0) is True
    assert shadow(cloud_engine, "run-1", T0 + 30) is False

    rows = ledger(cloud_engine)
    assert len(rows) == 1
    row, state = rows[0], stored(cloud_engine)
    assert (row["mode"], row["pool"], row["tier"]) == ("shadow", "plan", "free")
    assert (row["reserved_units"], row["charged_units"], row["settled_at"]) == (0, None, None)
    assert (row["week_seq"], row["session_seq"]) == (1, 1)
    assert (row["week_ends_at"], row["session_ends_at"]) == (
        state["week_ends_at"], state["session_ends_at"]
    )
    assert (row["catalogue_version"], row["created_at"]) == (state["catalogue_version"], T0)


def test_a_run_is_charged_once_and_an_unknown_or_second_settle_changes_nothing(cloud_engine):
    shadow(cloud_engine, "run-1", T0)

    assert settle(cloud_engine, "run-1", 321, T0 + 5) is True
    assert settle(cloud_engine, "run-1", 999, T0 + 6, outcome="failed") is False
    assert settle(cloud_engine, "run-never-recorded", 50, T0 + 7) is False

    row = stored(cloud_engine)
    assert (row["week_used"], row["session_used"]) == (321, 321)
    entry = ledger(cloud_engine)[0]
    assert (entry["charged_units"], entry["outcome"], entry["settled_at"]) == (
        321, "completed", T0 + 5
    )
    assert entry["answered_deployment_id"] == "deployment-1"


@pytest.mark.parametrize("outcome", ["failed", "incomplete", "abandoned"])
def test_a_turn_that_failed_through_no_fault_of_the_person_is_charged_nothing(
    cloud_engine, outcome
):
    assert units.charge_for(outcome, 0.5) == 0
    shadow(cloud_engine, "run-1", T0)

    settle(cloud_engine, "run-1", units.charge_for(outcome, 0.5), T0 + 1, outcome=outcome)

    row = stored(cloud_engine)
    assert (row["week_used"], row["session_used"]) == (0, 0)
    entry = ledger(cloud_engine)[0]
    assert (entry["charged_units"], entry["outcome"]) == (0, outcome)


@pytest.mark.parametrize("outcome", ["completed", "cancelled"])
def test_a_completed_or_stopped_turn_is_charged_what_it_used(outcome):
    assert units.charge_for(outcome, 0.0123) == windows.to_units(0.0123) == 12_300
    assert units.charge_for(outcome, 0.0) == 0


def test_a_turn_settled_after_its_session_closed_does_not_touch_the_new_session(cloud_engine):
    shadow(cloud_engine, "run-old", T0)
    shadow(cloud_engine, "run-new", T0 + 5 * HOUR + 1)
    settle(cloud_engine, "run-new", 40, T0 + 5 * HOUR + 2)

    assert settle(cloud_engine, "run-old", 500, T0 + 5 * HOUR + 3) is True

    row = stored(cloud_engine)
    assert (row["session_seq"], row["session_used"]) == (2, 40)
    assert row["week_used"] == 540, "the week it was admitted in is still the current one"
    assert ledger(cloud_engine)[0]["charged_units"] == 500


def test_a_turn_settled_after_its_session_closed_with_none_open_charges_no_session(cloud_engine):
    shadow(cloud_engine, "run-old", T0)
    roll(cloud_engine, T0 + 5 * HOUR)

    settle(cloud_engine, "run-old", 500, T0 + 5 * HOUR + 3)

    row = stored(cloud_engine)
    assert (row["session_ends_at"], row["session_used"], row["week_used"]) == (None, 0, 500)


def test_a_turn_settled_after_its_week_rolled_does_not_touch_the_new_week(cloud_engine):
    make_row(cloud_engine)
    shadow(cloud_engine, "run-old", T0 + WEEK - 60)
    shadow(cloud_engine, "run-new", T0 + WEEK)
    settle(cloud_engine, "run-new", 70, T0 + WEEK + 1)

    assert settle(cloud_engine, "run-old", 800, T0 + WEEK + 2) is True

    row = stored(cloud_engine)
    assert (row["week_seq"], row["week_used"]) == (2, 70)
    assert row["session_used"] == 870, "its session spans the reset and is still open"
    old = ledger(cloud_engine)[0]
    assert (old["run_id"], old["week_seq"], old["charged_units"]) == ("run-old", 1, 800)


def test_settling_releases_the_runs_reservation_and_never_goes_below_nothing(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    with transaction(cloud_engine, "w") as conn:
        conn.execute(sa.update(lucy_usage_ledger).where(lucy_usage_ledger.c.run_id == "run-1")
                     .values(reserved_units=20_000))
    set_columns(cloud_engine, week_reserved=20_000, session_reserved=15_000)
    assert model(cloud_engine, T0 + 1)["week"]["left"] < 100, "reserved units count as used"

    settle(cloud_engine, "run-1", 300, T0 + 2)

    row = stored(cloud_engine)
    assert (row["week_reserved"], row["week_used"]) == (0, 300)
    assert (row["session_reserved"], row["session_used"]) == (0, 300)


def test_the_read_model_is_none_for_a_workspace_with_no_row(cloud_engine):
    assert model(cloud_engine, T0) is None
    assert view(cloud_engine, T0) is None


def test_the_read_model_gives_what_is_left_with_reset_times_in_plain_words(cloud_engine):
    make_row(cloud_engine)
    full = {"left": 100, "state": "ok", "resets_at": None, "back_words": None, "segments": 5}
    assert model(cloud_engine, T0)["session"] == full | {"open": False}, "none open reads full"
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", FREE.session_limit // 2, T0 + 1)

    found = model(cloud_engine, T0 + HOUR)

    assert found["time_zone"] == "UTC"
    assert found["session"] == {
        "left": 50, "state": "ok", "resets_at": T0 + 5 * HOUR, "back_words": "13:00",
        "open": True, "segments": 2,
    }
    week_used = FREE.session_limit // 2
    assert found["week"] == {
        "left": windows.percent_left(week_used, FREE.week_limit), "state": "ok",
        "resets_at": T0 + WEEK, "back_words": "Friday 22 January 08:00",
        "segments": windows.segments_lit(week_used, FREE.week_limit),
    }


def test_a_spent_session_says_so_and_the_week_still_has_room(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", FREE.session_limit + 10, T0 + 1)

    found = model(cloud_engine, T0 + 2)

    assert (found["session"]["state"], found["session"]["left"]) == ("spent", 0)
    assert found["session"]["segments"] == 0
    assert found["week"]["state"] == "ok" and found["week"]["left"] >= 1


def test_reading_writes_nothing_even_when_the_week_and_session_have_ended(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", 444, T0 + 1)
    before = (stored(cloud_engine), ledger(cloud_engine))
    later = T0 + 9 * DAY

    found, raw = model(cloud_engine, later), view(cloud_engine, later)
    with transaction(cloud_engine, "w") as conn:
        units.export(conn, "w")

    assert (stored(cloud_engine), ledger(cloud_engine)) == before
    assert (found["week"]["left"], found["week"]["resets_at"]) == (100, T0 + 2 * WEEK)
    assert found["session"]["open"] is False and found["session"]["left"] == 100
    assert (raw["week_seq"], raw["week_used"], raw["session_used"]) == (2, 0, 0)


def figures(raw: dict, now: float) -> dict:
    """The read model worked out from the raw figures with the window helpers alone."""
    zone = raw["time_zone"]

    def line(used, limit, resets_at) -> dict:
        words = None if resets_at is None else windows.back_words(resets_at, zone, now)
        return {"left": windows.percent_left(used, limit), "state": windows.state(used, limit),
                "resets_at": resets_at, "back_words": words,
                "segments": windows.segments_lit(used, limit)}

    session = line(raw["session_used"] + raw["session_reserved"], raw["session_limit"],
                   raw["session_ends_at"])
    session["open"] = raw["session_ends_at"] is not None
    week = line(raw["week_used"] + raw["week_reserved"], raw["week_limit"], raw["week_ends_at"])
    return {"session": session, "week": week, "time_zone": zone}


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_after_any_run_of_turns_the_read_model_is_the_window_helpers_over_the_raw_figures(
    cloud_engine, seed
):
    """Also: rolling the row at `now` never changes what was already shown for `now`, and the
    row's used figures equal the charges of the runs in its current week and open session."""
    chance = random.Random(seed)
    now, started, unsettled = T0, 0, []
    for _ in range(60):
        now += chance.choice([1.0, 90.0, HOUR, 3 * HOUR, 6 * HOUR, 2 * DAY, 5 * DAY, 8 * DAY])
        move = chance.random()
        if move < 0.5 or not unsettled:
            started += 1
            shadow(cloud_engine, f"run-{started}", now)
            unsettled.append(f"run-{started}")
        elif move < 0.9:
            run = unsettled.pop(chance.randrange(len(unsettled)))
            settle(cloud_engine, run, chance.choice([0, 1, 250, 4_000, 9_000]), now)

        shown, raw = model(cloud_engine, now), view(cloud_engine, now)
        assert shown == figures(raw, now)
        assert raw["week_started_at"] <= now < raw["week_ends_at"]
        roll(cloud_engine, now)
        assert model(cloud_engine, now) == shown
        row, runs = stored(cloud_engine), ledger(cloud_engine)
        for seq in ("week_seq", "session_seq"):
            charges = sum(run["charged_units"] or 0 for run in runs if run[seq] == row[seq])
            if seq == "week_seq" or row["session_ends_at"] is not None:
                assert row[seq.replace("seq", "used")] == charges
        assert (row["week_reserved"], row["session_reserved"]) == (0, 0)


def test_one_workspaces_turns_are_not_seen_or_charged_in_another(cloud_engine):
    shadow(cloud_engine, "run-a", T0, workspace="a")
    shadow(cloud_engine, "run-b", T0, workspace="b", plan="standard")
    before = stored(cloud_engine, "b")

    settle(cloud_engine, "run-a", 5_000, T0 + 1, workspace="a")
    if cloud_engine.dialect.name == "postgresql":
        # Row-level security hides a's ledger row from a transaction that names b.
        assert settle(cloud_engine, "run-a", 1, T0 + 2, workspace="b") is False

    assert stored(cloud_engine, "b") == before
    assert model(cloud_engine, T0 + 2, workspace="b")["week"]["left"] == 100
    assert model(cloud_engine, T0 + 2, workspace="a")["week"]["left"] < 100
    assert model(cloud_engine, T0 + 2, workspace="c") is None
    with transaction(cloud_engine, "b") as conn:
        assert [run["run_id"] for run in units.export(conn, "b")["runs"]] == ["run-b"]


def test_the_export_lists_the_windows_and_each_run_with_no_internal_ids(cloud_engine):
    shadow(cloud_engine, "run-1", T0)
    settle(cloud_engine, "run-1", 77, T0 + 1)
    shadow(cloud_engine, "run-2", T0 + 2)

    with transaction(cloud_engine, "w") as conn:
        found = units.export(conn, "w")
        assert units.export(conn, "nobody") == {"state": None, "runs": []}

    assert found["runs"] == [
        {"run_id": "run-1", "created_at": T0, "mode": "shadow", "charged_units": 77,
         "outcome": "completed", "week_seq": 1, "session_seq": 1},
        {"run_id": "run-2", "created_at": T0 + 2, "mode": "shadow", "charged_units": None,
         "outcome": None, "week_seq": 1, "session_seq": 1},
    ]
    state = found["state"]
    assert (state["plan_id"], state["week_used"], state["time_zone"]) == ("free", 77, "UTC")
    assert not {"id", "workspace_id"} & set(state)


def in_threads(count: int, work) -> list:
    results, errors, ready = [], [], threading.Barrier(count)

    def one(index: int) -> None:
        try:
            ready.wait(timeout=30)
            results.append(work(index))
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one, args=(index,)) for index in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    return results


def test_racing_turns_for_distinct_runs_are_each_charged_exactly_once(postgres_engine):
    engine = postgres_engine

    def one(index: int) -> int:
        charge = 100 + index
        assert shadow(engine, f"run-{index}", T0) is True
        assert settle(engine, f"run-{index}", charge, T0 + 1) is True
        return charge

    charged = in_threads(40, one)

    row, rows = stored(engine), ledger(engine)
    assert len(rows) == 40
    assert row["week_used"] == sum(charged) == sum(entry["charged_units"] for entry in rows)
    assert row["session_used"] == sum(charged)
    assert (row["week_seq"], row["session_seq"]) == (1, 1)


def test_racing_records_of_one_run_write_one_ledger_row(postgres_engine):
    engine = postgres_engine

    written = in_threads(20, lambda index: shadow(engine, "run-same", T0))

    assert sorted(written) == [False] * 19 + [True]
    assert len(ledger(engine)) == 1
    assert stored(engine)["session_seq"] == 1


def test_racing_rolls_past_the_end_of_a_week_move_one_week_and_open_one_session(postgres_engine):
    engine = postgres_engine
    shadow(engine, "run-0", T0)

    in_threads(20, lambda index: shadow(engine, f"run-late-{index}", T0 + WEEK + 5))

    row = stored(engine)
    assert (row["week_seq"], row["session_seq"]) == (2, 2)
    assert row["session_ends_at"] == T0 + WEEK + 5 + 5 * HOUR
    assert {entry["week_seq"] for entry in ledger(engine)[1:]} == {2}
