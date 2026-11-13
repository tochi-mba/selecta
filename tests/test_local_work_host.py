"""The local durable job host, the first slice of SC-0394-04 (ADR-0394).

Local work goes through the same fenced store as Cloud, in a job database of the home's own, and
survives the app stopping: a job left queued, or running when the app died, runs on the next start.
"""

from __future__ import annotations

import threading

from selecta import flags
from selecta.work.model import JobState
from selecta.workers import local_host

WAIT = 20.0


def wait_for(check, timeout: float = WAIT) -> bool:
    done = threading.Event()
    for _ in range(int(timeout / 0.02)):
        if check():
            return True
        done.wait(0.02)
    return check()


def test_the_flag_is_off_by_default_so_the_local_app_is_unchanged():
    assert not flags.on(local_host.FLAG)


def test_a_job_runs_through_the_home_job_database(tmp_path):
    host = local_host.open_local_work(tmp_path, {"analyse.song": lambda job, ctx: {"bpm": 124}},
                                      heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05)
    assert (tmp_path / local_host.DATABASE).exists()
    host.start()
    try:
        job = host.enqueue("analyse.song", input_ref={"song": 1}).job
        assert job.workspace_id == local_host.LOCAL_WORKSPACE
        assert wait_for(lambda: host.store.job(job.id).state == JobState.SUCCEEDED)
    finally:
        assert host.stop(timeout=WAIT)


def test_work_queued_before_a_stop_runs_after_the_next_start(tmp_path):
    first = local_host.open_local_work(tmp_path, {}, idle_s=0.02)
    job = first.enqueue("analyse.song", input_ref={"song": 2}).job
    first.store.engine.dispose()

    ran = []
    second = local_host.open_local_work(
        tmp_path, {"analyse.song": lambda job, ctx: ran.append(job.id) or {"bpm": 90}},
        heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05,
    )
    second.start()
    try:
        assert wait_for(lambda: second.store.job(job.id).state == JobState.SUCCEEDED)
        assert ran == [job.id]
    finally:
        assert second.stop(timeout=WAIT)


def test_a_job_whose_app_died_mid_run_is_reaped_and_run_again(tmp_path, clock):
    crashed = local_host.open_local_work(tmp_path, {})
    job = crashed.enqueue("analyse.song", input_ref={"song": 3}).job
    runner = crashed.runners[0].runners[0]
    crashed.store.register_worker(runner.caps)
    claim = crashed.store.claim("cpu-heavy", runner.caps)
    assert claim is not None and claim.job.id == job.id
    crashed.store.start(claim.attempt_id, claim.fencing_token)
    crashed.store.engine.dispose()  # the app died without finishing or releasing

    clock.advance(3_600)
    again = local_host.open_local_work(tmp_path, {"analyse.song": lambda job, ctx: {"bpm": 100}},
                                       heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05)
    again.start()
    try:
        assert wait_for(lambda: again.store.job(job.id).state == JobState.SUCCEEDED)
        assert again.store.job(job.id).attempt_count == 2
    finally:
        assert again.stop(timeout=WAIT)
