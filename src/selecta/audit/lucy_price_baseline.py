"""The price-change check for Lucy's allowance (ADR-0487 rule 10, LM-0487-09).

How far a Lucy allowance goes is decided by a handful of numbers in the code: each model's price,
the two cache multipliers, each default deployment's model, prices, per-turn cost cap and
fallback, which deployment each plan routes to, and the allowance table itself. Changing any of
them changes what every member gets for the same allowance, so ADR-0487 rule 10 says the
measurement of rule 2 is run again on recent data before the change ships.

This module makes that rule mechanical. `tests/fixtures/lucy_price_baseline.json` is a committed
snapshot of those numbers beside the date and the report of the measurement that backs them.
`current()` builds the same snapshot from the code and `diff()` says, one plain sentence per
difference, what moved. `tests/test_lucy_price_baseline.py` fails while they differ.

    uv run python -m selecta.audit.lucy_price_baseline
    uv run python -m selecta.audit.lucy_price_baseline --write \
        --measured-on 2027-01-15 --measurement docs/verification/<the report>.md

The first form prints the differences and exits 1 when there are any. `--write` rewrites the
snapshot and is refused without the date and the report of a measurement, and when the report
is not a file under `docs/verification/`. It reads the code and writes that one file: no
database and no network. The procedure is `docs/operations/lucy-price-change.md`.

It cannot see a price changed in a running database (a `model_deployments` row or an active
routing version); that gap and the manual step covering it are in the same procedure.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any

from selecta.ai import registry
from selecta.billing import plans

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "tests" / "fixtures" / "lucy_price_baseline.json"
REPORTS = "docs/verification"

# The fields that are compared with the code. The rest of the file says what backs them.
PRICE_KEYS = (
    "model_prices",
    "cache_read_multiplier",
    "cache_write_multiplier",
    "deployments",
    "routing",
    "lucy_usage",
)
RECORD_KEYS = ("recorded_on", "measured_on", "measurement", "note")

_WORDS = {
    "input_usd_per_mtok": "input price",
    "output_usd_per_mtok": "output price",
    "per_turn_cost_cap_usd": "per-turn cost cap",
    "model": "model",
    "fallback_id": "fallback",
    "base_weekly_units": "base weekly units",
    "venue_weekly_units": "venue weekly units",
}


def current() -> dict[str, Any]:
    """The snapshot as the code has it now: plain JSON values, keyed by `PRICE_KEYS`."""
    return {
        "model_prices": {
            model: {"input_usd_per_mtok": float(inp), "output_usd_per_mtok": float(out)}
            for model, (inp, out) in registry.MODEL_PRICES.items()
        },
        "cache_read_multiplier": float(registry.CACHE_READ_MULTIPLIER),
        "cache_write_multiplier": float(registry.CACHE_WRITE_MULTIPLIER),
        "deployments": {
            deployment.id: {
                "model": deployment.model_id,
                "input_usd_per_mtok": float(deployment.prices.input_usd_per_mtok),
                "output_usd_per_mtok": float(deployment.prices.output_usd_per_mtok),
                "per_turn_cost_cap_usd": float(deployment.per_turn_cost_cap_usd),
                "fallback_id": deployment.fallback_id,
            }
            for deployment in registry.DEFAULT_DEPLOYMENTS
        },
        "routing": {
            tier: {request_class: list(chain) for request_class, chain in classes.items()}
            for tier, classes in registry.DEFAULT_ROUTING.items()
        },
        "lucy_usage": {
            str(usage.version): {
                "base_weekly_units": usage.base_weekly_units,
                "venue_weekly_units": usage.venue_weekly_units,
                "plans": {plan_id: asdict(plan) for plan_id, plan in usage.plans.items()},
            }
            for usage in plans.LUCY_USAGE
        },
    }


def _changed(what: str, before: Any, after: Any) -> str:
    return f"{what} changed from {_say(before)} to {_say(after)}"


def _say(value: Any) -> str:
    if value is None:
        return "nothing"
    if isinstance(value, list | tuple):
        return ", then ".join(str(item) for item in value) or "nothing"
    return str(value)


def _fields(name: str, before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    """One sentence per field of a flat record that differs, was added or was taken away."""
    found = []
    for key in sorted(set(before) | set(after)):
        label = f"{name} {_WORDS.get(key, key)}"
        if key not in before:
            found.append(f"{label} was added as {_say(after[key])}")
        elif key not in after:
            found.append(f"{label} was removed (it was {_say(before[key])})")
        elif before[key] != after[key]:
            found.append(_changed(label, before[key], after[key]))
    return found


def _records(
    kind: str,
    before: Mapping[str, Mapping[str, Any]],
    after: Mapping[str, Mapping[str, Any]],
    *,
    label: str = "{}",
) -> list[str]:
    """Compare two maps of flat records: what was added, what was removed, what changed."""
    found = []
    for key in sorted(set(before) | set(after)):
        name = label.format(key)
        if key not in before:
            found.append(f"{kind} {key} was added")
        elif key not in after:
            found.append(f"{kind} {key} was removed")
        else:
            found += _fields(name, before[key], after[key])
    return found


def _routing(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    found = []
    for tier in sorted(set(before) | set(after)):
        if tier not in before:
            found.append(f"routing for the {tier} plan was added")
            continue
        if tier not in after:
            found.append(f"routing for the {tier} plan was removed")
            continue
        old, new = before[tier], after[tier]
        for request_class in sorted(set(old) | set(new)):
            was, now = old.get(request_class), new.get(request_class)
            if was == now:
                continue
            if now is None:
                found.append(f"{tier} no longer routes {request_class} (was {_say(was)})")
            else:
                found.append(f"{tier} now routes {request_class} to {_say(now)} (was {_say(was)})")
    return found


def _usage(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    found = []
    for version in sorted(set(before) | set(after), key=lambda text: (len(text), text)):
        name = f"Lucy usage v{version}"
        if version not in before:
            found.append(f"{name} was added")
            continue
        if version not in after:
            found.append(f"{name} was removed")
            continue
        old, new = dict(before[version]), dict(after[version])
        old_plans, new_plans = old.pop("plans", {}), new.pop("plans", {})
        found += _fields(name, old, new)
        found += _records(f"{name} plan", old_plans, new_plans, label=name + " {}")
    return found


def diff(baseline: Mapping[str, Any], now: Mapping[str, Any]) -> list[str]:
    """Every difference between a recorded snapshot and another, one plain sentence each.
    Only the `PRICE_KEYS` fields are compared. Empty means they agree."""
    found: list[str] = []
    for key in PRICE_KEYS:
        if key not in baseline:
            found.append(f"the baseline has no {key}")
        if key not in now:
            found.append(f"the code snapshot has no {key}")
    if found:
        return found
    found += _records("model", baseline["model_prices"], now["model_prices"])
    for key, label in (
        ("cache_read_multiplier", "cache read multiplier"),
        ("cache_write_multiplier", "cache write multiplier"),
    ):
        if baseline[key] != now[key]:
            found.append(_changed(label, baseline[key], now[key]))
    found += _records(
        "deployment", baseline["deployments"], now["deployments"], label="deployment {}"
    )
    found += _routing(baseline["routing"], now["routing"])
    found += _usage(baseline["lucy_usage"], now["lucy_usage"])
    return found


def load(path: Path = FIXTURE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _measurement_problems(
    root: Path, measured_on: str | None, measurement: str | None
) -> list[str]:
    """Why a rewrite must be refused. Empty when the measurement is named and is there."""
    if not measured_on or not measurement:
        return [
            "a rewrite needs --measured-on YYYY-MM-DD and --measurement <report under"
            f" {REPORTS}/>: a price, routing or allowance change ships only with a fresh"
            " measurement (ADR-0487 rule 10)"
        ]
    found = []
    try:
        if date.fromisoformat(measured_on).isoformat() != measured_on:
            raise ValueError(measured_on)
    except ValueError:
        found.append(f"--measured-on should be a date such as 2027-01-15, not {measured_on!r}")
    report = Path(measurement)
    report = report if report.is_absolute() else root / report
    report = report.resolve()
    if not report.is_file():
        found.append(f"the measurement report {measurement} does not exist")
    elif not report.is_relative_to((root / REPORTS).resolve()):
        found.append(f"the measurement report must be a file under {REPORTS}/, not {measurement}")
    return found


def write(
    *,
    measured_on: str | None,
    measurement: str | None,
    fixture: Path = FIXTURE,
    root: Path = ROOT,
    today: date | None = None,
) -> list[str]:
    """Rewrite the snapshot from the code, recording the measurement behind it. Returns the
    reasons it was refused, having written nothing; empty means the file was rewritten."""
    problems = _measurement_problems(root, measured_on, measurement)
    if problems:
        return problems
    assert measured_on is not None and measurement is not None
    report = Path(measurement)
    report = (report if report.is_absolute() else root / report).resolve()
    record = {
        "recorded_on": (today or date.today()).isoformat(),
        "measured_on": measured_on,
        "measurement": report.relative_to(root.resolve()).as_posix(),
        "note": "These figures are backed by the measurement named here (ADR-0487 rule 10).",
    }
    fixture.write_text(json.dumps({**record, **current()}, indent=2) + "\n", encoding="utf-8")
    return []


def main(argv: Sequence[str] | None = None, *, fixture: Path = FIXTURE, root: Path = ROOT) -> int:
    parser = argparse.ArgumentParser(
        description="Compare Lucy's prices, routing and allowance table with the recorded"
        " baseline, or rewrite the baseline after a fresh measurement."
    )
    parser.add_argument("--write", action="store_true", help="rewrite the baseline")
    parser.add_argument("--measured-on", help="the date the measurement was run, YYYY-MM-DD")
    parser.add_argument("--measurement", help=f"the measurement report, a file under {REPORTS}/")
    args = parser.parse_args(argv)

    if args.write:
        problems = write(
            measured_on=args.measured_on,
            measurement=args.measurement,
            fixture=fixture,
            root=root,
        )
        if problems:
            for problem in problems:
                print(f"REFUSED: {problem}")
            return 2
        print(f"Baseline rewritten: {fixture}")
        return 0

    if not fixture.is_file():
        print(f"ERROR: the baseline {fixture} is missing")
        return 1
    differences = diff(load(fixture), current())
    if differences:
        for difference in differences:
            print(f"CHANGED: {difference}")
        print(
            f"Failed: {len(differences)} difference(s) from the recorded baseline. Re-run the"
            " measurement, then rewrite the baseline (docs/operations/lucy-price-change.md)."
        )
        return 1
    print("Lucy's prices, routing and allowance table match the recorded baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
