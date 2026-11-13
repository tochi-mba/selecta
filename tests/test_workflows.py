"""Security and reliability rules every GitHub Actions workflow in .github/workflows keeps.

actionlint (test.yml, Workflows / actionlint) checks syntax, expressions and shell scripts.
These are the house rules it doesn't know: SHA pins, least-privilege permissions, timeouts,
concurrency that never cancels main or deploy runs, no untrusted expression in a shell, and a
verify gate that waits for every job. tests/test_cloud_deploy_workflow.py covers deploy.yml's
own rules (OIDC, environments).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
FLOWS = {
    path.name: (path.read_text("utf-8"), yaml.safe_load(path.read_text("utf-8")))
    for path in sorted(WORKFLOWS.glob("*.yml"))
}
# Values a pull request's author controls; they may reach a step only through env.
UNTRUSTED = re.compile(
    r"\$\{\{[^}]*github\.(event\.(pull_request|issue|comment|review|head_commit|commits|pages)"
    r"|head_ref)"
)


def _triggers(flow: dict) -> dict:
    on = flow.get(True, flow.get("on"))  # PyYAML reads the bare key `on` as True
    return {on: None} if isinstance(on, str) else dict(on)


def _steps():
    for name, (_, flow) in FLOWS.items():
        for job_name, job in flow["jobs"].items():
            for step in job.get("steps") or []:
                yield f"{name}:{job_name}", step


def test_there_are_workflows_to_check():
    assert {"test.yml", "nightly.yml", "codeql.yml", "deploy.yml"} <= set(FLOWS)


def test_every_action_is_pinned_by_full_sha_with_a_version_comment():
    for name, (text, _) in FLOWS.items():
        for line in text.splitlines():
            match = re.search(r"uses:\s*(\S+)(.*)", line)
            if not match:
                continue
            assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", match[1]), f"{name}: {line}"
            assert re.search(r"#\s*v\d", match[2]), f"{name}: no version comment: {line}"


def test_top_level_permissions_are_none_or_read_only():
    for name, (_, flow) in FLOWS.items():
        top = flow.get("permissions")
        assert top is not None, f"{name} has no top-level permissions"
        assert top == {} or set(top.values()) <= {"read", "none"}, f"{name}: {top}"


def test_write_permissions_live_on_the_job_that_needs_them():
    allowed = {
        ("codeql.yml", "analyze"): {"security-events"},
        ("deploy.yml", "image"): {"packages"},
        ("deploy.yml", "staging"): {"id-token"},
        ("deploy.yml", "production"): {"id-token"},
        ("dependabot-auto-merge.yml", "auto-merge"): {"contents", "pull-requests"},
        ("nightly.yml", "report"): {"issues"},
    }
    for name, (_, flow) in FLOWS.items():
        for job_name, job in flow["jobs"].items():
            perms = job.get("permissions") or {}
            writes = {key for key, value in perms.items() if value == "write"}
            assert writes <= allowed.get((name, job_name), set()), f"{name}:{job_name} {writes}"


def test_oidc_is_only_used_by_deploy():
    for name, (text, _) in FLOWS.items():
        if name != "deploy.yml":
            assert "id-token" not in text, name


def test_no_pull_request_target_or_workflow_run_trigger():
    for name, (_, flow) in FLOWS.items():
        triggers = _triggers(flow)
        assert "pull_request_target" not in triggers and "workflow_run" not in triggers, name


def test_no_stored_secret_in_a_workflow_pull_requests_run():
    for name, (text, flow) in FLOWS.items():
        if "pull_request" in _triggers(flow):
            assert not re.search(r"\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)", text), name


def test_untrusted_values_reach_shells_only_through_env():
    for where, step in _steps():
        assert not UNTRUSTED.search(str(step.get("run", ""))), where


def test_checkouts_keep_no_credentials():
    for where, step in _steps():
        if str(step.get("uses", "")).startswith("actions/checkout@"):
            assert (step.get("with") or {}).get("persist-credentials") is False, where


def test_every_job_has_a_timeout():
    for name, (_, flow) in FLOWS.items():
        for job_name, job in flow["jobs"].items():
            assert isinstance(job.get("timeout-minutes"), int), f"{name}:{job_name}"


def test_concurrency_never_cancels_main_deploy_or_scheduled_runs():
    for name, (_, flow) in FLOWS.items():
        if name == "dependabot-auto-merge.yml":
            continue
        concurrency = flow.get("concurrency")
        assert concurrency, f"{name} has no concurrency group"
        cancel = concurrency["cancel-in-progress"]
        assert cancel is False or cancel == "${{ github.event_name == 'pull_request' }}", name
    assert FLOWS["deploy.yml"][1]["concurrency"]["cancel-in-progress"] is False


def test_uv_and_python_versions_match_the_repository():
    dockerfile = (WORKFLOWS.parents[1] / "infra" / "docker" / "service.Dockerfile").read_text(
        "utf-8")
    uv_version = re.search(r"uv==([\d.]+)", dockerfile)[1]
    python = (WORKFLOWS.parents[1] / ".python-version").read_text("utf-8").strip()
    for where, step in _steps():
        if str(step.get("uses", "")).startswith("astral-sh/setup-uv@"):
            options = step.get("with") or {}
            assert options.get("version") == uv_version, where
            assert options.get("python-version", python) == python, where


def test_verify_needs_every_other_test_job_and_checks_each_result():
    jobs = FLOWS["test.yml"][1]["jobs"]
    verify = jobs["verify"]
    assert verify["if"] == "${{ always() }}"
    assert set(verify["needs"]) == set(jobs) - {"verify"}
    script = verify["steps"][0]["run"]
    env = verify["steps"][0]["env"]
    for job in verify["needs"]:
        assert f"needs.{job}.result" in " ".join(env.values()), job
    assert 'test "$CHANGES_RESULT" = success' in script


def test_only_the_browser_jobs_can_be_skipped_and_only_on_a_docs_only_change():
    jobs = FLOWS["test.yml"][1]["jobs"]
    gated = {
        name for name, job in jobs.items()
        if "needs.changes.outputs.code" in str(job.get("if"))
    }
    assert gated == {"browser", "flags", "cloud-browser"}
    for name in gated:
        assert "changes" in jobs[name]["needs"]
    script = jobs["verify"]["steps"][0]["run"]
    assert '[ "$CODE_CHANGED" = false ] && [ "$gated" = skipped ]' in script
    assert "needs" not in jobs["service-image"]
