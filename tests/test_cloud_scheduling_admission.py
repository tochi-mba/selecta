"""Admission control under overload (docs/saas/18-test-plan.md §18.6, SC-0395)."""

from __future__ import annotations

import math

import pytest
from test_cloud_jobs_support import Plans, make_store, worker

from selecta.scheduling import admission
from selecta.scheduling.admission import SpeculativeLedger, Verdict
from selecta.scheduling.policy import Lane, PolicyConfig
from selecta.work.enqueue import JobSpec

CONFIG = PolicyConfig()
DAY = 86_400.0


def admit(**values):
    values.setdefault("job_type", "analyse.song")
    values.setdefault("lane", Lane.STANDARD)
    values.setdefault("tier", "free")
    values.setdefault("queued_of_type", 0)
    values.setdefault("backlog_drain_s", 0.0)
    return admission.admit(CONFIG, **values)


# --- Queued caps and pages ---------------------------------------------------------------------


def test_work_under_its_type_cap_is_accepted():
    decision = admit(queued_of_type=1_999, job_type="seam.render")
    assert decision.verdict == Verdict.ACCEPT
    assert decision.creates_job is True


def test_work_at_its_type_cap_is_kept_as_planned_instead_of_created():
    seams = admit(queued_of_type=2_000, job_type="seam.render")
    analyses = admit(queued_of_type=50_000)
    assert seams.verdict == analyses.verdict == Verdict.PLAN
    assert seams.creates_job is False
    assert "2000 seam.render" in seams.reason
    assert admit(queued_of_type=49_999).verdict == Verdict.ACCEPT


def test_a_big_import_materialises_in_pages_of_five_hundred():
    assert admission.next_page(CONFIG, job_type="analyse.song", outstanding=0,
                               remaining=20_000, queued_of_type=0) == 500


def test_the_next_page_appears_only_once_the_previous_has_half_drained():
    page = dict(job_type="analyse.song", remaining=19_500, queued_of_type=0)
    assert admission.next_page(CONFIG, outstanding=500, **page) == 0
    assert admission.next_page(CONFIG, outstanding=251, **page) == 0
    assert admission.next_page(CONFIG, outstanding=250, **page) == 500


def test_the_last_page_is_only_what_remains_and_never_passes_the_type_cap():
    assert admission.next_page(CONFIG, job_type="analyse.song", outstanding=0, remaining=120,
                               queued_of_type=0) == 120
    assert admission.next_page(CONFIG, job_type="seam.render", outstanding=0, remaining=900,
                               queued_of_type=1_800) == 200
    assert admission.next_page(CONFIG, job_type="seam.render", outstanding=0, remaining=900,
                               queued_of_type=2_100) == 0
    assert admission.next_page(CONFIG, job_type="seam.render", outstanding=0, remaining=0,
                               queued_of_type=0) == 0


# --- Speculative budget -------------------------------------------------------------------------


@pytest.mark.parametrize(("tier", "minutes"), [("free", 10), ("standard", 60), ("premium", 240)])
def test_each_plan_has_a_daily_speculative_budget(tier, minutes):
    spent = minutes * 60.0
    assert admission.speculative_left_s(CONFIG, tier, 0.0) == spent
    assert admit(lane=Lane.SPECULATIVE, tier=tier, speculative_used_s=spent - 1).verdict == (
        Verdict.ACCEPT
    )
    refused = admit(lane=Lane.SPECULATIVE, tier=tier, speculative_used_s=spent)
    assert refused.verdict == Verdict.REFUSE
    assert refused.creates_job is False


def test_negative_spend_counts_as_none_and_overspend_leaves_nothing():
    assert admission.speculative_left_s(CONFIG, "free", -50.0) == 600.0
    assert admission.speculative_left_s(CONFIG, "free", 10_000.0) == 0.0


def test_the_speculative_ledger_resets_at_midnight():
    ledger = SpeculativeLedger(CONFIG)
    late = DAY - 10.0
    ledger.spend("w1", 590.0, late)
    ledger.spend("w1", -30.0, late)
    assert ledger.used("w1", late) == 590.0
    assert ledger.left("w1", "free", late) == 10.0
    assert ledger.used("w1", DAY) == 0.0
    assert ledger.left("w1", "free", DAY) == 600.0
    assert ledger.left("w2", "premium", late) == 240 * 60.0


# --- Overload -----------------------------------------------------------------------------------


def test_drain_time_is_queued_work_over_slots():
    assert admission.drain_seconds(0.0, 10) == 0.0
    assert admission.drain_seconds(-5.0, 10) == 0.0
    assert admission.drain_seconds(600.0, 10) == 60.0
    assert admission.drain_seconds(600.0, 0) == math.inf


def test_overload_defers_free_standard_work_for_a_bounded_time():
    deferred = admit(backlog_drain_s=CONFIG.overload_drain_s + 100.0)
    assert deferred.verdict == Verdict.DEFER
    assert deferred.defer_s == 100.0
    assert deferred.creates_job is True
    longest = admit(backlog_drain_s=CONFIG.overload_drain_s + 100_000.0)
    assert longest.defer_s == CONFIG.max_defer_s
    unknown_plan = admit(tier=None, backlog_drain_s=CONFIG.overload_drain_s + 1.0)
    assert unknown_plan.verdict == Verdict.DEFER


def test_overload_never_defers_interactive_work_or_paying_plans():
    overloaded = CONFIG.overload_drain_s * 10
    assert admit(lane=Lane.INTERACTIVE, backlog_drain_s=overloaded).verdict == Verdict.ACCEPT
    assert admit(tier="standard", backlog_drain_s=overloaded).verdict == Verdict.ACCEPT
    assert admit(tier="premium", backlog_drain_s=overloaded).verdict == Verdict.ACCEPT
    assert admit(backlog_drain_s=CONFIG.overload_drain_s).verdict == Verdict.ACCEPT


def test_admission_never_drops_accepted_work():
    """Every verdict but a spent speculative budget keeps the work, now or later."""
    overloaded = CONFIG.overload_drain_s * 10
    for lane in (Lane.INTERACTIVE, Lane.STANDARD):
        for tier in ("free", "standard", "premium"):
            for queued in (0, 60_000):
                decision = admit(lane=lane, tier=tier, queued_of_type=queued,
                                 backlog_drain_s=overloaded)
                assert decision.verdict != Verdict.REFUSE


# --- The store reads the numbers ----------------------------------------------------------------


def test_the_store_counts_unstarted_jobs_of_the_type_against_the_cap(cloud_engine):
    store = make_store(cloud_engine, PolicyConfig(queued_caps={"analyse.song": 2}))
    spec = JobSpec("w1", "analyse.song")
    assert store.admit(spec).verdict == Verdict.ACCEPT
    store.enqueue(spec)
    store.enqueue(JobSpec("w2", "analyse.song"))
    assert store.admit(spec).verdict == Verdict.ACCEPT
    store.enqueue(spec)
    assert store.admit(spec).verdict == Verdict.PLAN


def test_the_store_defers_free_standard_work_when_a_pool_is_backlogged(cloud_engine):
    plans = Plans(default="free")
    store = make_store(cloud_engine, PolicyConfig(overload_drain_s=100.0), entitlements=plans)
    for _ in range(4):
        store.enqueue(JobSpec("w1", "analyse.song", est_cost_s=40.0))
    assert store.admit(JobSpec("w2", "analyse.song")).verdict == Verdict.DEFER
    assert store.admit(JobSpec("w2", "analyse.song", lane="interactive")).verdict == (
        Verdict.ACCEPT
    )
    store.register_worker(worker(slots=2))
    assert store.admit(JobSpec("w2", "analyse.song")).verdict == Verdict.ACCEPT


def test_the_store_refuses_speculative_work_once_today_budget_is_spent(sqlite_engine, clock):
    store = make_store(sqlite_engine, PolicyConfig(
        speculative_budget_cpu_min={"free": 1.0, "standard": 60.0, "premium": 1.0}
    ))
    clock.now = 100 * DAY + 3_600.0
    sweep = JobSpec("w1", "discover.sweep")
    store.enqueue(sweep)
    claim = store.claim("cpu-heavy", worker())
    assert claim is not None and claim.job.lane == "speculative"
    clock.advance(30.0)
    assert store.admit(sweep).verdict == Verdict.ACCEPT
    clock.advance(40.0)
    assert store.admit(sweep).verdict == Verdict.REFUSE
    store.complete(claim.attempt_id, claim.fencing_token, cost_s=70.0)
    assert store.admit(sweep).verdict == Verdict.REFUSE
    clock.advance(1.0)
    assert store.admit(sweep, day_start=clock.now).verdict == Verdict.ACCEPT
    clock.now = 101 * DAY
    assert store.admit(sweep).verdict == Verdict.ACCEPT
