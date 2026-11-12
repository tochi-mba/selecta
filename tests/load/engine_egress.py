"""Engine egress benchmark: bytes uploaded per job type (ADR-0396 SC-0396-07, SC-0396-02).

Runs the Cloud worker's own engine handlers (`selecta.workers.engine_handlers`: `analyse.song`,
`seam.render`, `export.render`) end to end on a `JobContext` backed by a `LocalArtifactStore`,
one analysis per song, one seam per neighbouring pair and one export of the whole set, and
reports for each job type the jobs run, bytes published per job (what a Cloud worker would upload
to R2) and wall seconds per job.

    python tests/load/engine_egress.py --songs 4 --beats model --report egress.json
    python tests/load/engine_egress.py --audio-dir <folder of real songs> --beats model \
        --write-model infra/workers/egress_model.json

Without `--audio-dir` it makes synthetic songs (tests/synth.py): a lab measurement of the
pipeline, not the Phase 0 number. Only a run on real audio may write the cost model
(`--write-model` refuses synthetic songs). `--beats known` uses the synthetic songs' own beats
instead of the pinned beat model, for a machine without the weights. The same script runs inside
the worker image (services/worker/Dockerfile) for the end-to-end image check.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from selecta.analysis.pipeline import Analysers  # noqa: E402
from selecta.storage.artifacts import LocalArtifactStore  # noqa: E402
from selecta.storage.keys import original_key  # noqa: E402
from selecta.work.model import Job  # noqa: E402
from selecta.workers import engine_handlers  # noqa: E402
from selecta.workers.context import AttemptSignals, JobContext  # noqa: E402

WS = "ws-bench"
AUDIO = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".aiff", ".aif"}


@dataclass
class Tally:
    jobs: int = 0
    bytes: int = 0
    seconds: float = 0.0
    sizes: list[int] = field(default_factory=list)

    def row(self) -> dict:
        per = self.bytes / self.jobs if self.jobs else 0.0
        return {
            "jobs": self.jobs,
            "bytes": self.bytes,
            "bytes_per_job": round(per),
            "seconds_per_job": round(self.seconds / self.jobs, 2) if self.jobs else 0.0,
            "min_bytes": min(self.sizes, default=0),
            "max_bytes": max(self.sizes, default=0),
        }


class KnownBeats:
    checkpoint = "known"

    def __init__(self, tracks):
        self.tracks = tracks

    def raw(self, mono, sample_rate):
        seconds = mono.size / sample_rate
        track = min(self.tracks, key=lambda t: abs(t.audio.shape[0] / t_sr() - seconds))
        return track.beats.astype(np.float64), track.downbeats.astype(np.float64)


def t_sr() -> int:
    from synth import SR

    return SR


def _job(job_type: str, ref: dict, number: int) -> Job:
    return Job(
        id=f"job-{job_type}-{number}",
        workspace_id=WS,
        type=job_type,
        pool="cpu-heavy",
        lane="standard",
        base_lane="standard",
        urgency=5,
        base_urgency=5,
        state="running",
        input_ref=ref,
        est_cost_s=1.0,
        max_attempts=6,
        max_run_s=600.0,
        created_at=0.0,
        updated_at=0.0,
    )


def _synthetic(folder: Path, count: int, bars: int):
    from synth import SR, make_track

    tracks = [
        make_track(
            bpm=120 + 2 * (n % 3), bars=bars + 4 * n, seed=n + 1, root_hz=110.0 * (1 + 0.06 * n)
        )
        for n in range(count)
    ]
    paths = []
    for number, track in enumerate(tracks):
        path = folder / f"synth{number}.wav"
        sf.write(path, track.audio, SR, subtype="PCM_16")
        paths.append(path)
    return paths, tracks


def run(paths: Sequence[Path], work: Path, analysers) -> dict:
    store = LocalArtifactStore(work / "home")
    handlers = engine_handlers.handlers(analysers=analysers)
    tally: dict[str, Tally] = {}
    attempts = iter(range(10_000))

    def go(job_type: str, ref: dict) -> dict:
        number = next(attempts)
        job = _job(job_type, ref, number)
        scratch = work / f"scratch-{number}"
        scratch.mkdir()
        ctx = JobContext(
            job,
            f"attempt-{number}",
            1,
            scratch,
            AttemptSignals(),
            lambda *_: None,
            artifact_store=store,
        )
        began = time.perf_counter()
        result = handlers[job_type](job, ctx)
        spent = time.perf_counter() - began
        sizes = [int(out.size_bytes or 0) for out in ctx.artifacts.outputs]
        row = tally.setdefault(job_type, Tally())
        row.jobs += 1
        row.bytes += sum(sizes)
        row.seconds += spent
        row.sizes.extend(sizes)
        return result

    sides = []
    for number, path in enumerate(paths):
        key = original_key(WS, f"asset-{number}")
        _size, sha = store.publish(key, path)
        result = go("analyse.song", {"source_sha256": sha, "source_key": key})
        sides.append(
            {
                "source_sha256": sha,
                "source_key": key,
                "analysis_key": result["keys"][0],
                "title": f"Song {number}",
            }
        )
    for a, b in zip(sides, sides[1:], strict=False):
        go("seam.render", {"a": a, "b": b})
    if len(sides) >= 2:
        go("export.render", {"songs": sides})
    source_bytes = sum(Path(p).stat().st_size for p in paths)
    return {
        "songs": len(paths),
        "source_bytes": source_bytes,
        "by_type": {kind: row.row() for kind, row in sorted(tally.items())},
    }


def write_model(path: Path, by_type: dict) -> None:
    data = json.loads(path.read_text("utf-8"))
    for kind, row in by_type.items():
        if kind in data["bytes_per_job"]:
            data["bytes_per_job"][kind] = row["bytes_per_job"]
    path.write_text(json.dumps(data, indent=2) + "\n", "utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--songs", type=int, default=4, help="synthetic songs to make")
    parser.add_argument("--bars", type=int, default=72, help="bars per synthetic song")
    parser.add_argument("--audio-dir", type=Path, help="real songs to measure instead")
    parser.add_argument("--beats", choices=("model", "known"), default="model")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--write-model", type=Path)
    args = parser.parse_args(argv)
    if args.write_model and not args.audio_dir:
        parser.error("--write-model needs --audio-dir: only real audio may set the cost model")
    if args.audio_dir and args.beats == "known":
        parser.error("--beats known only works on synthetic songs")
    with tempfile.TemporaryDirectory(prefix="selecta-egress-") as temp:
        work = Path(temp)
        tracks = []
        if args.audio_dir:
            paths = sorted(p for p in args.audio_dir.iterdir() if p.suffix.lower() in AUDIO)
        else:
            paths, tracks = _synthetic(work, args.songs, args.bars)
        if args.beats == "known":
            analysers = lambda: Analysers(KnownBeats(tracks), None)  # noqa: E731
        else:
            analysers = None
        report = run(paths, work, analysers)
    report["audio"] = "real" if args.audio_dir else "synthetic"
    report["beats"] = args.beats
    text = json.dumps(report, indent=2)
    print(text)
    if args.report:
        args.report.write_text(text + "\n", "utf-8")
    if args.write_model:
        write_model(args.write_model, report["by_type"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
