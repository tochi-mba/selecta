"""Read-only, exact playable cached transitions and strict ready-only path selection.

SeamMemory contains historical evidence even after eviction; it must NEVER back this graph.
All work here is bounded and read-only. Creating an approved draft is a separate operation.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import soundfile as sf

from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE
from selecta.planner.memory import RULES_VERSION
from selecta.seam_kinds import STUDIO_SESSION, SeamRequest


@dataclass(frozen=True)
class ReadyEdge:
    a: int
    b: int
    key: str
    settings: dict
    style: str
    a_source_start: float
    b_source_end: float
    duration: float

    def visible(self) -> dict:
        return {
            "a": self.a,
            "b": self.b,
            "key": self.key,
            "requested": self.settings["move"],
            "rendered": self.style,
            "a_source_start": self.a_source_start,
            "b_source_end": self.b_source_end,
            "duration": self.duration,
            "status": "already_rendered",
            "passed": True,
        }


def current_recordings(conn: sqlite3.Connection, songs: list[Any]) -> dict[int, Any]:
    """Only existing, unchanged, eligible sources with current analysis can enter the graph."""
    by_id = {song.id: song for song in songs}
    valid = {}
    rows = conn.execute(
        "SELECT s.id,s.path,s.size,s.mtime,a.version FROM songs s "
        "JOIN analysis a ON a.song_id=s.id "
        "WHERE s.is_music=1 AND s.duplicate_of IS NULL AND a.error IS NULL"
    )
    for row in rows:
        song = by_id.get(row["id"])
        if song is None or row["version"] != ANALYSIS_VERSION:
            continue
        try:
            stat = Path(row["path"]).stat()
        except OSError:
            continue
        if stat.st_size != row["size"] or abs(stat.st_mtime - row["mtime"]) > 0.02:
            continue
        valid[song.id] = song
    return valid


def _decodable(clip: Path, duration: float) -> bool:
    """Verify audio on disk, not a historical ready flag or a directory name."""
    try:
        with sf.SoundFile(clip) as audio:
            if (
                audio.samplerate != SAMPLE_RATE
                or audio.channels != 2
                or audio.frames <= 0
                or not math.isfinite(duration)
                or abs(audio.frames / SAMPLE_RATE - duration) > 0.5
            ):
                return False
            # Read from both ends; opening a truncated/corrupt file is not enough.
            if len(audio.read(min(256, audio.frames))) == 0:
                return False
            audio.seek(max(0, audio.frames - 256))
            return len(audio.read(256)) > 0
    except (OSError, RuntimeError, ValueError):
        return False


def ready_inventory(store: Any, songs: dict[int, Any]) -> tuple[dict[int, list[ReadyEdge]], dict]:
    """One O(cached seams) directory scan; never traverse song pairs or read SeamMemory.

    A ready edge has the exact directed request key, verified source identities,
    a current passed audit, a valid on-disk stereo clip and usable cue bounds.
    """
    adjacency: dict[int, list[ReadyEdge]] = defaultdict(list)
    scanned = 0
    for meta in store.root.glob("*/seam.json"):
        scanned += 1
        try:
            state = json.loads(meta.read_text(encoding="utf-8"))
            requested = state["request"]
            if not isinstance(requested, dict):
                continue
            request = SeamRequest(**requested)
            a, b = songs.get(request.a), songs.get(request.b)
            if (
                a is None
                or b is None
                or request.a == request.b
                or request.move == STUDIO_SESSION
                or state.get("status") != "ready"
                or state.get("key") != request.key
                or meta.parent.name != request.key
                or state.get("rules") != RULES_VERSION
                or state.get("passed") is not True
                or state.get("near_miss") is True
                or state.get("rating") == "bad"
                or not state.get("style")
                or (request.move != "auto" and state["style"] != request.move)
            ):
                continue
            out_at = float(state["a_source_start"])
            in_at = float(state["b_source_end"])
            duration = float(state["duration"])
            if not all(map(math.isfinite, (out_at, in_at, duration))):
                continue
            if not (0 <= out_at <= a.duration and 0 < in_at <= b.duration and duration > 0):
                continue
            if not _decodable(meta.parent / "clip.flac", duration):
                continue
            settings = {k: v for k, v in asdict(request).items() if k not in {"a", "b"}}
            adjacency[request.a].append(
                ReadyEdge(request.a, request.b, request.key, settings, state["style"],
                          out_at, in_at, duration)
            )
        except (OSError, ValueError, TypeError, KeyError, OverflowError):
            # Concurrent eviction, partial metadata, malformed request, or bad audio.
            continue
    for edges in adjacency.values():
        edges.sort(key=lambda edge: (edge.b, edge.key))
    return dict(adjacency), {
        "candidate_tracks": len(songs),
        "seams_examined": scanned,
        "verified_ready_edges": sum(map(len, adjacency.values())),
    }


def _compatible(previous: ReadyEdge | None, edge: ReadyEdge) -> bool:
    """An incoming transition must finish before the next one leaves the same song."""
    if previous is None:
        return True
    # The normal mix engine protects at least an eight-second late stay.
    return edge.a_source_start + 1e-6 >= previous.b_source_end + 8.0


def validate_path(
    ids: list[int],
    keys: list[str],
    adjacency: dict[int, list[ReadyEdge]],
    songs: dict[int, Any],
) -> list[ReadyEdge]:
    """Resolve exactly what the person approved; do not replan or silently replace seams."""
    if not 1 <= len(ids) <= 100 or len(set(ids)) != len(ids) or len(keys) != len(ids) - 1:
        raise ValueError("The approved order or seam count is invalid.")
    if any(song_id not in songs for song_id in ids):
        raise ValueError("A song is no longer available with current analysis.")
    chosen: list[ReadyEdge] = []
    for a, b, key in zip(ids, ids[1:], keys, strict=False):
        edge = next(
            (edge for edge in adjacency.get(a, ()) if edge.b == b and edge.key == key),
            None,
        )
        if edge is None:
            raise ValueError("A previously ready transition is no longer playable.")
        if not _compatible(chosen[-1] if chosen else None, edge):
            raise ValueError("The approved transition cues would skip part of a song.")
        chosen.append(edge)
    return chosen


def plan_ready_path(
    adjacency: dict[int, list[ReadyEdge]],
    songs: dict[int, Any],
    count: int,
    start: int | None = None,
    end: int | None = None,
    max_steps: int = 50000,
) -> tuple[list[int], list[ReadyEdge], int, bool]:
    """Bounded DFS for an entire directed, cue-compatible simple path.

    Reports the longest seen path and whether a finite search budget was exhausted;
    never claims global infeasibility from a truncated search.
    """
    if not 1 <= count <= 100:
        raise ValueError("Choose between 1 and 100 songs.")
    if start is not None and start not in songs:
        raise ValueError("The starting song is not mix-ready.")
    if end is not None and end not in songs:
        raise ValueError("The destination song is not mix-ready.")
    if count > 1 and start is not None and end == start:
        raise ValueError("A mix cannot repeat its starting song as the destination.")
    if not songs:
        return [], [], 0, False
    if count == 1:
        chosen = end if end is not None else start
        if chosen is None:
            chosen = min(songs)
        return [chosen], [], 1, False

    starts = [start] if start is not None else sorted(
        songs, key=lambda song_id: (-len(adjacency.get(song_id, ())), song_id)
    )
    steps = 0
    best = 0
    limited = False

    def walk(ids: list[int], edges: list[ReadyEdge], used: set[int], artists: list[str]):
        nonlocal steps, best, limited
        best = max(best, len(ids))
        if len(ids) == count:
            return (ids.copy(), edges.copy()) if end is None or ids[-1] == end else None
        for edge in adjacency.get(ids[-1], ()):
            if steps >= max_steps:
                limited = True
                return None
            steps += 1
            if edge.b in used or (end is not None and edge.b == end and len(ids) != count - 1):
                continue
            if not _compatible(edges[-1] if edges else None, edge):
                continue
            artist = (songs[edge.b].artist or "").strip().casefold()
            if artist and artist != "unknown artist" and artist in artists[-10:]:
                continue
            ids.append(edge.b)
            edges.append(edge)
            used.add(edge.b)
            result = walk(ids, edges, used, [*artists, artist])
            if result:
                return result
            used.remove(edge.b)
            edges.pop()
            ids.pop()
            if limited:
                return None
        return None

    for first in starts:
        artist = (songs[first].artist or "").strip().casefold()
        match = walk([first], [], {first}, [artist])
        if match:
            return *match, best, False
        if limited:
            break
    return [], [], best, limited
