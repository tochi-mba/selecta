"""Bytes uploaded per job type, for the egress cost line (ADR-0396 SC-0396-07).

`selecta.work.egress` sums published artifact sizes by the job type that made them and compares
the averages with `infra/workers/egress_model.json`. The model's numbers come from the Phase 0
real-audio benchmark and the staging metrics, which are separate.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from test_cloud_jobs_support import make_store, output, worker

from selecta.persistence import new_id, transaction
from selecta.storage.keys import derived_key
from selecta.work import catalogue, egress
from selecta.work.egress import Measured
from selecta.work.enqueue import JobSpec

MODEL = Path(__file__).resolve().parents[1] / "infra" / "workers" / "egress_model.json"


def finish(store, workspace: str, key: str, size: int, input_hash: str) -> None:
    store.enqueue(JobSpec(workspace, "analyse.song", idempotency_key=key))
    claim = store.claim("cpu-heavy", worker())
    key = derived_key(workspace, "analysis", input_hash, claim.attempt_id, "features.npz")
    store.complete(claim.attempt_id, claim.fencing_token,
                   artifacts=[replace(output(input_hash), keys=[key], size_bytes=size)])


def test_bytes_are_summed_per_job_type_from_published_artifacts(cloud_engine):
    store = make_store(cloud_engine)
    finish(store, new_id(), "a", 1_000, "a" * 64)
    finish(store, new_id(), "b", 3_000, "b" * 64)
    with transaction(cloud_engine) as connection:
        found = egress.uploaded_bytes(connection, 0.0, 1e12)
        none_yet = egress.uploaded_bytes(connection, 0.0, 1.0)
    assert found == {"analyse.song": Measured("analyse.song", 2, 4_000)}
    assert found["analyse.song"].bytes_per_job == 2_000
    assert none_yet == {}


def test_measurements_are_compared_with_the_model_within_a_quarter():
    measured = {
        "analyse.song": Measured("analyse.song", 2, 4_000),
        "play.proxy": Measured("play.proxy", 1, 50_000),
        "seam.render": Measured("seam.render", 1, 10),
    }
    model = {"analyse.song": 1_800.0, "play.proxy": 30_000.0, "seam.render": None}
    mismatches = egress.compare(measured, model)
    assert [(m.job_type, m.modelled) for m in mismatches] == [
        ("play.proxy", 30_000.0), ("seam.render", None)
    ]


def test_the_model_names_every_job_type_that_uploads():
    model = egress.load_model(MODEL)
    uploading = {name for name, kind in catalogue.CATALOGUE.items()
                 if kind.pool != catalogue.INTERNAL}
    assert set(model) == uploading
