"""A workflow job only asks setup-node to cache a package store it actually fills.

setup-node saves the pnpm or npm store in a post step. In a job that never installs (the
nightly `pnpm audit` only reads the lockfile), the store doesn't exist and that post step
fails the job even though every real step passed.
"""

from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
INSTALLS = ("pnpm install", "npm ci", "npm install", "yarn install")


def _jobs():
    for path in sorted(WORKFLOWS.glob("*.yml")):
        flow = yaml.safe_load(path.read_text("utf-8"))
        for name, job in (flow.get("jobs") or {}).items():
            yield f"{path.name}:{name}", job.get("steps") or []


def test_every_job_that_caches_a_node_store_installs_into_it():
    checked = 0
    for job, steps in _jobs():
        cached = [
            step
            for step in steps
            if str(step.get("uses", "")).startswith("actions/setup-node@")
            and (step.get("with") or {}).get("cache")
        ]
        if not cached:
            continue
        checked += 1
        runs = " ".join(str(step.get("run", "")) for step in steps)
        assert any(command in runs for command in INSTALLS), job
    assert checked, "no job caches a node store, so this test checks nothing"


def test_the_nightly_web_audit_installs_nothing_and_caches_nothing():
    flow = yaml.safe_load((WORKFLOWS / "nightly.yml").read_text("utf-8"))
    steps = flow["jobs"]["web-dependencies"]["steps"]
    runs = " ".join(str(step.get("run", "")) for step in steps)
    assert "pnpm audit" in runs
    assert not any(command in runs for command in INSTALLS)
    for step in steps:
        if str(step.get("uses", "")).startswith("actions/setup-node@"):
            assert "cache" not in (step.get("with") or {})
