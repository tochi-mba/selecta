"""EX-0133-03: profile a 20k-song library with a 100-song mix, and record the hardware it ran on.

    python tests/ex_0133_scale_profile.py 20000 100 profile.json

Builds the made-up library of tests/scale_server.py (no real music, no real home), then through
the real app times what a big library costs a person: paging the whole Library, searching it,
opening the 100-song mix and asking for a mix position's options. It records each call's p50/p95
and worst time in milliseconds, the process's peak memory, and the machine (OS, CPU, cores, RAM,
Python) so the numbers name the hardware they came from. It measures; it does not judge. The
64-cell Studio half is the browser profile in web/e2e/t0265-constrained-profiles.e2e.ts, and
audio continuity is a person listening on that same machine.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

import psutil

sys.path.insert(0, str(Path(__file__).parent))

from e2e_server import build  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from scale_server import grow  # noqa: E402

from selecta.api import create_app  # noqa: E402


def hardware() -> dict:
    memory = psutil.virtual_memory()
    return {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "machine": platform.machine(),
        "cpu": platform.processor() or platform.machine(),
        "cores_logical": psutil.cpu_count(),
        "cores_physical": psutil.cpu_count(logical=False),
        "ram_gb": round(memory.total / 2**30, 1),
        "python": platform.python_version(),
        "named_by_person": None,  # the person running it fills in the machine's name
    }


def timings(samples: list[float]) -> dict:
    ordered = sorted(samples)
    p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
    return {
        "calls": len(ordered),
        "p50_ms": round(statistics.median(ordered) * 1000, 1),
        "p95_ms": round(p95 * 1000, 1),
        "worst_ms": round(ordered[-1] * 1000, 1),
    }


def timed(client: TestClient, path: str, params: dict | None = None) -> tuple[float, dict]:
    started = time.perf_counter()
    response = client.get(path, params=params)
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    return elapsed, response.json()


def profile(songs: int, in_mix: int) -> dict:
    home = Path(tempfile.mkdtemp(prefix="selecta-ex0133-"))
    previous = os.environ.get("SELECTA_HOME")
    os.environ["SELECTA_HOME"] = str(home)
    try:
        settings = build(home)
        grow(settings, songs, in_mix)
        process = psutil.Process()
        with TestClient(create_app(settings, home / "no-web", prepare_links=False)) as client:
            total = timed(client, "/api/library", {"limit": 200})[1]["total"]  # warms caches
            pages, seen, after = [], 0, None
            while True:
                params = {"limit": 200, **({"after": after} if after else {})}
                elapsed, page = timed(client, "/api/library", params)
                pages.append(elapsed)
                seen += len(page["songs"])
                after = page.get("next")
                if not after:
                    break
            searches = [
                timed(client, "/api/library", {"limit": 50, "q": word})[0]
                for word in ("Golden", "River 3", "Artist 12", "zzz-none")
            ]
            mixes, options = [], []
            for _ in range(5):
                elapsed, current = timed(client, "/api/mix")
                mixes.append(elapsed)
            for position in (1, max(in_mix // 2, 1), max(in_mix - 1, 1)):  # seams count from 1
                options.append(timed(client, f"/api/mix/{position}/options")[0])
            peak = process.memory_info().rss
        return {
            "task": "EX-0133-03",
            "library_songs": songs,
            "mix_songs": in_mix,
            "library_total": total,
            "songs_paged": seen,
            "mix_reported": len(current["mix"]),
            "library_pages": timings(pages),
            "library_search": timings(searches),
            "open_mix": timings(mixes),
            "mix_options": timings(options),
            "rss_mb": round(peak / 2**20, 1),
            "hardware": hardware(),
            "audio_continuity": "not measured here: a person listens on this machine",
        }
    finally:
        if previous is None:
            os.environ.pop("SELECTA_HOME", None)
        else:
            os.environ["SELECTA_HOME"] = previous
        shutil.rmtree(home, ignore_errors=True)


def main() -> None:
    songs = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
    in_mix = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    report = profile(songs, in_mix)
    text = json.dumps(report, indent=2)
    if len(sys.argv) > 3:
        Path(sys.argv[3]).write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
