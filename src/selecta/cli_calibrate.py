"""`selecta calibrate`: the planner's gates against the owner's own Good and Bad clicks.

Its own module because cli.py is near its size limit; registered there in one line. The report
changes nothing. `--apply --yes` writes the home's calibration.json, which the planner honours
only with `planner.calibrated_gates` on; `--reset` removes it. When to apply is the owner's call.
"""

from __future__ import annotations

import json
from pathlib import Path

import typer


def _value(fit, value: float) -> str:
    from selecta.planner_core.calibrate import shown

    return shown(fit.name, fit.unit, value)


def _split_line(fit, split, words: str, now: bool) -> list[str]:
    lines = [
        f"  {words}: let through {split.passed_liked} liked, {split.passed_disliked} disliked; "
        f"held back {split.held_liked} liked, {split.held_disliked} disliked "
        f"(balanced accuracy {split.balanced_accuracy:.2f})."
    ]
    side = "now" if now else "best"
    rates = []
    for part, name in (("passed", "let through"), ("held", "held back")):
        interval = fit.intervals.get(f"{side} {part}")
        if interval:
            rates.append(f"{name} {interval[0]:.0%} to {interval[1]:.0%}")
    if rates:
        lines.append(f"    Liked rate, 95% interval: {'; '.join(rates)}.")
    return lines


def _were(count: int) -> str:
    return f"{count} was" if count == 1 else f"{count} were"


def report_lines(fits, collected) -> list[str]:
    """The plain report, one section per gate."""
    span = collected.span()
    lines = [
        f"Read {len(collected.records)} rated seams"
        + (f", rated from {span[0]} to {span[1]}." if span else "."),
    ]
    fallbacks = sum(1 for record in collected.records if record.get("fell_back"))
    if fallbacks:
        lines.append(f"{_were(fallbacks)} the last-resort cut, which no gate chose: left out.")
    if collected.without_facts:
        lines.append(
            f"{_were(collected.without_facts)} older records without the pair's facts: left out."
        )
    if collected.unreadable:
        lines.append(f"Seam files that could not be read: {collected.unreadable}.")
    lines.append("Nothing has been changed.")
    for fit in fits:
        lines += ["", f"{fit.label}: today {_value(fit, fit.current)} ({fit.seams} rated seams)"]
        lines += _split_line(fit, fit.now, "At today's limit", now=True)
        best = fit.best
        if (
            best is not None
            and best.threshold != fit.current
            and best.balanced_accuracy > fit.now.balanced_accuracy
        ):
            lines += _split_line(fit, best, f"At {_value(fit, best.threshold)}", now=False)
        if fit.skipped:
            lines.append(f"  {fit.skipped} rated seams had no value for this: left out.")
        lines.append(f"  Verdict: {fit.verdict}.")
    return lines


def calibrate(
    home: Path = typer.Option(None, help="The SelectaDJ home to read; the usual one if left out."),
    as_json: bool = typer.Option(False, "--json", help="The same report as data."),
    apply: bool = typer.Option(False, "--apply", help="Write the suggested moves for the planner."),
    yes: bool = typer.Option(False, "--yes", help="Confirm --apply."),
    reset_file: bool = typer.Option(False, "--reset", help="Remove an applied calibration."),
) -> None:
    """How the planner's gates fare against your rated seams. Changes nothing unless --apply."""
    from selecta import calibration
    from selecta.config import default_home
    from selecta.planner_core.calibrate import calibrate as fit_all
    from selecta.planner_core.calibrate import evidence, overrides_from

    home = home or default_home()
    if reset_file:
        removed = calibration.reset(home)
        typer.echo("Calibration removed." if removed else "There was no calibration to remove.")
        return
    collected = calibration.rated_seams(home)
    fits = fit_all(collected.records)
    if as_json:
        data = {
            "home": str(home),
            "rated_seams": len(collected.records),
            "rated_between": list(collected.span() or ()),
            "without_facts": collected.without_facts,
            "gates": [evidence(fit) for fit in fits],
        }
        typer.echo(json.dumps(data, indent=1))
    else:
        for line in report_lines(fits, collected):
            typer.echo(line)
    if not apply:
        return
    moves = overrides_from(fits)
    if not moves:
        typer.echo("No gate has enough evidence to move, so there is nothing to apply.")
        return
    typer.echo("This would change:")
    for fit in fits:
        if fit.name in moves:
            old, new = _value(fit, fit.current), _value(fit, moves[fit.name])
            typer.echo(f"  {fit.label}: {old} to {new}")
    if not yes:
        typer.echo("Nothing written. Run again with --apply --yes to write it.")
        return
    calibration.write_calibration(home, fits, collected)
    typer.echo(
        f"Written to {calibration.calibration_path(home)}. The planner uses it only with the "
        "planner.calibrated_gates flag on; selecta calibrate --reset removes it."
    )
