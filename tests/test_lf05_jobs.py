"""LF-0463 safety and failure-injection tests; no commercial audio needed."""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest

from selecta.lf_jobs.contract import (
    ExecutionRequest,
    JobKind,
    JobPriority,
    LocalSource,
    ZoneDemand,
    priority_for_legacy,
    validate_sources,
)
from selecta.lf_jobs.governor import (
    DeviceResources,
    LocalResourceGovernor,
    ReservationAlreadyHeld,
)
from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.model import JobState
from selecta.workers import local_host
from selecta.workers.runner import WorkerRunner


def resources(**changes):
    return replace(
        DeviceResources(
            cpu_percent=4, memory_available_mb=16_384, disk_free_mb=10_000,
            logical_cores=8, gpu_free_mb=2_048,
        ),
        **changes,
    )


def governor(tmp_path, snapshot=None, **options):
    return LocalResourceGovernor(
        tmp_path, sampler=lambda _home: snapshot or resources(), renew_s=0.5,
        lease_s=10.0, **options
    )


def job(kind="analyse.song", urgency=4, **extra):
    fields = dict(
        type=kind, base_urgency=urgency, lane="standard", scratch_mb=200,
        gpu_memory_mb=0,
    )
    fields.update(extra)
    return SimpleNamespace(**fields)


def request():
    return ExecutionRequest(
        operation_id="op", workspace_id="workspace", kind=JobKind.SEAM,
        source_revisions=(("recording", "r1"),), recipe_revision="mix-r7",
        algorithm_version="dsp-3", idempotency_key="mix-r7:recording:r1:dsp-3",
        priority=JobPriority.USER_EDITING, depends_on=("analysis-1",),
    )


def test_priority_classes_are_ordered_and_legacy_dsp_is_preserved():
    assert list(JobPriority) == [
        JobPriority.ACTIVE_PLAYBACK, JobPriority.IMMINENT_TRANSITION,
        JobPriority.NEAR_TERM_HORIZON, JobPriority.URGENT_REQUEST,
        JobPriority.USER_EDITING, JobPriority.ANALYSIS, JobPriority.SPECULATIVE,
    ]
    assert priority_for_legacy("seam.render", 0) == JobPriority.IMMINENT_TRANSITION
    assert priority_for_legacy("seam.render", 2) == JobPriority.NEAR_TERM_HORIZON
    assert priority_for_legacy("analyse.song", 4) == JobPriority.ANALYSIS
    assert priority_for_legacy("analyse.song", 1) == JobPriority.USER_EDITING


@pytest.mark.parametrize("pressure", [
    {"cpu_percent": 99},
    {"memory_available_mb": 127},
    {"disk_free_mb": 100},
    {"thermal_warning": True},
    {"on_low_battery": True},
])
def test_exhaustion_defers_analysis_without_claiming_success(tmp_path, pressure):
    gate = governor(tmp_path, resources(**pressure))
    assert gate.reserve(job(), "attempt") is None
    assert gate.reserve(job("seam.render", 4), "seam") is None


def test_unknown_gpu_capacity_does_not_guess(tmp_path):
    gate = governor(tmp_path, resources(gpu_free_mb=None))
    assert gate.reserve(job(gpu_memory_mb=256), "stem") is None


def test_real_output_deadlines_protect_speaker_and_preempt_background(tmp_path):
    now = [100.0]
    gate = LocalResourceGovernor(
        tmp_path, sampler=lambda _: resources(), clock=lambda: now[0],
        lease_s=10, renew_s=0.5,
    )
    background = gate.reserve(job(), "background")
    assert background is not None
    gate.observe_zone(ZoneDemand("stage-left", True, deadline_at=101.0))
    assert background.should_yield()
    assert gate.reserve(job(), "next-analysis") is None
    # Preparing the imminent seam is preferred over any speculative analysis.
    urgent = gate.reserve(job("seam.render", 0), "next-seam")
    assert urgent is not None
    urgent.close()
    background.close()
    gate.observe_zone(ZoneDemand("stage-left", False))
    resumed = gate.reserve(job(), "resumed")
    assert resumed is not None
    resumed.close()


def test_imminent_transition_can_use_last_spare_core(tmp_path):
    gate = governor(tmp_path, resources(logical_cores=2))
    gate.observe_zone(ZoneDemand("output-a", True, deadline_at=10**12))
    assert gate.reserve(job(), "background") is None
    seam = gate.reserve(job("seam.render", 0), "urgent-prep")
    assert seam is not None
    seam.close()


def test_one_core_with_live_audio_blocks_background_and_imminent_dsp(tmp_path):
    gate = governor(tmp_path, resources(logical_cores=1))
    gate.observe_zone(ZoneDemand("output-a", True, deadline_at=10**12))
    assert gate.reserve(job(), "background") is None
    assert gate.reserve(job("seam.render", 0), "urgent-prep") is None


def test_five_active_zones_reserve_cpu_and_bound_workers(tmp_path):
    gate = governor(tmp_path)
    for index in range(5):
        gate.observe_zone(ZoneDemand(f"zone-{index}", True, deadline_at=10**12))
    first = gate.reserve(job(), "a")
    second = gate.reserve(job(), "b")
    assert first is not None and second is not None
    assert gate.reserve(job(), "c") is None
    second.close()
    first.close()


def test_multiple_engines_share_one_atomic_capacity_ledger(tmp_path):
    first = governor(tmp_path, max_heavy_workers=1)
    second = governor(tmp_path, max_heavy_workers=1)
    one = first.reserve(job(), "first")
    assert one is not None
    assert second.reserve(job(), "second") is None
    one.close()
    two = second.reserve(job(), "second")
    assert two is not None
    two.close()


def test_duplicate_delivery_of_one_attempt_cannot_run_twice(tmp_path):
    gate = governor(tmp_path)
    one = gate.reserve(job(), "op:attempt-7")
    assert one is not None
    with pytest.raises(ReservationAlreadyHeld):
        gate.reserve(job(), "op:attempt-7")
    one.close()
    next_attempt = gate.reserve(job(), "op:attempt-8")
    assert next_attempt is not None
    next_attempt.close()


def test_crash_lease_expiry_and_old_release_cannot_erase_new_attempt(tmp_path):
    now = [10.0]
    gate = LocalResourceGovernor(
        tmp_path, sampler=lambda _: resources(), clock=lambda: now[0],
        max_heavy_workers=1, lease_s=10, renew_s=5,
    )
    crashed = gate.reserve(job(), "old")
    assert crashed is not None
    now[0] = 25.0
    resumed = gate.reserve(job(), "new")
    assert resumed is not None
    crashed.close()  # a late stale process cannot release the new reservation
    assert gate.reserve(job(), "third") is None
    resumed.close()


def test_pressure_interrupts_a_running_background_handler(tmp_path):
    samples = [resources()]
    gate = LocalResourceGovernor(
        tmp_path, sampler=lambda _: samples[0], lease_s=30, renew_s=5,
    )
    permit = gate.reserve(job(), "work")
    assert permit is not None
    samples[0] = resources(cpu_percent=98)
    assert permit.should_yield()
    permit.close()


def test_local_source_revision_permissions_and_missing_drive_are_checked(tmp_path):
    recording = tmp_path / "synthetic.wav"
    recording.write_bytes(b"not-an-audio-decode-test")
    req = request()

    def resolve(_recording, _revision):
        return LocalSource("recording", "r1", recording, True, True)

    assert validate_sources(req, resolve)[0].path == recording
    with pytest.raises(ValueError, match="unavailable"):
        validate_sources(req, lambda *_: replace(resolve("", ""), authorised=False))
    with pytest.raises(ValueError, match="unavailable"):
        validate_sources(req, lambda *_: replace(resolve("", ""), content_revision="r2"))
    recording.unlink()
    with pytest.raises(ValueError, match="unavailable"):
        validate_sources(req, resolve)


def test_typed_contract_rejects_invalid_dependencies_and_negative_resources():
    with pytest.raises(ValueError, match="Duplicate"):
        replace(request(), depends_on=("x", "x"))
    with pytest.raises(ValueError, match="non-negative"):
        replace(request(), scratch_mb=-1)


def test_local_job_policy_is_identical_across_paid_tiers():
    policy = local_host.local_policy()
    for tier in ("free", "standard", "premium"):
        assert policy.enforce_speculative_budget is False
        assert policy.lane_caps[tier] == policy.lane_caps["free"]
        assert policy.tier_weights[tier] == 1.0


def test_crashed_decoder_is_not_published_as_success(tmp_path):
    store = local_host.open_store(tmp_path)
    caps = WorkerCaps(
        pool="local-analysis", worker_id="decoder", job_types=frozenset({"analyse.song"})
    )
    store.register_worker(caps)
    made = store.enqueue(JobSpec(
        "local", "analyse.song", input_ref={"song": 1}, pool="local-analysis"
    ))

    def crash(_job, _ctx):
        raise RuntimeError("decoder subprocess crashed")

    runner = WorkerRunner(
        store, caps, {"analyse.song": crash}, heartbeat_s=1,
        resource_governor=governor(tmp_path),
    )
    result = runner.run_once()
    assert result is not None and result.outcome != "succeeded"
    assert store.job(made.job.id).state != JobState.SUCCEEDED


def test_cancellation_cannot_publish_stale_result(tmp_path):
    store = local_host.open_store(tmp_path)
    caps = WorkerCaps(pool="local-analysis", worker_id="cancel-test",
                      job_types=frozenset({"analyse.song"}))
    store.register_worker(caps)
    made = store.enqueue(JobSpec(
        "local", "analyse.song", input_ref={"song": 2}, pool="local-analysis"
    ))

    def interrupted(_job, ctx):
        store.cancel("local", _job.id)
        ctx.signals.cancel.set()
        ctx.check_in()
        return {"should_never_publish": True}

    runner = WorkerRunner(
        store, caps, {"analyse.song": interrupted}, heartbeat_s=1,
        resource_governor=governor(tmp_path),
    )
    runner.run_once()
    assert store.job(made.job.id).state == JobState.CANCELLED


def test_export_dependencies_remain_durable(tmp_path):
    store = local_host.open_store(tmp_path)
    seam = store.enqueue(JobSpec("local", "seam.render", input_ref={"x": 1})).job
    export = store.enqueue(JobSpec(
        "local", "export.render", input_ref={"revision": "r1"},
        depends_on=(seam.id,),
    )).job
    assert store.job(export.id).state == JobState.WAITING_DEPS
    assert store.job(seam.id).state == JobState.QUEUED
    store.cancel("local", seam.id)
    assert store.job(export.id).state == JobState.BLOCKED
