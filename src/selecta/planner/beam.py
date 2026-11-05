"""Rolling beam search over songs; transition feasibility is part of every edge."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.planner.arc import target_energy
from selecta.planner.choose import enumerate_candidates, styles_for_language


@dataclass(frozen=True)
class PlannedSong:
    song: SongInfo
    transition: str | None
    reason: str


def _edge(
    a: SongInfo,
    b: SongInfo,
    progress: float,
    recent: list[SongInfo],
    allowed_styles: set[str] | None,
) -> tuple[float, str] | None:
    if a.artist.casefold() == b.artist.casefold() or any(x.id == b.id for x in recent):
        return None
    candidates = enumerate_candidates(a, b)
    if allowed_styles is not None:
        candidates = [
            candidate for candidate in candidates if candidate.recipe.name in allowed_styles
        ]
    candidates = candidates[:1]
    if not candidates:
        return None
    transition = candidates[0]
    arc = 1 - abs(b.energy - target_energy(progress))
    timbre = 1.0
    if a.chroma_bars is not None and b.chroma_bars is not None:
        timbre = 1 - min(1.0, float(np.linalg.norm(a.chroma_bars.mean(0) - b.chroma_bars.mean(0))))
    tempo = max(0.0, 1 - abs(a.bpm / b.bpm - 1) / 0.3)
    score = 0.25 * arc + 0.2 * timbre + 0.2 * transition.score + 0.15 * tempo + 0.2
    return score, transition.recipe.name


def plan_set(
    songs: list[SongInfo],
    start_id: int | None = None,
    count: int = 20,
    width: int = 8,
    mix_language: str = "balanced",
    stems: str = "sometimes",
) -> list[PlannedSong]:
    if not songs:
        return []
    first = next((x for x in songs if x.id == start_id), songs[0])
    allowed_styles = styles_for_language(mix_language, stems)
    beams: list[tuple[float, list[PlannedSong]]] = [
        (0.0, [PlannedSong(first, None, "You started here")])
    ]
    for step in range(1, min(count, len(songs))):
        expanded = []
        for total, path in beams:
            current = path[-1].song
            shortlist = sorted(songs, key=lambda s: abs(s.energy - target_energy(step / count)))[
                :50
            ]
            for song in shortlist:
                edge = _edge(
                    current,
                    song,
                    step / count,
                    [x.song for x in path[-10:]],
                    allowed_styles,
                )
                if edge:
                    score, style = edge
                    reason = f"{style.replace('_', ' ')}; follows the energy arc"
                    expanded.append((total + score, path + [PlannedSong(song, style, reason)]))
        if not expanded:
            break
        beams = sorted(expanded, key=lambda x: -x[0])[:width]
    return beams[0][1]
