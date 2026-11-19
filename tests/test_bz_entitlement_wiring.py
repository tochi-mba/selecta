"""ADR-0448 allowances where the work happens: Lucy, analysis, render-ahead, readiness, cost.

Reuses the organisation of `test_bz_entitlement_routes` (two venues, Camden with two zones and
hours 10:00 to 23:00). The database clock starts at 2027-01-15 08:00 UTC.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_bz_entitlement_routes import flags_on, world  # noqa: F401 - shared fixtures

from selecta import flags
from selecta.ai.allowance import month_key
from selecta.ai.registry import RequestClass
from selecta.ai.schema import ai_usage
from selecta.business import entitlement_gates, entitlement_jobs
from selecta.business import entitlements as ent
from selecta.business.commercial_facts import SqlFacts
from selecta.persistence import new_id, transaction
from selecta.storage.api import _own_venue
from selecta.work import enqueue
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs


def _org(conn, world):  # noqa: F811
    return SqlFacts().organisation(conn, world["crown"])


def test_business_lucy_turns_come_from_the_venue_pool_and_go_back_on_failure(
    sqlite_engine, world, clock  # noqa: F811
):
    with transaction(sqlite_engine, world["crown"]) as conn:
        month = month_key(clock.time(), "Europe/London")
        start = entitlement_gates.lucy_start(conn, world["crown"], RequestClass("planning"),
                                             month)
        assert start is not None and start.admitted
        assert (start.used, start.limit) == (1, 60)  # 30 planning turns for each of 2 venues
        assert entitlement_gates.lucy_refund(conn, world["crown"], start.bucket)
        pools = ent.lucy_pools(conn, _org(conn, world), clock.time())
        assert pools["planning"].used == 0
        assert entitlement_gates.lucy_start(conn, "a-personal-workspace", "quick", month) is None


def test_a_used_up_pool_refuses_the_turn(sqlite_engine, world, clock):  # noqa: F811
    with transaction(sqlite_engine, world["crown"]) as conn:
        org = _org(conn, world)
        ent.add_counter(conn, org, ent.lucy_meter("deep_plan"),
                        ent.local_month(org.time_zone, clock.time()), 10, clock.time())
        start = entitlement_gates.lucy_start(conn, world["crown"], "deep_plan", "2027-01")
    assert start is not None and not start.admitted


def test_the_gateway_falls_back_to_the_plan_when_the_flag_is_off(sqlite_engine, world, clock):  # noqa: F811
    flags.use("+business.orgs")
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert entitlement_gates.lucy_start(conn, world["crown"], "quick", "2027-01") is None
        assert entitlement_gates.lucy_refund(conn, world["crown"], "quick") is False


def test_analysis_past_the_daily_allowance_waits_for_local_midnight(sqlite_engine, world, clock):  # noqa: F811
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        org = _org(conn, world)
        ent.add_counter(conn, org, ent.M_ANALYSIS, ent.local_date(org.time_zone, now),
                        ent.ANALYSIS_SONGS_PER_DAY, now)
        made = enqueue.enqueue(conn, JobSpec(
            workspace_id=world["crown"], type="analyse.song", idempotency_key="a" * 64,
            input_ref={"source_key": "k", "source_sha256": "a" * 64}), now)
        waits = conn.execute(sa.select(jobs.c.not_before).where(
            jobs.c.id == made.job.id)).scalar()
    assert waits == ent.next_local_midnight("Europe/London", now)


def test_analysis_inside_the_allowance_starts_now_and_is_counted(sqlite_engine, world, clock):  # noqa: F811
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        made = enqueue.enqueue(conn, JobSpec(
            workspace_id=world["crown"], type="analyse.song", idempotency_key="b" * 64,
            input_ref={"source_key": "k", "source_sha256": "b" * 64}), now)
        waits = conn.execute(sa.select(jobs.c.not_before).where(
            jobs.c.id == made.job.id)).scalar()
        used, _limit, _resets = ent.analysis_status(conn, _org(conn, world), now)
    assert waits is None and used == 1


def test_render_ahead_never_refuses_the_next_transition_and_stops_at_four_hours(
    sqlite_engine, world, clock  # noqa: F811
):
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        args = dict(now=now, ahead_s=5 * 3600)
        nxt = entitlement_gates.render_allowed(conn, world["crown"], world["camden"],
                                               world["bar"], next_transition=True, **args)
        far = entitlement_gates.render_allowed(conn, world["crown"], world["camden"],
                                               world["bar"], next_transition=False, **args)
    assert nxt == (True, "next_transition")
    assert far == (False, "ahead_full")


def _seam(conn, world, needed_by, now, *, state="succeeded", finished_at=None):  # noqa: F811
    job = enqueue.enqueue(conn, JobSpec(
        workspace_id=world["crown"], type="seam.render", idempotency_key=new_id(),
        needed_by=needed_by, zone_id=world["bar"], input_ref={"zone_id": world["bar"]}), now)
    conn.execute(sa.update(jobs).where(jobs.c.id == job.job.id).values(
        state=state, finished_at=finished_at))
    return job.job.id


@pytest.mark.invariants_off("job rows are set straight to their end states, with no worker")
def test_readiness_is_measured_from_the_kiosk_render_work(sqlite_engine, world, clock):  # noqa: F811
    clock.advance(4 * 3600)
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        _seam(conn, world, now - 600, now - 3600, finished_at=now - 1200)  # ready in time
        _seam(conn, world, now - 300, now - 3600, finished_at=now - 290)  # 10 s late
        _seam(conn, world, now - 100, now - 3600, state="failed", finished_at=now - 50)
        found = entitlement_jobs.transitions(conn, world["crown"], world["bar"], now - 86_400,
                                             now)
    assert sorted(t.ready for t in found) == [False, False, True]


@pytest.mark.invariants_off("job rows are set straight to their end states, with no worker")
def test_render_cpu_and_skipped_renders_are_charged_from_the_job_records(
    sqlite_engine, world, clock  # noqa: F811
):
    from selecta.work.schema import job_attempts

    clock.advance(4 * 3600)
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        done = _seam(conn, world, now + 600, now, finished_at=now)
        _seam(conn, world, now + 900, now, state="cancelled", finished_at=now)
        conn.execute(job_attempts.insert().values(
            id=new_id(), job_id=done, workspace_id=world["crown"], pool="cpu",
            lane="interactive", worker_id="w1", fencing_token=1, est_cost_s=20.0,
            cost_s=42.0, started_at=now - 60, lease_expires_at=now, deadline_at=now,
            ended_at=now, outcome="succeeded"))
        org = _org(conn, world)
        entitlement_gates.charge_renders(conn, org, now)
        used, _budget, skipped = ent.render_budget(conn, org, org.venue(world["camden"]),
                                                  world["bar"], now)
    assert used == 42.0 and skipped == 1


def test_the_cost_guard_reads_the_real_metered_month_and_never_silences(
    sqlite_engine, world, clock  # noqa: F811
):
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        conn.execute(ai_usage.insert().values(
            id=new_id(), workspace_id=world["crown"], month="2027-01", request_class="planning",
            turns=10, tokens_in=0, tokens_out=0, cache_read_tokens=0, cost_usd=127.0,
            updated_at=now))
        guard = entitlement_jobs.guard_cost(conn, _org(conn, world), now)
    assert guard is not None
    assert guard.cost_minor == pytest.approx(10_000, abs=2)  # 127 USD is 100 GBP
    assert guard.silence is False


def test_per_venue_storage_comes_from_the_upload_venue(sqlite_engine, world, clock):  # noqa: F811
    from selecta.storage.keys import original_key
    from selecta.storage.schema import assets

    with transaction(sqlite_engine, world["crown"]) as conn:
        for asset_id, venue_id, size in (("a1", world["camden"], 3000), ("a2", None, 1000)):
            conn.execute(assets.insert().values(
                id=asset_id, workspace_id=world["crown"],
                original_key=original_key(world["crown"], asset_id), size=size,
                sha256=asset_id * 32, format="mp3", created_at=1, venue_id=venue_id))
        split = entitlement_gates.storage_by_venue(conn, _org(conn, world), 4000)
        assert _own_venue(conn, world["crown"], world["camden"]) == world["camden"]
        assert _own_venue(conn, world["crown"], "someone-elses-venue") is None
    assert split == {world["camden"]: 3000, world["soho"]: 0, "": 1000}
