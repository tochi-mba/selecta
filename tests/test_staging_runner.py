"""The one-command staging runner and its README (infra/staging; SC-0404-06, SC-0407-04,
SC-0409-01, SC-0409-04, SC-0411-04, SC-0411-05, SC-0412-03, SC-0416-06).

Every task's scripts exist, its README row names every input, a missing input or a URL that
isn't staging stops it before anything runs, and the commands run in order and stop at the
first failure. Nothing here touches the network.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("staging_run", ROOT / "infra/staging/run.py")
staging = importlib.util.module_from_spec(spec)
sys.modules["staging_run"] = staging
spec.loader.exec_module(staging)
README = (ROOT / "infra/staging/README.md").read_text("utf-8")


def full_env(task) -> dict[str, str]:
    env = {name: f"https://api.staging.example/{name.lower()}" for name in task.needs}
    if "LEVEL" in env:
        env["LEVEL"] = "L2"
    return env


@pytest.mark.parametrize("name", sorted(staging.TASKS))
def test_every_task_runs_files_that_exist_and_its_readme_row_names_every_input(name):
    task = staging.TASKS[name]
    row = next(line for line in README.splitlines() if line.startswith(f"| `{name}` |"))
    for variable in task.needs + task.optional:
        assert f"`{variable}`" in row, (name, variable)
    for checklist_id in task.tasks:
        assert checklist_id in row
    for command in task.commands(full_env(task), "reports/x"):
        for part in command:
            if re.search(r"\.(py|js|sh)$", part):
                assert (ROOT / part).is_file(), part
            if part.startswith("selecta."):
                assert importlib.util.find_spec(part), part


@pytest.mark.parametrize("name", sorted(staging.TASKS))
def test_a_missing_input_stops_the_task_before_anything_runs(name, capsys):
    ran = []
    code = staging.main([name], env={}, run=ran.append)
    assert code == 2 and ran == []
    out = capsys.readouterr().out
    assert all(f"set {variable}" in out for variable in staging.TASKS[name].needs)


def test_a_production_url_is_refused():
    env = {"STAGING_API": "https://api.selecta.app", "STAGING_GATEWAY": "https://gw.selecta.app"}
    assert staging.main(["smoke"], env=env, run=lambda c: 0) == 2


def test_the_commands_run_in_order_and_stop_at_the_first_failure(tmp_path, capsys):
    task = staging.TASKS["l6"]
    env = full_env(task) | {"REPORT_DIR": str(tmp_path / "reports")}
    ran: list[list[str]] = []

    def fail_the_k6_run(command):
        ran.append(command)
        return 1 if "run" in command else 0

    assert staging.main(["l6"], env=env, run=fail_the_k6_run) == 1
    assert [c[1] for c in ran] == ["tests/load/ladder.py", "run"]
    assert "LEVEL=L3" in ran[1]
    ok: list[list[str]] = []
    assert staging.main(["l6"], env=env, run=lambda c: ok.append(c) or 0) == 0
    assert ok[-1][1:3] == ["-m", "selecta.ops.reconcile_check"]


def test_a_dry_run_prints_the_commands_and_masks_the_token(capsys):
    env = {"STAGING_API": "https://api.staging.example", "SYNTHETIC_TOKEN": "secret-token",
           "STAGING_GATEWAY": "https://gateway.staging.example"}
    assert staging.main(["smoke", "--dry-run"], env=env, run=lambda c: 1 / 0) == 0
    out = capsys.readouterr().out
    assert "infra/deploy/smoke.py" in out and "secret-token" not in out and "***" in out


def test_the_list_names_every_task(capsys):
    assert staging.main(["--list"], env={}) == 0
    out = capsys.readouterr().out
    assert all(name in out for name in staging.TASKS)
