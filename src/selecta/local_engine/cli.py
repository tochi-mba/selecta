"""User-facing CLI group for local-engine; imported without engine side effects."""

from __future__ import annotations

import time
from pathlib import Path

import typer
from rich.console import Console

console = Console()

engine_app = typer.Typer(no_args_is_help=True, add_completion=False)



@engine_app.command("run")
def engine_run(
    state_dir: Path | None = typer.Option(None, help="Private engine state directory."),
) -> None:
    """Supervise the existing local Python/FFmpeg API in the foreground."""
    from selecta.local_engine.config import state_directory
    from selecta.local_engine.supervisor import EngineBusy, Supervisor

    directory = state_dir or state_directory()
    try:
        code = Supervisor(directory).run()
    except (EngineBusy, OSError, ValueError) as problem:
        console.print(f"[red]{problem}[/]")
        raise typer.Exit(2) from problem
    raise typer.Exit(code)


@engine_app.command("start")
def engine_start() -> None:
    """Start a detached supervisor, suitable for login launchers and kiosks."""
    from selecta.local_engine.config import state_directory
    from selecta.local_engine.supervisor import EngineBusy, start_background

    try:
        pid = start_background(state_directory())
    except (EngineBusy, OSError, ValueError) as problem:
        console.print(f"[red]{problem}[/]")
        raise typer.Exit(2) from problem
    console.print(f"Engine supervisor starting (PID {pid}); use 'selecta engine status'.")


@engine_app.command("stop")
def engine_stop() -> None:
    """Request a generation-bound graceful shutdown (never kill an unrelated PID)."""
    from selecta.local_engine.config import state_directory
    from selecta.local_engine.supervisor import request_stop

    if not request_stop(state_directory()):
        console.print("No live engine supervisor found.")
        raise typer.Exit(1)
    console.print("Graceful shutdown requested.")


@engine_app.command("restart")
def engine_restart() -> None:
    """Stop the old generation before starting a fresh detached supervisor."""
    from selecta.local_engine.config import state_directory
    from selecta.local_engine.discovery import read_status
    from selecta.local_engine.supervisor import EngineBusy, request_stop, start_background

    directory = state_directory()
    if request_stop(directory):
        deadline = time.monotonic() + 20
        while read_status(directory)["supervisor_alive"] and time.monotonic() < deadline:
            time.sleep(0.2)
        if read_status(directory)["supervisor_alive"]:
            console.print("[red]Old engine did not release; refusing second instance.[/]")
            raise typer.Exit(2)
    try:
        pid = start_background(directory)
    except (EngineBusy, OSError, ValueError) as problem:
        console.print(f"[red]{problem}[/]")
        raise typer.Exit(2) from problem
    console.print(f"New supervisor PID {pid}.")


@engine_app.command("status")
def engine_status() -> None:
    """Show truthful process/API/audio status without exposing private credentials."""
    from selecta.local_engine.config import state_directory
    from selecta.local_engine.discovery import discover

    console.print_json(data=discover(state_directory()))


@engine_app.command("capabilities")
def engine_capabilities() -> None:
    """Inspect local FFmpeg, platform and output *presence*, not actual audio proof."""
    from selecta.local_engine.capabilities import capability_report

    console.print_json(data=capability_report())


@engine_app.command("config")
def engine_config(
    port: int | None = typer.Option(None, min=1024, max=65535),
    workspace: str | None = typer.Option(None, help="standalone, personal, organisation"),
) -> None:
    """View or atomically change config while stopped; no effect on legacy data home."""
    from dataclasses import asdict

    from selecta.local_engine.config import (
        EngineConfig, load_config, save_config, state_directory,
    )
    from selecta.local_engine.discovery import read_status

    directory = state_directory()
    current = load_config(directory)
    if port is None and workspace is None:
        console.print_json(data=asdict(current))
        return
    if read_status(directory)["supervisor_alive"]:
        console.print("[red]Stop the engine before changing configuration.[/]")
        raise typer.Exit(2)
    changes = asdict(current)
    if port is not None:
        changes["port"] = port
    if workspace is not None:
        changes["workspace"] = workspace
    try:
        updated = EngineConfig.from_dict(changes)
        save_config(directory, updated)
    except ValueError as problem:
        raise typer.BadParameter(str(problem)) from problem
    console.print("Engine configuration saved; start or restart to apply.")


@engine_app.command("rotate-access")
def engine_rotate_access() -> None:
    """Revoke previous local headless tokens, without rotating user music or cloud keys."""
    from selecta.local_engine.config import rotate_access, state_directory

    rotate_access(state_directory())
    console.print("Local headless access revoked. Use 'engine access-token' to reauthorise.")


@engine_app.command("access-token")
def engine_access_token() -> None:
    """Display the private headless token for explicit local provisioning; keep it secret."""
    from selecta.local_engine.config import access_token, state_directory

    console.print(access_token(state_directory()), highlight=False)
