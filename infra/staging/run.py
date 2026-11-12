"""One command for each staging run the Cloud checklist still needs a person to do.

    python infra/staging/run.py --list
    python infra/staging/run.py smoke            (add --dry-run to print the commands only)

Each task reads its inputs from environment variables (listed by `--list` and in
`infra/staging/README.md`), refuses to start when one is missing, refuses any URL that does not
look like staging or a local host, runs its commands in order from the repository root and stops
at the first failure. Reports go to `REPORT_DIR` (default `reports/staging`). Exit code 0 means
every command passed. `tests/test_staging_runner.py` checks every task's scripts exist and the
README names every input.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SAFE_HOSTS = ("staging", "localhost", "127.0.0.1")

Env = Mapping[str, str]


@dataclass(frozen=True)
class Task:
    name: str
    tasks: tuple[str, ...]
    """The checklist ids it is evidence for."""
    about: str
    needs: tuple[str, ...]
    commands: Callable[[Env, str], list[list[str]]]
    optional: tuple[str, ...] = ()
    urls: tuple[str, ...] = field(default=())
    """Inputs that are URLs and must point at staging."""


def _k6(env: Env) -> str:
    return env.get("K6", "k6")


def _py() -> str:
    return sys.executable


def _smoke(env: Env, out: str) -> list[list[str]]:
    command = [
        _py(),
        "infra/deploy/smoke.py",
        "--api",
        env["STAGING_API"],
        "--gateway",
        env["STAGING_GATEWAY"],
    ]
    if env.get("SYNTHETIC_TOKEN"):
        command += ["--synthetic-token", env["SYNTHETIC_TOKEN"]]
    return [command]


def _sse(env: Env, out: str) -> list[list[str]]:
    command = [
        env.get("K6_SSE", "./k6"),
        "run",
        "--summary-export",
        f"{out}/sse.json",
        "-e",
        f"API={env['STAGING_API']}",
        "-e",
        f"TOKENS={env['TOKENS_JSON']}",
    ]
    for name in ("STREAMS", "HOLD_S"):
        if env.get(name):
            command += ["-e", f"{name}={env[name]}"]
    return [command + ["tests/load/sse_connections.js"]]


def _ladder(env: Env, out: str, level: str | None = None) -> list[list[str]]:
    level = level or env["LEVEL"]
    summary = f"{out}/ladder-{level}.json"
    return [
        [_py(), "tests/load/ladder.py", "json"],
        [
            _k6(env),
            "run",
            "--summary-export",
            summary,
            "-e",
            f"LEVEL={level}",
            "-e",
            f"BASE_URL={env['STAGING_BASE_URL']}",
            "-e",
            f"TOKENS={env['TOKENS_TXT']}",
            "tests/load/k6/ladder.js",
        ],
        [_py(), "tests/load/ladder.py", "check", summary],
    ]


def _l6(env: Env, out: str) -> list[list[str]]:
    return _ladder(env, out, "L3") + [
        [_py(), "-m", "selecta.ops.reconcile_check", "--report", f"{out}/reconcile.md"]
    ]


def _rooms(env: Env, out: str) -> list[list[str]]:
    return [
        [
            _k6(env),
            "run",
            "--summary-export",
            f"{out}/rooms.json",
            "-e",
            f"BASE_URL={env['STAGING_BASE_URL']}",
            "-e",
            f"CODE={env['ROOM_CODE']}",
            "-e",
            f"REQUEST_ID={env['REQUEST_ID']}",
            "tests/load/k6/rooms.js",
        ]
    ]


def _restore(env: Env, out: str) -> list[list[str]]:
    return [["bash", "infra/backup/restore_drill.sh"]]


def _eval(env: Env, out: str) -> list[list[str]]:
    which = ["--deployment", env["DEPLOYMENT"]] if env.get("DEPLOYMENT") else ["--tiers"]
    return [
        [_py(), "-m", "selecta.ops.lucy_eval", "eval", *which, "--report", f"{out}/lucy-eval.md"]
    ]


def _rollout(env: Env, out: str) -> list[list[str]]:
    command = [
        _py(),
        "-m",
        "selecta.ops.lucy_eval",
        "rollout",
        "--candidate",
        env["CANDIDATE"],
        "--previous",
        env["PREVIOUS"],
        "--since",
        env["SINCE"],
        "--report",
        f"{out}/lucy-rollout.md",
    ]
    return [command + (["--dry-run"] if env.get("DRY_RUN") else [])]


TASKS = {
    task.name: task
    for task in (
        Task(
            "smoke",
            ("SC-0409-01",),
            "Post-deploy smoke test with a synthetic user.",
            ("STAGING_API", "STAGING_GATEWAY"),
            _smoke,
            ("SYNTHETIC_TOKEN",),
            ("STAGING_API", "STAGING_GATEWAY"),
        ),
        Task(
            "sse",
            ("SC-0407-04",),
            "10,000 concurrent /api/events streams (L3), with k6 + xk6-sse.",
            ("STAGING_API", "TOKENS_JSON"),
            _sse,
            ("K6_SSE", "STREAMS", "HOLD_S"),
            ("STAGING_API",),
        ),
        Task(
            "ladder",
            ("SC-0411-04",),
            "One ladder rung (LEVEL=L1..L4) with k6, then the judge.",
            ("LEVEL", "STAGING_BASE_URL", "TOKENS_TXT"),
            _ladder,
            ("K6",),
            ("STAGING_BASE_URL",),
        ),
        Task(
            "l6",
            ("SC-0411-05",),
            "L3 load while people inject the L6 faults, then the reconciliation audit.",
            ("STAGING_BASE_URL", "TOKENS_TXT", "SELECTA_DATABASE_URL"),
            _l6,
            ("K6",),
            ("STAGING_BASE_URL",),
        ),
        Task(
            "rooms",
            ("SC-0416-06",),
            "1,000 joins in 10 s, 10,000 votes a minute, code guessing.",
            ("STAGING_BASE_URL", "ROOM_CODE", "REQUEST_ID"),
            _rooms,
            ("K6",),
            ("STAGING_BASE_URL",),
        ),
        Task(
            "restore-drill",
            ("SC-0409-04", "SC-0412-03"),
            "Restore last night's dump, replay the "
            "ledger, reconcile, check deletions hold, all timed.",
            (
                "DRILL_DATABASE_URL",
                "BACKUP_S3_ENDPOINT",
                "BACKUP_BUCKET",
                "SELECTA_R2_BUCKET_DELETION_LEDGER",
            ),
            _restore,
            ("REPORT_DIR",),
        ),
        Task(
            "lucy-eval",
            ("SC-0404-06",),
            "The Lucy evaluation set against each tier's deployment.",
            ("SELECTA_DATABASE_URL", "ANTHROPIC_API_KEY"),
            _eval,
            ("DEPLOYMENT",),
        ),
        Task(
            "lucy-rollout",
            ("SC-0404-06",),
            "Take a candidate to its next stage (5/25/100%) after "
            "comparing it with the previous deployment.",
            ("SELECTA_DATABASE_URL", "CANDIDATE", "PREVIOUS", "SINCE"),
            _rollout,
            ("DRY_RUN",),
        ),
    )
}


def shown(command: list[str]) -> str:
    """The command as printed: a token passed on the command line is masked."""
    masked = [
        "***" if before == "--synthetic-token" else part
        for before, part in zip(["", *command], command, strict=True)
    ]
    return shlex.join(masked)


def problems(task: Task, env: Env) -> list[str]:
    found = [f"set {name}" for name in task.needs if not env.get(name)]
    for name in task.urls:
        value = env.get(name, "").lower()
        if value and not any(host in value for host in SAFE_HOSTS):
            found.append(f"{name} does not look like staging: {env[name]}")
    if task.name == "ladder" and env.get("LEVEL") not in (None, "", "L1", "L2", "L3", "L4"):
        found.append("LEVEL is one of L1, L2, L3, L4")
    return found


def main(
    argv: list[str] | None = None,
    env: Env | None = None,
    run: Callable[[list[str]], int] | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("task", nargs="?", choices=sorted(TASKS))
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    env = dict(os.environ if env is None else env)
    if args.list or not args.task:
        for task in TASKS.values():
            extra = f" (optional: {', '.join(task.optional)})" if task.optional else ""
            print(
                f"{task.name:14} {', '.join(task.tasks):24} {task.about}\n"
                f"{'':14} needs: {', '.join(task.needs)}{extra}"
            )
        return 0
    task = TASKS[args.task]
    found = problems(task, env)
    if found:
        print("\n".join(f"Cannot start {task.name}: {item}" for item in found))
        return 2
    out = env.get("REPORT_DIR", "reports/staging")
    commands = task.commands(env, out)
    if not args.dry_run:
        (ROOT / out).mkdir(parents=True, exist_ok=True)
    run = run or (lambda command: subprocess.call(command, cwd=ROOT, env={**os.environ, **env}))
    for command in commands:
        print("+ " + shown(command), flush=True)
        if args.dry_run:
            continue
        code = run(command)
        if code:
            print(f"FAILED ({code}): {task.name}")
            return code
    print(f"{'DRY RUN' if args.dry_run else 'PASSED'}: {task.name}; reports in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
