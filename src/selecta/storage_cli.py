"""`selecta storage gc`: read what the derived-files collector would delete, or run it.

A dry run by default: it lists, decides and reports, and deletes nothing (`storage.derived_gc`).
`--apply` deletes, as the maintenance task does once `cloud.derived_gc` is on.
"""

from __future__ import annotations

import os

import typer

storage_app = typer.Typer(no_args_is_help=True, add_completion=False)


@storage_app.command("gc")
def gc(
    apply: bool = typer.Option(False, "--apply", help="Delete; without it nothing is deleted."),
    workspace: str | None = typer.Option(None, help="Only this workspace id."),
    limit: int = typer.Option(1_000, min=1, max=10_000, help="Most files to delete."),
    seconds: float = typer.Option(120.0, min=1.0, max=3_600.0, help="Time bound for the run."),
) -> None:
    """Show (or, with --apply, delete) derived files nothing uses."""
    from selecta.persistence import make_engine
    from selecta.storage import api as storage_api
    from selecta.storage import derived_gc

    url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
    if not url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise typer.BadParameter("Set SELECTA_DATABASE_URL to the Cloud PostgreSQL database.")
    engine = make_engine(url)
    try:
        collector = derived_gc.Collector(
            engine, storage_api.r2_client, storage_api.buckets().derived,
            dry_run=lambda: not apply, max_delete=limit, max_seconds=seconds)
        report = collector.run(only=workspace)
    finally:
        engine.dispose()
    for line in report.lines():
        typer.echo(line)


__all__ = ["storage_app"]
