"""Queued work for a feature switched off drains or stops, and comes back by itself (SC-0414-04).

Everything goes through the real claim path (`JobStore.claim`) on SQLite and PostgreSQL: a
queued job whose flag is off is blocked (`when_off: drain`) or cancelled (`when_off: stop`), and
a blocked one is back in line on a later claim once the flag is on again.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import Flags, drift, head, make_store, outbox, worker

from selecta.persistence import transaction
from selecta.work import flag_gates
from selecta.work.enqueue import JobSpec
from selecta.work.holds import hold_for_staff
from selecta.work.schema import jobs

FLAG = "core.analysis"


@pytest.fixture
def gate():
    return Flags()


@pytest.fixture
def store(cloud_engine, gate):
    made = make_store(cloud_engine, flags=gate)
    made.flag_resume_s = 0.0
    return made


@pytest.fixture
def stops(monkeypatch):
    """Make the test flag a `when_off: stop` flag."""
    real = flag_gates.when_off
    def when_off(flag_id):
        return flag_gates.STOP if flag_id == FLAG else real(flag_id)

    monkeypatch.setattr(flag_gates, "when_off", when_off)


def row(store, job_id):
    with transaction(store.engine) as connection:
        return connection.execute(sa.select(jobs).where(jobs.c.id == job_id)).one()


def test_a_draining_feature_blocks_its_queued_jobs_and_frees_their_place_in_line(store, gate):
    first = store.enqueue(JobSpec("w1", "analyse.song")).job
    second = store.enqueue(JobSpec("w1", "analyse.song")).job
    gate.off.add(("w1", FLAG))

    assert store.claim("cpu-heavy", worker()) is None

    for job in (first, second):
        found = row(store, job.id)
        assert (found.state, found.error_class) == ("blocked", "flag_off")
    assert head(store, "w1").queued_count == 0
    assert drift(store) == []
    assert ("job.blocked", "flag_off") in {(t, p.get("reason")) for t, p in outbox(store)}


def test_blocked_jobs_go_back_in_line_by_themselves_when_the_flag_returns(store, gate):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    gate.off.add(("w1", FLAG))
    assert store.claim("cpu-heavy", worker()) is None
    assert store.claim("cpu-heavy", worker()) is None, "still off: it stays blocked"
    assert row(store, job.id).state == "blocked"

    gate.off.remove(("w1", FLAG))
    claimed = store.claim("cpu-heavy", worker())

    assert claimed is not None and claimed.job.id == job.id
    assert row(store, job.id).error_class is None
    assert drift(store) == []


def test_a_stopping_feature_cancels_its_queued_jobs_and_blocks_what_waits_on_them(
    store, gate, stops
):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    waiting = store.enqueue(JobSpec("w1", "seam.render", depends_on=(job.id,))).job
    gate.off.add(("w1", FLAG))

    assert store.claim("cpu-heavy", worker()) is None

    assert (row(store, job.id).state, row(store, job.id).error_class) == ("cancelled", "flag_off")
    assert row(store, waiting.id).state == "blocked"
    gate.off.remove(("w1", FLAG))
    assert store.claim("cpu-heavy", worker()) is None, "a cancelled job never comes back"
    assert row(store, job.id).state == "cancelled"
    assert drift(store) == []


def test_only_the_switched_off_workspace_is_affected(store, gate):
    mine = store.enqueue(JobSpec("w1", "analyse.song")).job
    theirs = store.enqueue(JobSpec("w2", "analyse.song")).job
    gate.off.add(("w1", FLAG))

    claimed = store.claim("cpu-heavy", worker())

    assert claimed.job.id == theirs.id
    assert row(store, mine.id).state == "blocked"


def test_a_staff_hold_is_never_released_by_a_flag_coming_back(store, gate):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    with transaction(store.engine) as connection:
        hold_for_staff(connection, job.id, 1.0)
    gate.off.add(("w1", FLAG))
    store.claim("cpu-heavy", worker())
    gate.off.remove(("w1", FLAG))
    assert store.claim("cpu-heavy", worker()) is None
    assert (row(store, job.id).state, row(store, job.id).error_class) == ("blocked", "staff_hold")


def test_the_resume_check_runs_at_most_every_flag_resume_s(store, gate):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    store.flag_resume_s = 3_600.0
    gate.off.add(("w1", FLAG))
    assert store.claim("cpu-heavy", worker()) is None
    gate.off.remove(("w1", FLAG))
    assert store.claim("cpu-heavy", worker()) is None, "not due yet"
    store._flag_resume_at.clear()
    assert store.claim("cpu-heavy", worker()).job.id == job.id


def test_an_unknown_flag_drains_rather_than_stops():
    assert flag_gates.when_off("no.such.flag") == flag_gates.DRAIN
    assert flag_gates.when_off(None) == flag_gates.DRAIN
    assert flag_gates.when_off(FLAG) == "drain"
