"""The `selecta` command."""

from __future__ import annotations

import json
import os
import random
import statistics
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from selecta import db
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, load_settings
from selecta.persistence import make_engine

app = typer.Typer(no_args_is_help=True, add_completion=False)
database_app = typer.Typer(no_args_is_help=True, add_completion=False)
app.add_typer(database_app, name="db", help="Cloud database schema operations.")
console = Console()
DEFAULT_MIX_OUTPUT = Path("out/mix.flac")
DEFAULT_REEL_OUTPUT = Path("reels/reel-1")


def _cloud_database_engine():
    """Cloud database commands must never fall back to the user's local music database."""
    url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
    if not url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise typer.BadParameter(
            "Set SELECTA_DATABASE_URL to the Cloud PostgreSQL database; local SQLite is not "
            "upgraded by this command."
        )
    return make_engine(url)


@database_app.command("upgrade")
def database_upgrade() -> None:
    """Apply the checked-in Alembic migrations to the configured Cloud PostgreSQL database."""
    from selecta.persistence.migrate import current, head, upgrade

    engine = _cloud_database_engine()
    try:
        before = current(engine)
        upgrade(engine)
        console.print(f"Cloud database schema: {before or 'empty'} → {head()}.")
    finally:
        engine.dispose()


@database_app.command("current")
def database_current() -> None:
    """Show the configured Cloud database revision and the revision expected by this checkout."""
    from selecta.persistence.migrate import current, head

    engine = _cloud_database_engine()
    try:
        console.print(f"Database: {current(engine) or 'empty'}; code: {head() or 'empty'}.")
    finally:
        engine.dispose()


def _open():
    settings = load_settings()
    return settings, db.connect(settings.db_path)


@app.callback()
def _flags_allow(ctx: typer.Context) -> None:
    """Runs before every command: a command whose feature is turned off says so and stops."""
    from selecta import flags

    try:
        flags.effective()
    except flags.FlagError as problem:
        console.print(f"[red]{problem}[/]")
        raise typer.Exit(2) from problem
    owners = flags.cli_owners().get(ctx.invoked_subcommand or "", [])
    if owners and not any(flags.on(owner) for owner in owners):
        names = " or ".join(f"`{owner}`" for owner in owners)
        console.print(
            f"This is turned off in this build (flag {names}). "
            f"Run with {flags.ENV}=+{owners[0]} to turn it on."
        )
        raise typer.Exit(2)


@app.command("flags")
def flags_command(
    markdown: Path = typer.Option(
        None, "--markdown", help="Write the catalog as Markdown here, such as docs/flags.md."
    ),
) -> None:
    """Every feature flag: on or off in this shell, and why."""
    from selecta import flags

    if markdown is not None:
        markdown.write_text(flags.markdown(), "utf-8", newline="\n")
        console.print(f"Wrote {markdown}.")
        return
    states = flags.effective()
    table = Table(title=f"Feature flags ({flags.ENV}={os.environ.get(flags.ENV, '')!r})")
    table.add_column("Flag")
    table.add_column("On", justify="center")
    table.add_column("Why")
    table.add_column("Area")
    for flag_id, flag in flags.registry().items():
        state = states[flag_id]
        table.add_row(flag_id, "yes" if state.on else "[red]no[/]", state.why, flag.area)
    console.print(table)


@app.command()
def scan(folder: Path) -> None:
    """Read a music folder, set aside what isn't music, and mark duplicates."""
    from selecta.library.scan import scan_folder, set_aside_summary

    _, conn = _open()
    started = time.perf_counter()
    report = scan_folder(conn, folder)
    seconds = time.perf_counter() - started

    aside = sum(report.set_aside.values())
    unique = report.music - report.duplicates
    console.print(
        f"[bold]{report.found:,}[/] files in {seconds:.1f} s: [bold]{unique:,}[/] songs, "
        f"{report.duplicates:,} duplicates, {aside:,} set aside as probably not music."
    )
    if report.unreadable:
        console.print(f"{len(report.unreadable)} files couldn't be read.")

    table = Table(title="Set aside")
    table.add_column("Folder", overflow="fold")
    table.add_column("Files", justify="right")
    table.add_column("Reason")
    for row in set_aside_summary(conn):
        table.add_row(row["folder"], str(row["files"]), row["reason"] or "")
    console.print(table)


@app.command()
def analyse(
    limit: int = typer.Option(0, help="Stop after this many songs. 0 means all of them."),
    folder: str = typer.Option(None, help="Only folders containing this text."),
    sample: bool = typer.Option(False, help="Pick songs at random, not in order."),
    seed: int = typer.Option(7, help="Random seed used with --sample."),
    beat_model: str = typer.Option(None, help="Beat model checkpoint, such as final0."),
    low_priority: bool = typer.Option(True, help="Run below normal priority."),
    refresh: bool = typer.Option(False, help="Only update songs analysed by an older version."),
    song: list[int] = typer.Option(None, help="Analyse just these song ids."),
    from_app: bool = typer.Option(False, hidden=True, help="Stop when the app stops."),
) -> None:
    """Run fast analysis on songs that don't have it yet. Safe to stop and resume."""
    from selecta.analysis.pipeline import Analysers, analyse_song
    from selecta.jobs import (
        lower_priority,
        lowest_priority,
        stop_when_app_stops,
        wait_while_mix_renders,
    )

    if from_app:
        stop_when_app_stops()
    settings, conn = _open()
    if song:
        rows = [db.song_by_id(conn, song_id) for song_id in dict.fromkeys(song)]
        # r8d: a song asked for by name may have been analysed by the library's own run since it
        # was asked for. Leaving it out here, before the models load, saves starting a gigabyte of
        # models only to skip every song
        songs = [
            row
            for row in rows
            if row is not None
            and (refresh or not db.is_analysed(conn, row["id"], ANALYSIS_VERSION))
        ]
    else:
        songs = db.songs_needing_analysis(conn, ANALYSIS_VERSION, folder, refresh)
    if sample:
        random.Random(seed).shuffle(songs)
    if limit:
        songs = songs[:limit]
    if not songs:
        console.print("Nothing to analyse.")
        return
    if low_priority:
        # a song someone asked for by name doesn't sit behind everything else on the PC
        (lowest_priority if from_app and not song else lower_priority)()

    started = time.perf_counter()
    analysers = Analysers.load(settings, beat_model)
    console.print(f"Models loaded in {time.perf_counter() - started:.1f} s. {len(songs)} to go.")

    failures = 0
    for number, item in enumerate(songs, 1):
        if from_app and not song:
            wait_while_mix_renders(settings.home)
        if db.is_analysed(conn, item["id"], ANALYSIS_VERSION) and not refresh:
            continue  # someone asked for it by name while this was working through the list
        result = analyse_song(conn, settings, item, analysers)
        name = f"{item['artist'] or '?'} - {item['title']}"
        if result is None:
            failures += 1
            console.print(f"{number}/{len(songs)} [red]failed[/] {name}", highlight=False)
            continue
        grid = result.grid
        console.print(
            f"{number}/{len(songs)} {result.timings['total']:5.1f}s "
            f"{grid.bpm:6.1f} BPM {result.key.camelot:>3} conf {grid.confidence:.2f} {name}",
            highlight=False,
        )
    elapsed = time.perf_counter() - started
    console.print(f"Done in {elapsed / 60:.1f} min. {failures} failed.")


@app.command()
def timings() -> None:
    """Report measured analysis timings, and project them across the library."""
    _, conn = _open()
    rows = conn.execute(
        "SELECT a.timings, s.duration FROM analysis a JOIN songs s ON s.id = a.song_id "
        "WHERE a.timings IS NOT NULL"
    ).fetchall()
    if not rows:
        console.print("No timings yet. Run `selecta analyse --limit 10 --sample` first.")
        return
    records = [json.loads(row["timings"]) for row in rows]
    durations = [row["duration"] for row in rows]
    table = Table(
        title=f"Measured on {len(records)} songs, mean {statistics.mean(durations) / 60:.1f} min"
    )
    table.add_column("Step")
    table.add_column("Mean s", justify="right")
    table.add_column("Max s", justify="right")
    steps = ["decode", "resample", "beats", "grid", "features", "key", "loudness", "save", "total"]
    for step in steps:
        values = [r.get(step, 0.0) for r in records]
        table.add_row(step, f"{statistics.mean(values):.2f}", f"{max(values):.2f}")
    console.print(table)

    remaining = len(db.songs_needing_analysis(conn, ANALYSIS_VERSION))
    mean_total = statistics.mean(r.get("total", 0.0) for r in records)
    console.print(
        f"{remaining:,} songs still to analyse, about {remaining * mean_total / 3600:.1f} hours "
        "at this pace."
    )


@app.command()
def library(
    text: str = typer.Argument("", help="Search artist and title."),
    limit: int = typer.Option(40),
) -> None:
    """Show analysed songs."""
    _, conn = _open()
    rows = conn.execute(
        "SELECT s.id, s.artist, s.title, a.bpm, a.camelot, a.key_agrees_chroma, a.grid_confidence, "
        "a.constant_tempo, a.energy, a.lufs, a.error FROM songs s "
        "JOIN analysis a ON a.song_id = s.id "
        "WHERE s.title LIKE ? OR s.artist LIKE ? ORDER BY a.grid_confidence DESC LIMIT ?",
        (f"%{text}%", f"%{text}%", limit),
    ).fetchall()
    table = Table()
    for heading in ("id", "Artist", "Title", "BPM", "Key", "Grid", "Steady", "Energy", "LUFS"):
        table.add_column(heading, overflow="ellipsis", max_width=28)
    for row in rows:
        if row["error"]:
            table.add_row(str(row["id"]), row["artist"] or "", row["title"], "failed", row["error"])
            continue
        table.add_row(
            str(row["id"]),
            row["artist"] or "",
            row["title"] or "",
            f"{row['bpm']:.1f}",
            f"{row['camelot']}{'' if row['key_agrees_chroma'] else '?'}",
            f"{row['grid_confidence']:.2f}",
            "yes" if row["constant_tempo"] else "no",
            f"{row['energy']:.2f}",
            f"{row['lufs']:.1f}",
        )
    console.print(table)


@app.command()
def lyrics(limit: int = typer.Option(0, help="Stop after this many songs. 0 means all.")) -> None:
    """Look up line-synced lyrics on LRCLIB. Only artist, title, album and duration are sent."""
    from selecta.lyrics.lrclib import fetch_all

    _, conn = _open()

    def progress(number: int, total: int, status: str, name: str) -> None:
        if number % 25 == 0 or number == total:
            console.print(f"{number}/{total} {status:12s} {name}", highlight=False)

    counts = fetch_all(conn, limit, progress)
    console.print(counts)
    rows = conn.execute("SELECT status, COUNT(*) AS n FROM lyrics GROUP BY status").fetchall()
    console.print({row["status"]: row["n"] for row in rows})


def _find_song(conn, text: str) -> int:
    if text.isdigit():
        return int(text)
    rows = conn.execute(
        "SELECT s.id, s.artist, s.title FROM songs s JOIN analysis a ON a.song_id = s.id "
        "WHERE a.error IS NULL AND (s.title LIKE ? OR s.artist || ' ' || s.title LIKE ?) "
        "ORDER BY LENGTH(s.title)",
        (f"%{text}%", f"%{text}%"),
    ).fetchall()
    if not rows:
        console.print(f"No analysed song matches {text!r}.")
        raise typer.Exit(1)
    return rows[0]["id"]


def _audit_table(report) -> Table:
    table = Table(title="Audit")
    for heading in ("Check", "Value", "Limit", "Result"):
        table.add_column(heading)
    for check in report.checks:
        table.add_row(
            check.name,
            f"{check.value}{check.unit}",
            f"{check.limit}{check.unit}",
            "pass" if check.passed else "[red]FAIL[/]",
        )
    return table


@app.command()
def mix(
    a: str = typer.Argument(..., help="Outgoing song: an id or part of its title."),
    b: str = typer.Argument(..., help="Incoming song: an id or part of its title."),
    style: str = typer.Option(None, help="Force a recipe, such as echo_out."),
    output: Path = typer.Option(DEFAULT_MIX_OUTPUT, "--output", "-o"),
    before: float = typer.Option(16.0, help="Seconds of A to hear first."),
    after: float = typer.Option(24.0, help="Seconds of B to hear after."),
) -> None:
    """Render one transition, with some of each song around it, and audit the result."""
    import soundfile as sf

    from selecta.analysis.song import load_song
    from selecta.config import SAMPLE_RATE
    from selecta.planner.choose import choose_transition
    from selecta.render.engine import SongCache, in_context

    settings, conn = _open()
    song_a = load_song(conn, settings, _find_song(conn, a))
    song_b = load_song(conn, settings, _find_song(conn, b))
    console.print(f"{song_a.name} ({song_a.bpm:.1f} BPM, {song_a.camelot})", highlight=False)
    console.print(f"into {song_b.name} ({song_b.bpm:.1f} BPM, {song_b.camelot})", highlight=False)

    cache = SongCache()
    started = time.perf_counter()
    choice = choose_transition(song_a, song_b, style=style, cache=cache)
    seconds = time.perf_counter() - started
    for attempt in choice.attempts:
        result = (
            "no script"
            if attempt.report is None
            else (
                "passed"
                if attempt.report.passed
                else "failed " + ", ".join(c.name for c in attempt.report.failures)
            )
        )
        console.print(
            f"  tried {attempt.candidate.recipe.name} {attempt.candidate.bars} bars: {result}",
            highlight=False,
        )
    label = choice.candidate.recipe.name + (" (fallback)" if choice.fell_back else "")
    console.print(f"Chose {label} in {seconds:.1f} s. {'; '.join(choice.candidate.reasons)}.")
    console.print(_audit_table(choice.report))
    console.print(f"Drift corrected: {choice.rendered.drift_ms} ms")

    heard, clip_at = in_context(choice.rendered, before, after, cache)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, heard, SAMPLE_RATE, subtype="PCM_16")
    seam = clip_at + choice.rendered.script.overlap[0]
    console.print(f"Wrote {output}. The seam is at {seam:.1f} s.")


@app.command()
def reel(
    output: Path = typer.Option(DEFAULT_REEL_OUTPUT, "--output", "-o"),
    seed: int = typer.Option(7),
    words: int = typer.Option(9, help="How many word hand-offs to render first. 0 skips them."),
    only_words: bool = typer.Option(False, help="Stop after the word cuts."),
) -> None:
    """Render a mix of transitions from your own songs for you to listen to and rate."""
    from selecta.discovery.search import lyric_links
    from selecta.lyrics.match import varied_links
    from selecta.planner.fit import TimbreSpace
    from selecta.planner.reel import build_reel, load_library, word_entry, write_page
    from selecta.planner.wordreel import (
        DEFAULT_QUOTAS,
        analyse_links,
        build_takes,
        rank_links,
    )
    from selecta.render.engine import SongCache

    settings, conn = _open()
    output.mkdir(parents=True, exist_ok=True)
    first = []
    if words:
        links = lyric_links(conn)
        analyse_links(conn, settings, varied_links(links, words * 5), console.print)
        library = load_library(conn, settings)
        space = TimbreSpace.fit(library)
        ranked = rank_links(links, {song.id: song for song in library}, space)
        total = sum(DEFAULT_QUOTAS.values())
        quotas = {mode: max(1, count * words // total) for mode, count in DEFAULT_QUOTAS.items()}
        cache = SongCache(capacity=6)
        takes = build_takes(conn, settings, ranked, quotas, space, cache, console.print)
        first = [word_entry(n, take, output, cache) for n, take in enumerate(takes, 1)]
        write_page(first, output)
        console.print(f"{len(first)} word hand-offs written.")
    entries = (
        first
        if only_words
        else build_reel(conn, settings, output, seed=seed, log=console.print, first=first)
    )
    console.print(f"{len(entries)} transitions written. Open {output / 'index.html'}.")


@app.command("beat-check")
def beat_check(
    output: Path = typer.Option(DEFAULT_REEL_OUTPUT, "--output", "-o"),
    count: int = typer.Option(20),
) -> None:
    """Render clicks over your songs, so you can check the beat grids and keys by ear."""
    from selecta.planner.gridcheck import build_grid_check

    settings, conn = _open()
    clips = build_grid_check(conn, settings, output, count)
    console.print(f"{len(clips)} clips written. Open {output / 'grid.html'}.")


@app.command()
def listen(
    folder: Path = typer.Argument(DEFAULT_REEL_OUTPUT),
    port: int = typer.Option(8765),
    open_browser: bool = typer.Option(True, "--open/--no-open"),
) -> None:
    """Serve a reel on this machine only, so seeking works in the browser."""
    import webbrowser

    import uvicorn
    from fastapi import FastAPI

    from selecta.api import FreshFiles

    server = FastAPI()
    server.mount("/", FreshFiles(directory=folder, html=True))
    url = f"http://127.0.0.1:{port}/"
    console.print(f"Listening room at {url} (press Ctrl+C to stop).")
    if open_browser:
        webbrowser.open(url)
    uvicorn.run(server, host="127.0.0.1", port=port, log_level="warning")


@app.command()
def web(
    port: int = typer.Option(8733),
    open_browser: bool = typer.Option(True, "--open/--no-open"),
    reload: bool = typer.Option(False, "--reload", help="Restart as the code changes."),
) -> None:
    """Run SelectaDJ in the selected mode (local app or Cloud API)."""
    import webbrowser

    import uvicorn

    from selecta import flags

    off = flags.turned_off()
    if off:
        shown = ", ".join(off[:12]) + (f" and {len(off) - 12} more" if len(off) > 12 else "")
        console.print(f"Turned off in this build: {shown}. `selecta flags` says why.")
    from selecta.modes import Mode, current_mode

    mode = current_mode()
    url = f"http://127.0.0.1:{port}/"
    if mode is Mode.LOCAL and open_browser:
        webbrowser.open(url)
    elif mode is Mode.CLOUD:
        console.print(
            f"Starting SelectaDJ Cloud API on port {port}; web assets are hosted separately."
        )
    uvicorn.run(
        "selecta.api:serve",
        factory=True,
        host="127.0.0.1" if mode is Mode.LOCAL else os.environ.get("SELECTA_BIND_HOST", "0.0.0.0"),
        port=port,
        log_level="warning",
        reload=reload,
        reload_dirs=[str(Path(__file__).parent)] if reload else None,
    )


@app.command()
def gateway(
    port: int = typer.Option(8734),
    host: str | None = typer.Option(None, help="Defaults to SELECTA_GATEWAY_BIND_HOST or 0.0.0.0."),
    reload: bool = typer.Option(False, "--reload", help="Restart as the code changes."),
) -> None:
    """Run the isolated Cloud worker gateway service."""
    import uvicorn

    uvicorn.run(
        "selecta.gateway_cloud:create_gateway_app",
        factory=True,
        host=host or os.environ.get("SELECTA_GATEWAY_BIND_HOST", "0.0.0.0"),
        port=port,
        log_level="warning",
        reload=reload,
        reload_dirs=[str(Path(__file__).parent)] if reload else None,
    )


@app.command()
def maintain(
    tick: float = typer.Option(1.0, min=0.1, max=60.0, help="Seconds between maintenance ticks."),
) -> None:
    """Run the Cloud maintenance service: one leader runs every recurring task, a copy stands by."""
    import logging

    from selecta.maintain import main

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        main(tick_s=tick)
    except ValueError as problem:
        raise typer.BadParameter(str(problem)) from problem


@app.command("billing-maintenance")
def billing_maintenance(
    limit: int = typer.Option(50, min=1, max=500, help="Maximum webhook events to drain."),
    reconcile: bool = typer.Option(
        False, "--reconcile", help="Also re-fetch every subscription and repair drift."
    ),
) -> None:
    """Drain Stripe webhook retries; optionally run the slower full reconciliation."""
    from selecta.billing.maintenance import drain_stripe_events, reconcile_stripe_billing
    from selecta.billing.stripe_sync import load_price_map
    from selecta.billing.webhooks import HttpStripeClient

    key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    prices = load_price_map()
    if not key or not prices:
        raise typer.BadParameter(
            "Set SELECTA_STRIPE_SECRET_KEY and SELECTA_STRIPE_PRICES before running "
            "billing maintenance."
        )
    engine = _cloud_database_engine()
    client = HttpStripeClient(key, api_version=os.environ.get("SELECTA_STRIPE_API_VERSION"))
    try:
        drained = drain_stripe_events(engine, client, prices, limit=limit)
        console.print(
            f"Stripe webhooks: {drained.processed} processed, {drained.failed} failed, "
            f"{drained.busy} busy, {drained.errors} maintenance errors."
        )
        if reconcile:
            report = reconcile_stripe_billing(engine, client, prices)
            console.print(
                f"Reconciliation: {report.checked} subscriptions checked, "
                f"{report.changed} differences, {report.unmatched} unmatched, "
                f"{report.audit_entries} audit entries."
            )
    finally:
        engine.dispose()


@app.command("storage-maintenance")
def storage_maintenance(
    limit: int = typer.Option(100, min=1, max=1000, help="Maximum due tombstones to process."),
) -> None:
    """Mirror deletion tombstones, then purge R2 objects past their recovery window."""
    from selecta.storage import api as storage_api
    from selecta.storage.maintenance import drain_physical_deletions
    from selecta.storage.offsite_ledger import drain_deletion_mirror

    ledger_bucket = os.environ.get("SELECTA_R2_BUCKET_DELETION_LEDGER", "").strip()
    if not ledger_bucket:
        raise typer.BadParameter(
            "Set SELECTA_R2_BUCKET_DELETION_LEDGER to a dedicated private R2 bucket."
        )
    engine = _cloud_database_engine()
    client = storage_api.r2_client()
    try:
        mirror = drain_deletion_mirror(engine, client, ledger_bucket, limit=limit)
        console.print(
            f"Deletion mirror: {mirror.delivered}/{mirror.examined} delivered, "
            f"{mirror.failed} failed, {mirror.pending} pending."
        )
        if mirror.failed or mirror.pending:
            raise typer.Exit(1)
        report = drain_physical_deletions(
            engine, client, buckets=storage_api.buckets(), limit=limit
        )
        console.print(
            f"Storage deletions: {report.completed}/{report.examined} purged, "
            f"{report.failed} need retry; {report.objects_deleted} objects removed."
        )
        if report.failed:
            raise typer.Exit(1)
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()
        engine.dispose()


@app.command("account-deletion-maintenance")
def account_deletion_maintenance(
    limit: int = typer.Option(50, min=1, max=500, help="Maximum workflow steps to run."),
) -> None:
    """Advance due account-deletion steps; schedule this command in Cloud maintenance."""
    from selecta.billing.stripe_sync import load_price_map
    from selecta.billing.webhooks import HttpStripeClient
    from selecta.identity.deletion import run_once
    from selecta.identity.deletion_effects import (
        AccountDeletionEffects,
        HttpWorkOSUserDeleter,
    )
    from selecta.identity.deletion_ledger import R2DeletionLedgerWriter
    from selecta.storage import api as storage_api
    from selecta.work.store import JobStore

    stripe_key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    workos_key = os.environ.get("SELECTA_WORKOS_API_KEY", "").strip()
    ledger_bucket = os.environ.get("SELECTA_R2_BUCKET_DELETION_LEDGER", "").strip()
    prices = load_price_map()
    if not stripe_key:
        raise typer.BadParameter(
            "Set SELECTA_STRIPE_SECRET_KEY before running deletion maintenance."
        )
    if not workos_key:
        raise typer.BadParameter("Set SELECTA_WORKOS_API_KEY before running deletion maintenance.")
    if not ledger_bucket:
        raise typer.BadParameter(
            "Set SELECTA_R2_BUCKET_DELETION_LEDGER to a dedicated private R2 bucket."
        )

    engine = _cloud_database_engine()
    client = storage_api.r2_client()
    stripe = HttpStripeClient(stripe_key, api_version=os.environ.get("SELECTA_STRIPE_API_VERSION"))
    effects = AccountDeletionEffects(
        engine,
        JobStore(engine),
        stripe,
        client,
        price_map=prices,
        ledger_writer=R2DeletionLedgerWriter(client, ledger_bucket),
        identity=HttpWorkOSUserDeleter(
            workos_key,
            api_base=os.environ.get("SELECTA_WORKOS_API_BASE", "https://api.workos.com"),
        ),
        buckets=storage_api.buckets(),
    )
    processed = 0
    try:
        while processed < limit and run_once(engine, "account-deletion-cli", effects):
            processed += 1
        console.print(f"Account-deletion workflow steps attempted: {processed}.")
    finally:
        client.close()
        engine.dispose()


@app.command("replay-deletions-after-restore")
def replay_deletions_after_restore() -> None:
    """Replay offsite tombstones before reopening Cloud after a database restore."""
    from selecta.identity.deletion_ledger import replay_account_deletions_after_restore
    from selecta.storage import api as storage_api
    from selecta.storage.offsite_ledger import replay_storage_tombstones_after_restore

    ledger_bucket = os.environ.get("SELECTA_R2_BUCKET_DELETION_LEDGER", "").strip()
    if not ledger_bucket:
        raise typer.BadParameter(
            "Set SELECTA_R2_BUCKET_DELETION_LEDGER to the dedicated private R2 bucket."
        )
    engine = _cloud_database_engine()
    client = storage_api.r2_client()
    try:
        storage = replay_storage_tombstones_after_restore(engine, client, ledger_bucket)
        accounts = replay_account_deletions_after_restore(engine, client, ledger_bucket)
        console.print(
            f"Restore replay: {storage.tombstones_replayed} storage tombstones, "
            f"{accounts.accounts_requeued} account workflows requeued. "
            "Keep customer traffic closed until this command succeeds."
        )
    finally:
        client.close()
        engine.dispose()


@app.command()
def plan(
    count: int = typer.Option(20, help="Songs to put in the rolling set plan."),
    start: int = typer.Option(None, help="Optional starting song id."),
) -> None:
    """Plan a steerable set with rolling beam search."""
    from selecta.analysis.song import load_song
    from selecta.planner.beam import plan_set

    settings, conn = _open()
    rows = conn.execute(
        "SELECT song_id FROM analysis WHERE version=? AND error IS NULL ORDER BY song_id",
        (ANALYSIS_VERSION,),
    ).fetchall()
    songs = [load_song(conn, settings, row["song_id"]) for row in rows]
    from selecta.session import get_steering

    steering = get_steering(conn)
    planned = plan_set(
        songs,
        start,
        count,
        mix_language=steering.mix_language,
        stems=steering.stems,
    )
    conn.execute("DELETE FROM queue")
    conn.executemany(
        "INSERT INTO queue(position,song_id,transition,reason) VALUES(?,?,?,?)",
        [(i, item.song.id, item.transition, item.reason) for i, item in enumerate(planned)],
    )
    conn.commit()
    console.print(f"Planned {len(planned)} songs. Open them with `selecta web`.")


@app.command()
def discover(
    limit: int = typer.Option(1000, help="Maximum audio links to keep per sampled run."),
    exhaustive: bool = typer.Option(False, help="Resume checking every analysed song pair."),
    pair_limit: int = typer.Option(1000, min=1, help="New pairs per exhaustive run."),
) -> None:
    """Search the whole analysed library and fill the Seam Book."""
    from selecta import flags
    from selecta.analysis.song import load_song
    from selecta.discovery.search import audio_search, lyric_search
    from selecta.jobs import lowest_priority, wait_while_mix_renders

    settings, conn = _open()
    lowest_priority()
    wait_while_mix_renders(settings.home)
    lyric_count = lyric_search(conn) if flags.on("discover.word_links") else 0
    if not flags.on("discover.harmonic"):
        console.print(f"Found {lyric_count} lyric links. Harmonic matches are turned off.")
        return
    rows = conn.execute(
        "SELECT a.song_id FROM analysis a JOIN songs s ON s.id=a.song_id "
        "WHERE a.version=? AND a.error IS NULL AND s.is_music=1 "
        "AND s.duplicate_of IS NULL ORDER BY a.song_id",
        (ANALYSIS_VERSION,),
    ).fetchall()
    songs = [load_song(conn, settings, row["song_id"]) for row in rows]
    if exhaustive:
        from selecta.discovery.sweep import sweep

        progress = sweep(
            conn, songs, pair_limit, before_pair=lambda: wait_while_mix_renders(settings.home)
        )
        console.print(
            f"Checked {progress['checked']} pairs; reused {progress['cached']}; "
            f"{progress['remaining']} remain. Added {progress['added']} audio links. "
            "Run again to continue."
        )
        return
    audio_count = audio_search(
        conn, songs, limit, before_pair=lambda: wait_while_mix_renders(settings.home)
    )
    console.print(f"Found {lyric_count} lyric links and {audio_count} audio links.")


@app.command("listening-import")
def listening_import(manifest: Path) -> None:
    """Register two same-context comparison renders from a JSON manifest."""
    from selecta.listening import register_comparison

    data = json.loads(manifest.read_text("utf-8"))
    settings, conn = _open()
    trials = register_comparison(
        conn, settings, data["study"], data["pair"], data["conditions"], data.get("seed", 42)
    )
    console.print(f"Registered {len(trials)} comparison. Open study {data['study']} in Workshop.")


@app.command("listening-report")
def listening_report(study: str) -> None:
    """Report recorded grades and bad-transition rates without filling missing answers."""
    from selecta.listening import study_summary

    _, conn = _open()
    console.print_json(data=study_summary(conn, study))


@app.command("gather-data")
def gather_data() -> None:
    """Bring data from every older SelectaDJ folder on this PC into the one in use. Safe to repeat."""
    from selecta.homes import gather

    settings = load_settings()
    sources = gather(settings.home)
    console.print(f"Everything is now in {settings.home}", highlight=False, soft_wrap=True)
    for source in sources:
        console.print(f"  brought in {source}", highlight=False, soft_wrap=True)


@app.command()
def ratings(
    as_json: bool = typer.Option(False, "--json", help="Print everything as JSON."),
) -> None:
    """Every Good and Bad clicked, across every data folder on this PC, and what they share."""
    from selecta.eval.feedback import all_rated, as_dicts, known_homes, patterns

    settings = load_settings()
    homes = known_homes(settings.home)
    rated = all_rated(homes)
    if as_json:
        console.print_json(data={"ratings": as_dicts(rated), "patterns": patterns(rated)})
        return
    good = sum(item.good for item in rated)
    console.print(f"{len(rated)} rated seams in {len(homes)} data folders: {good} Good.")
    for home in homes:
        console.print(f"  {home}", highlight=False, soft_wrap=True)
    for item in sorted(rated, key=lambda r: (r.move, not r.good)):
        word = "GOOD" if item.good else "BAD "
        apart = "tempo unknown" if item.gap is None else f"{item.gap:5.1%} apart"
        console.print(
            f"{word} {item.move:16} {item.bars:2} bars, {apart}, "
            + ("key unknown, " if item.keys is None else f"keys {item.keys}, ")
            + f"{item.a[:30]} > {item.b[:30]}"
            + (f" ({item.note})" if item.note else ""),
            highlight=False,
            soft_wrap=True,
        )
    for table, rows in patterns(rated).items():
        console.print(f"\n{table}")
        for row, (liked, disliked) in rows.items():
            console.print(f"  {row:24} {liked:3} Good {disliked:3} Bad", highlight=False)


@app.command("set-mix")
def set_mix(
    output: Path = typer.Option(Path("out/selecta-set.wav"), "--output", "-o"),
    count: int = typer.Option(7, min=2, max=50),
    songs: str = typer.Option(
        "", help="Comma-separated song IDs in play order; otherwise use the planned queue."
    ),
) -> None:
    """Render the current planned queue as one continuous audited mix."""
    from selecta.analysis.song import load_song
    from selecta.render.setmix import render_set

    settings, conn = _open()
    if songs:
        try:
            song_ids = [int(value.strip()) for value in songs.split(",") if value.strip()]
        except ValueError as error:
            raise typer.BadParameter("--songs must contain comma-separated numeric IDs") from error
        rows = [{"song_id": song_id} for song_id in song_ids]
        count = len(rows)
    else:
        rows = conn.execute(
            "SELECT song_id FROM queue ORDER BY position LIMIT ?", (count,)
        ).fetchall()
    if len(rows) < count:
        raise typer.BadParameter(f"the queue has only {len(rows)} songs; run `selecta plan` first")
    songs = [load_song(conn, settings, row["song_id"]) for row in rows]
    choices, seconds = render_set(songs, output, console.print)
    tracklist = output.with_suffix(".txt")
    tracklist.write_text(
        "\n".join(f"{i + 1:02d}. {song.name}" for i, song in enumerate(songs))
        + "\n\nTransitions\n"
        + "\n".join(
            f"{i + 1:02d}. {choice.rendered.script.style}" for i, choice in enumerate(choices)
        ),
        encoding="utf-8",
    )
    console.print(f"Wrote {seconds / 60:.1f} minutes to {output} and {tracklist}.")


@app.command("stem-preview")
def stem_preview(
    a: int = typer.Argument(..., help="Outgoing song ID."),
    b: int = typer.Argument(..., help="Incoming song ID."),
    output: Path = typer.Option(Path("out/stem-preview.flac"), "--output", "-o"),
) -> None:
    """Render one groove-preserving transition with intertwined stems."""
    import soundfile as sf

    from selecta.analysis.song import load_song
    from selecta.render.intertwine import render_intertwined

    settings, conn = _open()
    outgoing = load_song(conn, settings, a)
    incoming = load_song(conn, settings, b)
    console.print(f"Separating and intertwining {outgoing.name} -> {incoming.name}…")
    result = render_intertwined(settings, outgoing, incoming)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, result.audio, SAMPLE_RATE, subtype="PCM_16")
    console.print(f"Wrote {result.audio.shape[0] / SAMPLE_RATE:.1f}s to {output}.")


@app.command("key-benchmark")
def key_benchmark(
    candidate: str = typer.Option("chroma", help="The key method to compare with S-KEY."),
    limit: int | None = typer.Option(None, help="Only the first N analysed songs."),
    threshold: float | None = typer.Option(None, help="Weighted score the candidate must reach."),
    output: Path = typer.Option(Path("out/key-benchmark.json"), "--output", "-o"),
) -> None:
    """Score a replacement key method against S-KEY's stored keys (read-only, SC-0405-02)."""
    from selecta.analysis import key_benchmark as bench

    if candidate not in bench.CANDIDATES:
        raise typer.BadParameter(f"Known methods: {', '.join(bench.CANDIDATES)}.")
    conn = bench.open_read_only(load_settings().db_path)
    report = bench.run(conn, bench.CANDIDATES[candidate], name=candidate, limit=limit)
    bench.write(report, output, threshold)
    score = report.against_skey.as_dict()
    console.print(
        f"{candidate} vs S-KEY on {score['songs']:,} songs: exact {score['exact']:.1%}, "
        f"mixable {score['mixable']:.1%}, weighted {score['weighted']:.3f}. Report: {output}."
    )
    if threshold is not None:
        console.print("Meets the threshold." if report.meets(threshold) else "Below the threshold.")


if __name__ == "__main__":
    app()
