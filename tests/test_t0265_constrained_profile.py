"""T0265: a library of more than 20,000 songs profiled under constrained CPU and storage.

The server half of T0265. The library is paged through the real /api/library handler three ways:
idle; with every core held busy by busy processes while analysis keeps writing and a real seam
render (selecta.render.engine.render of a bass-swap blend) runs over and over in its own process at
the render worker's lowered priority; and the same again with the drive reporting almost no free
space. Every song must stay reachable exactly once, no page may stall, every concurrent render must
finish with real audio, and the stem cache must shrink to its floor rather than fill the drive (an
export on a full drive refusing with its reason is tests/test_flow_export_jobs.py). The browser
half (a 120-song Edit and the 64-cell Studio under a throttled CPU during a render) is
web/e2e/t0265-constrained-profiles.e2e.ts.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import subprocess
import sys
import threading
import time
from collections import namedtuple
from pathlib import Path

import pytest

from selecta import db, stems
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings

SONGS = 20_500
TESTS = Path(__file__).parent
# One real seam render after another until the stop file appears (always at least one); each
# render's time goes to the out file. Its own process at lowered priority, as the app runs renders.
RENDER_LOOP = """
import json, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from helpers import song_from_track
from synth import make_track
from selecta import jobs
from selecta.analysis.song import Cue
from selecta.render.engine import render
from selecta.styles.blend import bass_swap_blend
work, stop, out = Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
jobs.lower_priority()
a = song_from_track(work, "a", make_track(bpm=120, bars=48, seed=1))
b = song_from_track(work, "b", make_track(bpm=123, bars=48, seed=2))
cue_a, cue_b = Cue(24, a.bar_time(24), "t", 0.8, 8), Cue(0, b.bar_time(0), "t", 0.8, 8)
done = []
while not stop.exists() or not done:
    began = time.perf_counter()
    rendered = render(bass_swap_blend(a, b, cue_a, cue_b, 8))
    peak = float(abs(rendered.audio).max())
    done.append({"s": time.perf_counter() - began, "seconds": rendered.seconds, "peak": peak})
    out.write_text(json.dumps(done), "utf-8")
"""
Usage = namedtuple("Usage", "total used free")
NEARLY_FULL = Usage(500 * 1024**3, 500 * 1024**3 - 100 * 1024**2, 100 * 1024**2)


@pytest.fixture
def library(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,'Someone',?,1)",
        [(n, f"song-{n}.flac", f"Song {n:05d}") for n in range(1, SONGS + 1)],
    )
    conn.commit()
    conn.close()
    app = create_app(settings, tmp_path / "no-web")
    handler = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/library" and "GET" in getattr(route, "methods", ())
    )
    return settings, handler


def _page_through(handler) -> tuple[set[int], list[float]]:
    seen: set[int] = set()
    timings: list[float] = []
    after = None
    while True:
        started = time.perf_counter()
        page = handler(q="", state="all", sort="title", limit=200, after=after)
        timings.append(time.perf_counter() - started)
        ids = [song["id"] for song in page["songs"]]
        assert not seen.intersection(ids), "a song came back on two pages"
        seen.update(ids)
        after = page["next"]
        if not after:
            return seen, timings


def _profile(timings: list[float]) -> dict[str, float]:
    ordered = sorted(timings)
    return {
        "pages": len(ordered),
        "p50_ms": round(statistics.median(ordered) * 1000, 1),
        "p95_ms": round(ordered[int(len(ordered) * 0.95)] * 1000, 1),
        "worst_ms": round(ordered[-1] * 1000, 1),
    }


class _Contention:
    """Every core busy (stand-in renders) and analysis writing, for the length of a with-block."""

    def __init__(self, settings: Settings, work: Path) -> None:
        self.settings = settings
        self.work = work
        work.mkdir()
        self.stop = threading.Event()
        self.written = 0
        self.burners: list[subprocess.Popen] = []
        self.renders: list[dict[str, float]] = []

    def _analyse(self) -> None:
        writer = db.connect(self.settings.db_path)
        try:
            song_id = 1
            while not self.stop.is_set() and song_id <= SONGS:
                db.save_analysis(
                    writer,
                    song_id,
                    {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "8A", "energy": 0.5},
                )
                self.written += 1
                song_id += 1
        finally:
            writer.close()

    def __enter__(self) -> _Contention:
        work = self.work
        self.render = subprocess.Popen(  # noqa: S603
            [
                sys.executable,
                "-c",
                RENDER_LOOP,
                str(TESTS),
                str(work),
                str(work / "stop"),
                str(work / "renders.json"),
            ]
        )
        for _ in range(os.cpu_count() or 2):
            self.burners.append(
                subprocess.Popen([sys.executable, "-c", "while True: pass"])  # noqa: S603
            )
        self.worker = threading.Thread(target=self._analyse, daemon=True)
        self.worker.start()
        time.sleep(0.3)  # let the burners reach full load before measuring
        return self

    def __exit__(self, *_: object) -> None:
        self.stop.set()
        (self.work / "stop").touch()
        for burner in self.burners:
            burner.kill()
        for burner in self.burners:
            burner.wait(timeout=10)
        self.worker.join(timeout=30)
        try:
            self.render.wait(timeout=300)  # it finishes the render under way
        finally:
            self.render.kill()
        out = self.work / "renders.json"
        self.renders = json.loads(out.read_text("utf-8")) if out.exists() else []

    def render_profile(self) -> dict[str, float]:
        seconds = sorted(entry["s"] for entry in self.renders)
        if not seconds:
            return {"renders": 0}
        return {
            "renders": len(seconds),
            "p50_s": round(statistics.median(seconds), 2),
            "worst_s": round(seconds[-1], 2),
        }


def test_over_twenty_thousand_songs_page_during_a_render_on_full_cpu_and_a_nearly_full_drive(
    library, monkeypatch, tmp_path
):
    settings, handler = library
    idle_seen, idle = _page_through(handler)
    assert len(idle_seen) == SONGS > 20_000

    with _Contention(settings, tmp_path / "busy") as busy_load:
        busy_seen, busy = _page_through(handler)
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: NEARLY_FULL)
    with _Contention(settings, tmp_path / "full") as full_load:
        full_seen, full = _page_through(handler)
        cache_limit = stems.largest_cache_bytes(settings)

    profiles = {"idle": _profile(idle), "cpu": _profile(busy), "cpu_and_disk": _profile(full)}
    reading = {
        "songs": SONGS,
        "cores_held": os.cpu_count(),
        "library": profiles,
        "concurrent_render": {
            "cpu": busy_load.render_profile(),
            "cpu_and_disk": full_load.render_profile(),
        },
        "analysis_rows_written": busy_load.written + full_load.written,
        "cache_limit_mb": cache_limit // 1024**2,
    }
    print(f"T0265-PROFILE {json.dumps({'test': 'library-20k', 'reading': reading})}")
    assert busy_load.written > 100 and full_load.written > 100, "analysis must be writing"
    for load in (busy_load, full_load):
        assert load.renders, "a real render ran alongside the paging"
        # a render on a starved machine is slower, but it finishes, with real audio
        for entry in load.renders:
            assert entry["seconds"] > 5 and 0.01 < entry["peak"] <= 1.0, entry
    assert busy_seen == full_seen == idle_seen, "every song stays reachable exactly once"
    # the cache gives way to the drive: it never plans to use space the drive doesn't have
    assert cache_limit == stems.MIN_CACHE_BYTES
    idle_p95 = profiles["idle"]["p95_ms"]
    for name in ("cpu", "cpu_and_disk"):
        # slower with every core taken is expected; a stall, lock wait or rescan per page is not
        assert profiles[name]["worst_ms"] < 2000, name
        assert profiles[name]["p95_ms"] < max(500.0, idle_p95 * 8), name
