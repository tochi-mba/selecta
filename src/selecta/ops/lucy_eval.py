"""The Lucy evaluation run and the staged rollout, from one command (ADR-0404 SC-0404-06).

    python -m selecta.ops.lucy_eval eval --tiers --report eval-report.md
    python -m selecta.ops.lucy_eval eval --deployment sonnet-next --report eval-report.md
    python -m selecta.ops.lucy_eval rollout --candidate sonnet-next --previous sonnet-medium \
        --since <epoch> --report rollout.md [--dry-run]

`eval` runs the fixed evaluation set (`selecta/ai/eval_set.json`) against each named deployment
with its real provider (`ai.eval_subject.ProviderSubject`), records the pass on the deployment
only when every case passed, and writes a Markdown report plus a `.json` beside it. `--tiers`
evaluates every tier's first-choice deployment in the active routing. Provider calls run outside
any database transaction; only reading the deployments and recording a pass touch the database.

`rollout` moves a candidate that passed the set to its next stage (5%, 25%, 100%) after comparing
its real turns since `--since` with the previous deployment's (`ai.rollout`), or holds or rolls
it back. Inputs: `SELECTA_DATABASE_URL` and each deployment's key in the environment variable
its secret reference names (for example `ANTHROPIC_API_KEY`). Belongs to the
`cloud.operations` flag. Exit code 0 means passed (eval) or advanced/held/done (rollout).
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Engine

from selecta import flags
from selecta.ai import evaluation, registry, rollout
from selecta.ai.evaluation import Report
from selecta.ai.registry import Deployment
from selecta.persistence import transaction

FLAG = "cloud.operations"


def evaluate(
    engine: Engine,
    deployment_ids: list[str] | None,
    subject_for: Callable[[Deployment], evaluation.Subject],
) -> list[Report]:
    """Evaluate each deployment (every tier's first choice when None) and record passes."""
    with transaction(engine) as conn:
        ids = deployment_ids if deployment_ids else evaluation.first_choices(conn)
        deployments = registry.load_deployments(conn)
    reports = []
    for deployment_id in ids:
        deployment = deployments.get(deployment_id)
        if deployment is None:
            raise registry.RegistryError(f"{deployment_id} unknown")
        report = evaluation.run(deployment, subject_for(deployment))
        if report.passed:
            with transaction(engine) as conn:
                recorded = registry.record_eval_pass(conn, deployment_id)
            report = Report(report.deployment_id, report.eval_version, report.results, recorded)
        reports.append(report)
    return reports


def eval_markdown(reports: list[Report]) -> str:
    passed = bool(reports) and all(report.passed for report in reports)
    lines = [f"# Lucy evaluation: {'PASSED' if passed else 'FAILED'}", ""]
    for report in reports:
        lines += [
            f"## {report.deployment_id}: {'passed' if report.passed else 'FAILED'} "
            f"(set version {report.eval_version}, recorded: {report.recorded})",
            "",
            "| Case | Result | Failures |",
            "|---|---|---|",
        ]
        lines += [
            f"| {r.case_id} | {'ok' if r.passed else 'FAILED'} | {'; '.join(r.failures)} |"
            for r in report.results
        ]
        lines.append("")
    return "\n".join(lines)


def rollout_markdown(step: rollout.Step) -> str:
    lines = [
        f"# Rollout of {step.deployment_id}: {step.verdict}",
        "",
        f"- Rollout: {step.from_percent}% to {step.to_percent}%",
    ]
    if step.comparison is not None:
        for label, m in (
            ("Candidate", step.comparison.candidate),
            ("Previous", step.comparison.previous),
        ):
            lines.append(
                f"- {label} {m.deployment_id}: {m.turns} turns, failures "
                f"{m.failure_rate:.1%}, p95 {m.p95_seconds:.1f} s, "
                f"${m.mean_cost_usd:.4f} a turn"
            )
        lines += [f"- Regression: {problem}" for problem in step.comparison.regressions]
        if step.comparison.waiting:
            lines.append(f"- Waiting: {step.comparison.waiting}")
    lines += [f"- {note}" for note in step.notes]
    return "\n".join(lines) + "\n"


def _write(report: Path, markdown: str, data: Any) -> None:
    report.write_text(markdown, "utf-8")
    report.with_suffix(".json").write_text(json.dumps(data, indent=2, default=str), "utf-8")
    print(markdown)


def main(
    argv: list[str] | None = None,
    *,
    engine: Engine | None = None,
    subject_for: Callable[[Deployment], evaluation.Subject] | None = None,
) -> int:
    parser = argparse.ArgumentParser(description="Lucy evaluation gate and staged rollout.")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("eval", help="Run the evaluation set against deployments.")
    which = run.add_mutually_exclusive_group(required=True)
    which.add_argument("--deployment", action="append", help="A deployment id (repeatable).")
    which.add_argument("--tiers", action="store_true", help="Every tier's first choice.")
    run.add_argument("--report", type=Path, required=True)
    step = commands.add_parser("rollout", help="Advance, hold or roll back a candidate.")
    step.add_argument("--candidate", required=True)
    step.add_argument("--previous", required=True)
    step.add_argument(
        "--since",
        type=float,
        required=True,
        help="Epoch seconds: compare turns started since the last stage change.",
    )
    step.add_argument("--report", type=Path, required=True)
    step.add_argument("--dry-run", action="store_true")
    for name, default in (
        ("min-turns", 50),
        ("max-failure-increase", 0.02),
        ("max-p95-ratio", 1.25),
        ("max-cost-ratio", 1.25),
    ):
        step.add_argument(f"--{name}", type=type(default), default=default)
    args = parser.parse_args(argv)
    flags.require(FLAG)

    owned = engine is None
    if engine is None:
        from selecta.persistence import make_engine

        engine = make_engine(os.environ["SELECTA_DATABASE_URL"])
    try:
        if args.command == "eval":
            if subject_for is None:
                from selecta.ai.eval_subject import ProviderSubject, provider_for

                def subject_for(deployment: Deployment) -> evaluation.Subject:
                    return ProviderSubject(provider_for(deployment))

            reports = evaluate(engine, None if args.tiers else args.deployment, subject_for)
            _write(args.report, eval_markdown(reports), [r.to_json() for r in reports])
            return 0 if reports and all(report.passed for report in reports) else 1
        limits = rollout.Limits(
            args.min_turns, args.max_failure_increase, args.max_p95_ratio, args.max_cost_ratio
        )
        with transaction(engine) as conn:
            result = rollout.advance(
                conn, args.candidate, args.previous, args.since, limits, dry_run=args.dry_run
            )
        _write(args.report, rollout_markdown(result), result.to_json())
        return 1 if result.verdict == "rolled_back" else 0
    finally:
        if owned:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
