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
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, load_settings

app = typer.Typer(no_args_is_help=True, add_completion=False)
console = Console()
DEFAULT_MIX_OUTPUT = Path("out/mix.flac")
DEFAULT_REEL_OUTPUT = Path("reels/reel-1")


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
    refresh: bool = typer.Option(False, help="Only update songs analysed by an older version."),
) -> None:
    """Run fast analysis on songs that don't have it yet. Safe to stop and resume."""
    from selecta.analysis.pipeline import Analysers, analyse_song
    from selecta.jobs import lower_priority

    settings, conn = _open()
    songs = db.songs_needing_analysis(conn, ANALYSIS_VERSION, folder, refresh)
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
) -> None:
    """Open the local Selecta web app."""
    import webbrowser

    import uvicorn

    url = f"http://127.0.0.1:{port}/"
    if open_browser:
        webbrowser.open(url)
    uvicorn.run("selecta.api:app", host="127.0.0.1", port=port, log_level="warning")


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
def discover(limit: int = typer.Option(1000, help="Maximum audio links to keep per run.")) -> None:
    """Search the whole analysed library and fill the Seam Book."""
    from selecta.analysis.song import load_song
    from selecta.discovery.search import audio_search, lyric_search

    settings, conn = _open()
    lyric_count = lyric_search(conn)
    rows = conn.execute(
        "SELECT song_id FROM analysis WHERE version=? AND error IS NULL ORDER BY song_id",
        (ANALYSIS_VERSION,),
    ).fetchall()
    songs = [load_song(conn, settings, row["song_id"]) for row in rows]
    audio_count = audio_search(conn, songs, limit)
    console.print(f"Found {lyric_count} lyric links and {audio_count} audio links.")


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


if __name__ == "__main__":
    app()
