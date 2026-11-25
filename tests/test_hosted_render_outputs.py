"""Hosted jobs declare where a remote worker may write.

The worker gateway signs an upload slot only inside the namespace a job declares in
`input_ref["output"]` (`work.cloud_ports.signed_outputs`). The dev worker publishes locally and
never asks, so a job without the declaration passes every local run and then fails on staging with
"invalid_output_slots". Found on staging on 2026-11-25 with the first real Modal worker.
"""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

from selecta import hosted_render
from selecta.config import ANALYSIS_VERSION
from selecta.scheduling.policy import Lane
from selecta.seam_kinds import RENDER_VERSION
from selecta.storage.keys import derived_key
from selecta.work import cloud_ports
from selecta.workers.engine_handlers import EXPORT_VERSION

WORKSPACE = "01a205d4-722d-771c-954e-7b4c1e314a78"
ATTEMPT = "01a21347-8e23-7956-98a0-4c8f82098ea7"
A = {"id": "01a21347-0000-7000-8000-00000000000a", "sha256": "a" * 64, "display_name": "X - One"}
B = {"id": "01a21347-0000-7000-8000-00000000000b", "sha256": "b" * 64, "display_name": "Y - Two"}


def _worker_hash(payload: dict) -> str:
    # engine_handlers._hash, written out so a change on either side fails here.
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _prefix(spec) -> str:
    job = SimpleNamespace(workspace_id=spec.workspace_id, input_ref=spec.input_ref)
    prefix = cloud_ports.output_prefix(job, ATTEMPT)
    assert prefix, "the job declares no output namespace, so the gateway would refuse its upload"
    return prefix


def test_an_analysis_job_declares_the_namespace_the_worker_publishes_into():
    spec = hosted_render._analysis_spec(WORKSPACE, A, None)
    published = _worker_hash({"source_sha256": A["sha256"], "analysis": ANALYSIS_VERSION})
    assert spec.input_ref["output"] == {"kind": "analysis", "input_hash": published}
    key = derived_key(WORKSPACE, "analysis", published, ATTEMPT, "analysis.npz")
    assert key.startswith(_prefix(spec))


def test_a_transition_job_declares_the_namespace_the_worker_publishes_into():
    a = A | {"analysis_key": f"w/{WORKSPACE}/analysis/{'c' * 64}/attempts/{ATTEMPT}/analysis.npz"}
    b = B | {"analysis_key": f"w/{WORKSPACE}/analysis/{'d' * 64}/attempts/{ATTEMPT}/analysis.npz"}
    spec = hosted_render._seam_spec(WORKSPACE, a, b, "echo_out", Lane.STANDARD, None)
    published = _worker_hash({"a": A["sha256"], "b": B["sha256"], "style": "echo_out",
                              "analysis": ANALYSIS_VERSION, "render": RENDER_VERSION})
    assert spec.input_ref["output"] == {"kind": "seam", "input_hash": published}
    assert derived_key(WORKSPACE, "seam", published, ATTEMPT, "seam.flac").startswith(_prefix(spec))


def test_the_export_hash_is_the_one_the_export_worker_publishes_under():
    shas = [A["sha256"], B["sha256"]]
    published = _worker_hash({"songs": shas, "analysis": ANALYSIS_VERSION,
                              "render": RENDER_VERSION, "export": EXPORT_VERSION})
    assert hosted_render.export_hash(shas) == published
