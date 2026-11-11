"""The deploy workflow's safety rules (SC-0409-03, ADR-0409).

Main deploys to staging; production needs the protected environment's approval; credentials
come only from OIDC; pull requests can't run it; every job has least-privilege permissions.
actionlint checks the syntax in CI (test.yml, Workflows / actionlint).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy.yml"
TEXT = WORKFLOW.read_text("utf-8")
FLOW = yaml.safe_load(TEXT)
TRIGGERS = FLOW[True]  # PyYAML reads the bare key `on` as True
JOBS = FLOW["jobs"]


def test_only_a_push_to_main_or_a_manual_run_triggers_it():
    assert set(TRIGGERS) == {"push", "workflow_dispatch"}
    assert TRIGGERS["push"] == {"branches": ["main"]}
    assert "pull_request" not in TEXT.replace("!= 'pull_request'", "")
    assert "pull_request_target" not in TEXT and "workflow_run" not in TEXT
    assert "refs/heads/main" in JOBS["image"]["if"]


def test_permissions_default_to_none_and_each_job_asks_for_the_least():
    assert FLOW["permissions"] == {}
    assert JOBS["image"]["permissions"] == {"contents": "read", "packages": "write"}
    for name in ("staging", "production"):
        assert JOBS[name]["permissions"] == {"contents": "read", "id-token": "write"}


def test_staging_follows_the_image_and_production_waits_for_staging_and_approval():
    assert JOBS["staging"]["needs"] == "image"
    assert set(JOBS["production"]["needs"]) == {"image", "staging"}
    assert JOBS["staging"]["environment"]["name"] == "staging"
    assert JOBS["production"]["environment"]["name"] == "production"
    assert FLOW["concurrency"]["cancel-in-progress"] is False


def test_no_stored_secret_is_used_only_oidc_and_the_ephemeral_job_token():
    assert "secrets." not in TEXT
    for name in ("staging", "production"):
        runs = " ".join(step.get("run", "") for step in JOBS[name]["steps"])
        assert f"oidc_credentials.sh {name}" in runs
        ordered = [step.get("run", "") for step in JOBS[name]["steps"]]
        oidc = next(i for i, run in enumerate(ordered) if "oidc_credentials" in run)
        deploy = next(i for i, run in enumerate(ordered) if "release.sh" in run)
        assert oidc < deploy


def test_checkouts_keep_no_credentials_and_actions_are_pinned_by_sha():
    for job in JOBS.values():
        for step in job["steps"]:
            uses = step.get("uses")
            if uses:
                assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", uses), uses
            if uses and uses.startswith("actions/checkout"):
                assert step["with"]["persist-credentials"] is False


def test_untrusted_values_never_reach_a_shell_through_an_expression():
    for job in JOBS.values():
        for step in job["steps"]:
            assert "${{" not in step.get("run", ""), step.get("name")


def test_every_job_has_a_timeout_and_a_smoke_test_follows_each_deploy():
    for name, job in JOBS.items():
        assert job["timeout-minutes"] <= 30, name
    for name in ("staging", "production"):
        assert "smoke.py" in JOBS[name]["steps"][-1]["run"]


def test_the_oidc_script_masks_values_and_refuses_long_lived_credentials():
    script = (ROOT / "infra" / "deploy" / "oidc_credentials.sh").read_text("utf-8")
    assert script.count("::add-mask::") >= 2
    assert '-gt 3600' in script
    assert "set -euo pipefail" in script
    release = (ROOT / "infra" / "deploy" / "release.sh").read_text("utf-8")
    assert "selecta db upgrade" in release and release.index("db upgrade") < release.index(
        "Render services")
