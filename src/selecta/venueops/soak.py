"""Long-session soak and chaos harness (ADR-0437, AV-0437-02, AV-0437-04 and AV-0437-05).

Runs one venue workload (`selecta.venueops.workloads`) through a night and writes what happened
to a JSON evidence file:

- gaps (ms), unplanned overlaps and duplicate plays, judged by the continuity targets in
  `selecta.venueops.continuity`;
- seams that missed their deadline, background jobs preempted for audio work, and the depth of
  the render queue, from a render-queue model that applies `audio_priority` (or plain first come
  first served with `--no-priority`, as the baseline);
- CPU, resident memory, open handles and threads, sampled with psutil from this process or from
  a running SelectaDJ server (`--pid`).

Chaos mode injects adverse cases on purpose: network loss, slow render, model timeout, disk full,
clock jump and speaker drop. The continuity side of chaos reuses `faults.simulate_night`
(fallback songs, fenced speaker failover) from ADR-0429, so this harness and the rehearsal judge
a night by the same rules.

Three ways to run it, each labelled honestly in the evidence file:

- simulated (default): the night runs on a simulated clock, six hours in about a second;
- real time (`--realtime`, optionally `--speed`): the clock follows the wall clock, so resource
  samples of a live server cover the whole run;
- played log (`--plays log.json`): judge a real night's play log captured from speakers.

None of these is real-audio proof on its own. A named-hardware soak with real speakers is a
person step (docs/autopilot/six-hour-soak-protocol.md); this tool records and judges its numbers.

    python -m selecta.venueops.soak --workload bar-evening-6h --minutes 360 --out <dir>
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags
from selecta.venueops import audio_priority as ap
from selecta.venueops.continuity import Play, evaluate
from selecta.venueops.workloads import Event, Workload, get, schedule, zone_ids

FLAG = "venue.soak"
CHAOS_FLAG = "venue.fault_injection"
SCHEMA = "selecta.venue-soak/1"

CHAOS_KINDS = (
    "network_loss", "slow_render", "model_timeout", "disk_full", "clock_jump", "speaker_drop",
)
# Reference seconds of work per job, before any slow-render factor.
COSTS = {"seam.render": 30.0, "plan": 3.0, "analysis": 40.0, "discovery": 60.0, "export": 300.0}
SEAM_LEAD_S = 240.0  # a seam can start rendering this long before its song
PLAN_DEADLINE_S = 60.0  # a request re-plans the next seam within a minute
# Provisional resource limits for a pass; confirm against the first named-hardware soak.
LIMITS = {"rss_growth_mb_per_hour": 50.0, "handle_growth": 200, "thread_growth": 20}


@dataclass(frozen=True)
class Chaos:
    kind: str
    at_s: float
    duration_s: float
    factor: float = 4.0  # slow_render: how many times slower; clock_jump: unused

    def active(self, t: float) -> bool:
        return self.at_s <= t < self.at_s + self.duration_s


def parse_chaos(text: str | None, night_s: float) -> list[Chaos]:
    """`all`, or a comma list of `kind@start+duration[xfactor]` in seconds of night clock."""
    if not text:
        return []
    if text.strip() == "all":
        return default_chaos(night_s)
    found: list[Chaos] = []
    for item in text.split(","):
        item = item.strip()
        kind, _, rest = item.partition("@")
        if kind not in CHAOS_KINDS or not rest:
            raise ValueError(f"Can't read chaos {item!r}; kinds are {', '.join(CHAOS_KINDS)}.")
        start, _, rest = rest.partition("+")
        length, _, factor = rest.partition("x")
        found.append(Chaos(kind, float(start), float(length or 60), float(factor or 4.0)))
    return found


def default_chaos(night_s: float) -> list[Chaos]:
    """One of each adverse case, spread across the run so their effects don't hide each other."""
    span = max(60.0, min(300.0, night_s * 0.04))
    return [
        Chaos(kind, round(night_s * (n + 1) / (len(CHAOS_KINDS) + 1), 1), span)
        for n, kind in enumerate(CHAOS_KINDS)
    ]


# --- Resources -------------------------------------------------------------------------------


class ResourceSampler:
    """CPU, memory, handles and threads of one process, read with psutil."""

    def __init__(self, pid: int | None = None) -> None:
        import psutil

        self.pid = pid or os.getpid()
        self.process = psutil.Process(self.pid)
        self.process.cpu_percent(None)
        self.samples: list[dict] = []

    def sample(self, night_s: float) -> dict:
        proc = self.process
        with proc.oneshot():
            handles = proc.num_handles() if hasattr(proc, "num_handles") else proc.num_fds()
            row = {
                "night_s": round(night_s, 1),
                "cpu_percent": round(proc.cpu_percent(None), 1),
                "rss_mb": round(proc.memory_info().rss / 1_048_576, 1),
                "handles": int(handles),
                "threads": proc.num_threads(),
            }
        self.samples.append(row)
        return row

    def summary(self, hours: float) -> dict:
        if not self.samples:
            return {"samples": 0}
        first, last = self.samples[0], self.samples[-1]
        growth = last["rss_mb"] - first["rss_mb"]
        # A growth rate over less than half an hour of wall time says nothing; leave it out.
        rate = round(growth / hours, 2) if hours >= 0.5 else None
        out = {
            "samples": len(self.samples),
            "cpu_percent_max": max(s["cpu_percent"] for s in self.samples),
            "rss_mb_max": max(s["rss_mb"] for s in self.samples),
            "rss_growth_mb": round(growth, 1),
            "rss_growth_mb_per_hour": rate,
            "handles_max": max(s["handles"] for s in self.samples),
            "handle_growth": last["handles"] - first["handles"],
            "thread_growth": last["threads"] - first["threads"],
        }
        out["within_limits"] = (
            (rate is None or rate <= LIMITS["rss_growth_mb_per_hour"])
            and out["handle_growth"] <= LIMITS["handle_growth"]
            and out["thread_growth"] <= LIMITS["thread_growth"]
        )
        return out


# --- Render queue ----------------------------------------------------------------------------


@dataclass
class _Work:
    job: ap.Job
    remaining_s: float
    zone_id: str = "main"
    song_index: int = -1


@dataclass
class QueueResult:
    missed_seams: list[tuple[str, int]] = field(default_factory=list)  # (zone, song index)
    seams_done: int = 0
    preemptions: int = 0
    background_done: dict[str, int] = field(default_factory=dict)
    background_failed: dict[str, int] = field(default_factory=dict)
    requests_failed: int = 0
    plans_blocked: set[str] = field(default_factory=set)
    disk_write_failures: int = 0
    depth: list[int] = field(default_factory=list)
    worst_audio_wait_s: float = 0.0

    def as_dict(self) -> dict:
        depth = sorted(self.depth) or [0]
        return {
            "missed_seams": len(self.missed_seams),
            "seams_done": self.seams_done,
            "preemptions": self.preemptions,
            "background_done": self.background_done,
            "background_failed": self.background_failed,
            "requests_failed_and_told": self.requests_failed,
            "plans_blocked_by_model": len(self.plans_blocked),
            "disk_write_failures": self.disk_write_failures,
            "render_queue_max": depth[-1],
            "render_queue_p95": depth[int(0.95 * (len(depth) - 1))],
            "worst_audio_wait_s": round(self.worst_audio_wait_s, 1),
        }


def run_queue(
    events: Sequence[Event],
    night_s: float,
    *,
    slots: int = 2,
    priority: bool = True,
    chaos: Sequence[Chaos] = (),
    tick: Callable[[float], None] | None = None,
) -> QueueResult:
    """Step the render queue through the night one simulated second at a time."""
    result = QueueResult()
    arrivals: list[_Work] = []
    seam_index: dict[str, int] = {}
    for event in events:
        if event.kind == "song":
            index = seam_index.get(event.zone_id, -1) + 1
            seam_index[event.zone_id] = index
            if index == 0:
                continue  # the first song has no seam into it
            job = ap.Job(f"seam-{event.zone_id}-{index}", "seam.render", event.at_s,
                         max(0.0, event.at_s - SEAM_LEAD_S))
            arrivals.append(_Work(job, COSTS["seam.render"], event.zone_id, index))
        elif event.kind == "request":
            job = ap.Job(f"plan-{event.at_s:.1f}", "plan", event.at_s + PLAN_DEADLINE_S,
                         event.at_s)
            arrivals.append(_Work(job, COSTS["plan"]))
        elif event.kind in ("analysis", "discovery", "export"):
            job = ap.Job(f"{event.kind}-{event.at_s:.1f}", event.kind, None, event.at_s)
            arrivals.append(_Work(job, COSTS[event.kind]))
    arrivals.sort(key=lambda w: (w.job.arrived_s, w.job.id))

    def chaos_on(kind: str, t: float) -> Chaos | None:
        return next((c for c in chaos if c.kind == kind and c.active(t)), None)

    waiting: list[_Work] = []
    running: list[_Work] = []
    next_arrival = 0
    t = 0.0
    while t < night_s:
        while next_arrival < len(arrivals) and arrivals[next_arrival].job.arrived_s <= t:
            work = arrivals[next_arrival]
            next_arrival += 1
            kind = work.job.job_type
            if chaos_on("network_loss", t) and (kind == "plan" or kind == "discovery"):
                if kind == "plan":
                    result.requests_failed += 1  # the guest is told it couldn't be added
                else:
                    result.background_failed[kind] = result.background_failed.get(kind, 0) + 1
                continue
            waiting.append(work)
        # Seams whose song has started without them fall back to a hard cut.
        for pool in (waiting, running):
            for work in list(pool):
                deadline = work.job.deadline_s
                if work.job.job_type == "seam.render" and deadline is not None and t >= deadline:
                    pool.remove(work)
                    result.missed_seams.append((work.zone_id, work.song_index))
        model_down = chaos_on("model_timeout", t) is not None
        startable = [w for w in waiting if not (model_down and w.job.job_class.audio
                                                and w.job.job_type != "playback")]
        if model_down:
            result.plans_blocked.update(w.job.id for w in waiting if w.job.job_type == "plan")
        if priority and len(running) >= slots:
            victim = ap.preemption_victim([w.job for w in running], [w.job for w in startable])
            if victim is not None:
                work = next(w for w in running if w.job is victim)
                running.remove(work)
                waiting.append(work)
                result.preemptions += 1
        while len(running) < slots and startable:
            jobs = [w.job for w in startable]
            free = slots - len(running)
            chosen = (ap.pick_next(jobs, free_slots=free, now_s=t) if priority
                      else ap.fifo_pick(jobs, free_slots=free))
            if chosen is None:
                break
            work = next(w for w in startable if w.job is chosen)
            startable.remove(work)
            waiting.remove(work)
            running.append(work)
            if work.job.job_class.audio:
                result.worst_audio_wait_s = max(result.worst_audio_wait_s,
                                                t - work.job.arrived_s)
        slow = chaos_on("slow_render", t)
        disk_full = chaos_on("disk_full", t) is not None
        for work in list(running):
            rate = 1.0 / slow.factor if slow and work.job.job_type != "plan" else 1.0
            work.remaining_s -= rate
            if work.remaining_s > 0:
                continue
            running.remove(work)
            kind = work.job.job_type
            if disk_full and kind != "plan":
                # The output can't be written: the job retries from scratch.
                result.disk_write_failures += 1
                work.remaining_s = COSTS[kind]
                waiting.append(work)
            elif kind == "seam.render":
                result.seams_done += 1
            elif kind != "plan":
                result.background_done[kind] = result.background_done.get(kind, 0) + 1
        if int(t) % 60 == 0:
            result.depth.append(len(waiting) + len(running))
        if tick is not None:
            tick(t)
        t += 1.0
    return result


# --- Timeline --------------------------------------------------------------------------------


def build_plays(
    events: Sequence[Event], workload: Workload, night_s: float, missed: set[tuple[str, int]]
) -> list[Play]:
    """Songs as they reached the speakers. A missed seam is a hard cut: no blend, no gap."""
    plays: list[Play] = []
    index: dict[str, int] = {}
    for event in events:
        if event.kind != "song" or event.at_s >= night_s:
            continue
        i = index.get(event.zone_id, -1) + 1
        index[event.zone_id] = i
        blend = 0.0 if i == 0 else workload.blend_s
        start = event.at_s
        if i > 0 and (event.zone_id, i) in missed:
            start, blend = event.at_s + workload.blend_s, 0.0
        end = min(event.at_s + event.length_s, night_s)
        if end > start:
            plays.append(Play(event.song_id or "?", start, end, f"speaker-{event.zone_id}",
                              event.zone_id, blend, "plan"))
    return plays


def chaos_timeline(
    events: Sequence[Event], workload: Workload, night_s: float, chaos: Sequence[Chaos],
    missed: set[tuple[str, int]], seed: int,
) -> tuple[list[Play], dict]:
    """The main zone through `faults.simulate_night`, so fallbacks and failover are exercised."""
    from selecta.venueops import faults as fx

    kinds = {"network_loss": fx.FaultKind.NETWORK, "model_timeout": fx.FaultKind.MODEL,
             "disk_full": fx.FaultKind.RENDER, "speaker_drop": fx.FaultKind.SPEAKER_DROP}
    injected = [fx.Fault(kinds[c.kind], c.at_s, c.duration_s) for c in chaos if c.kind in kinds]
    starts = {(e.zone_id, i): e.at_s for i, e in enumerate(
        [e for e in events if e.kind == "song" and e.zone_id == "main"])}
    for zone, i in missed:
        if zone == "main" and (zone, i) in starts:
            injected.append(fx.Fault(fx.FaultKind.RENDER, max(0.0, starts[(zone, i)] - 1.0), 2.0))
    injected.sort(key=lambda f: (f.at_s, f.kind.value))
    songs = [fx.Song(e.song_id or "?", e.length_s) for e in events
             if e.kind == "song" and e.zone_id == "main"]
    night = fx.simulate_night(
        songs, fx.demo_library(40, "fallback", seed=seed), hours=night_s / 3600.0, seed=seed,
        faults=fx.FaultPlan(seed, night_s, tuple(injected)), blend_s=workload.blend_s,
    )
    return night.plays, {
        "recoveries": [{"fault": r.fault.value, "at_s": round(r.at_s, 1), "how": r.how}
                       for r in night.recoveries],
        "stale_speaker_commands_refused": night.stale_refused,
    }


# --- The run ---------------------------------------------------------------------------------


def _git_sha() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                             timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


def _gap_metrics(report) -> dict:
    gaps_ms = sorted(round(g.length_s * 1000) for g in report.gaps)
    return {
        "gap_count": len(gaps_ms),
        "gap_ms_max": gaps_ms[-1] if gaps_ms else 0,
        "gap_ms_total": sum(gaps_ms),
        "gaps_ms": gaps_ms[:200],
        "overlap_count": len(report.overlaps),
        "overlap_ms_total": round(sum(o.length_s for o in report.overlaps) * 1000),
        "duplicate_count": len(report.duplicates),
    }


def run(
    workload_id: str,
    minutes: float | None,
    out_dir: Path,
    *,
    seed: int = 437,
    chaos: str | None = None,
    priority: bool = True,
    slots: int = 2,
    realtime: bool = False,
    speed: float = 1.0,
    pid: int | None = None,
    workload: Workload | None = None,
) -> Path:
    """Run one soak and write its evidence file. Returns the file's path."""
    flags.require(FLAG)
    workload = workload or get(workload_id)
    night_s = min(workload.seconds, minutes * 60.0) if minutes else workload.seconds
    chaos_list = parse_chaos(chaos, night_s)
    if chaos_list:
        flags.require(CHAOS_FLAG)
    events = schedule(workload, seed, limit_s=night_s)
    sampler = ResourceSampler(pid)
    sampler.sample(0.0)
    wall_start = time.monotonic()
    sample_every = 3600.0 if not realtime else max(1.0, 30.0 * speed)

    def tick(t: float) -> None:
        if realtime:
            target = wall_start + t / speed
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        if t > 0 and t % sample_every == 0:
            sampler.sample(t)

    queue = run_queue(events, night_s, slots=slots, priority=priority, chaos=chaos_list,
                      tick=tick)
    sampler.sample(night_s)
    missed = set(queue.missed_seams)
    plays = build_plays(events, workload, night_s, missed)
    chaos_detail: dict = {}
    if chaos_list:
        main_plays, chaos_detail = chaos_timeline(events, workload, night_s, chaos_list,
                                                  missed, seed)
        plays = [p for p in plays if p.zone_id != "main"] + main_plays
        jump = next((c for c in chaos_list if c.kind == "clock_jump"), None)
        if jump is not None:
            # The harness schedules on the night clock only. Prove a wall-clock jump changes
            # nothing by running the queue again without it and comparing.
            again = run_queue(events, night_s, slots=slots, priority=priority,
                              chaos=[c for c in chaos_list if c.kind != "clock_jump"])
            chaos_detail["clock_jump"] = {
                "at_s": jump.at_s, "jump_s": jump.duration_s,
                "timeline_unchanged": again.as_dict() == queue.as_dict(),
            }
    report = evaluate(plays, 0.0, night_s, zones=zone_ids(workload))
    wall_hours = (time.monotonic() - wall_start) / 3600.0
    resources = sampler.summary(wall_hours)
    mode = "realtime" if realtime else "simulated"
    evidence = {
        "schema": SCHEMA,
        "tool": "selecta.venueops.soak",
        "created_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "git_sha": _git_sha(),
        "host": {"os": platform.system(), "release": platform.release(),
                 "python": platform.python_version(), "cpus": os.cpu_count()},
        "mode": mode,
        "speed": speed if realtime else None,
        "evidence_class": (
            "Simulated night: proves the scheduling and recovery logic, not real audio."
            if not realtime else
            "Real-time harness: resource samples are real for the sampled process; the play "
            "timeline is still simulated, so this is not real-audio evidence."
        ),
        "workload": workload.as_dict(),
        "seed": seed,
        "night_s": night_s,
        "priority": "audio_priority" if priority else "fifo",
        "slots": slots,
        "chaos": [c.__dict__ for c in chaos_list],
        "chaos_outcome": chaos_detail,
        "metrics": {**_gap_metrics(report), **queue.as_dict()},
        "continuity": report.as_dict(),
        "resources": {"pid_is_harness": pid is None, **resources,
                      "series": sampler.samples, "limits": LIMITS},
        "passed": report.passed and not queue.missed_seams and resources.get(
            "within_limits", True),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    tag = "chaos" if chaos_list else "soak"
    path = out_dir / f"{tag}-{workload.id}-{mode}-{stamp}-{seed}.json"
    path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return path


def judge_log(plays_path: Path, out_dir: Path, zones: Sequence[str] | None = None) -> Path:
    """Judge a real night's play log: a JSON list of plays as `continuity.Play` fields."""
    flags.require(FLAG)
    rows = json.loads(plays_path.read_text("utf-8"))
    plays = [Play(**row) for row in rows]
    if not plays:
        raise ValueError("The play log is empty.")
    start = min(p.start_s for p in plays)
    end = max(p.end_s for p in plays)
    report = evaluate(plays, start, end, zones=zones)
    evidence = {
        "schema": SCHEMA, "tool": "selecta.venueops.soak", "mode": "played-log",
        "created_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "git_sha": _git_sha(),
        "evidence_class": "A captured play log judged against the continuity targets.",
        "metrics": _gap_metrics(report), "continuity": report.as_dict(),
        "passed": report.passed,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"played-log-{stamp}.json"
    path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m selecta.venueops.soak",
                                     description="SelectaDJ venue soak and chaos harness.")
    parser.add_argument("--workload", default="bar-evening-6h")
    parser.add_argument("--minutes", type=float, default=None,
                        help="Cut the night to this many minutes of night clock.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=437)
    parser.add_argument("--chaos", default=None,
                        help="'all' or kind@start+duration[xfactor], comma separated.")
    parser.add_argument("--no-priority", action="store_true",
                        help="First come first served baseline instead of audio priority.")
    parser.add_argument("--slots", type=int, default=2)
    parser.add_argument("--realtime", action="store_true")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--pid", type=int, default=None,
                        help="Sample this process (a running server) instead of the harness.")
    parser.add_argument("--plays", type=Path, default=None,
                        help="Judge a captured play log instead of running a workload.")
    args = parser.parse_args(argv)
    try:
        if args.plays is not None:
            path = judge_log(args.plays, args.out)
        else:
            path = run(args.workload, args.minutes, args.out, seed=args.seed, chaos=args.chaos,
                       priority=not args.no_priority, slots=args.slots,
                       realtime=args.realtime, speed=args.speed, pid=args.pid)
    except flags.FlagOff as error:
        print(f"{error} Set SELECTA_FLAGS='+autopilot.venue_mode +venue.continuity "
              "+venue.soak +venue.fault_injection' to run it.", file=sys.stderr)
        return 2
    data = json.loads(path.read_text("utf-8"))
    print(f"{'PASS' if data['passed'] else 'FAIL'} {path.name}")
    return 0 if data["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
