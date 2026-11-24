"""`selecta admin ...`: the operator commands for the staff console that run from a shell.

`selecta admin bootstrap-owner --email ... --reason ...` makes the first Owner (doc 07b §2). It
uses the configured Cloud database (`SELECTA_DATABASE_URL`, as on a Render shell), prints only
the new Owner's user id, and refuses once any Owner exists.
"""

from __future__ import annotations

import os

import typer

from selecta.persistence import make_engine

admin_app = typer.Typer(no_args_is_help=True, add_completion=False)


def _engine():
    url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
    if not url:
        typer.echo("Set SELECTA_DATABASE_URL to the Cloud database first.", err=True)
        raise typer.Exit(2)
    return make_engine(url)


@admin_app.command("bootstrap-owner")
def bootstrap_owner_command(
    email: str = typer.Option(..., help="The email the person signs in to SelectaDJ with."),
    reason: str = typer.Option(..., help="Why, for the audit log (at least 10 characters)."),
) -> None:
    """Make the first staff Owner. Refused when an Owner already exists."""
    from selecta.admin.bootstrap import BootstrapRefused, first_owner

    engine = _engine()
    try:
        user_id = first_owner(engine, email, reason=reason, via="cli")
    except BootstrapRefused as problem:
        typer.echo(f"Refused: {problem}", err=True)
        raise typer.Exit(1) from problem
    finally:
        engine.dispose()
    typer.echo(user_id)


__all__ = ["admin_app"]
