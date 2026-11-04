"""The `selecta` command."""

from __future__ import annotations

import json
import random
import statistics
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from selecta import db
from selecta.config import ANALYSIS_VERSION, load_settings

app = typer.Typer(no_args_is_help=True, add_completion=False)
console = Console()


def _open():
    settings = load_settings()
    return settings, db.connect(settings.db_path)


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
) -> None:
    """Run fast analysis on songs that don't have it yet. Safe to stop and resume."""
    from selecta.analysis.pipeline import Analysers, analyse_song
    from selecta.jobs import lower_priority

    settings, conn = _open()
    songs = db.songs_needing_analysis(conn, ANALYSIS_VERSION, folder)
    if sample:
        random.Random(seed).shuffle(songs)
    if limit:
        songs = songs[:limit]
    if not songs:
        console.print("Nothing to analyse.")
        return
    if low_priority:
        lower_priority()

    started = time.perf_counter()
    analysers = Analysers.load(settings, beat_model)
    console.print(f"Models loaded in {time.perf_counter() - started:.1f} s. {len(songs)} to go.")

    failures = 0
    for number, song in enumerate(songs, 1):
        result = analyse_song(conn, settings, song, analysers)
        name = f"{song['artist'] or '?'} - {song['title']}"
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
    output: Path = typer.Option(Path("out/mix.flac"), "--output", "-o"),
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
    output: Path = typer.Option(Path("reels/reel-1"), "--output", "-o"),
    seed: int = typer.Option(7),
) -> None:
    """Render a mix of transitions from your own songs for you to listen to and rate."""
    from selecta.planner.reel import build_reel

    settings, conn = _open()
    entries = build_reel(conn, settings, output, seed=seed, log=console.print)
    console.print(f"{len(entries)} transitions written. Open {output / 'index.html'}.")


if __name__ == "__main__":
    app()
