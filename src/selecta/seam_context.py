"""What was true of two songs when a seam between them was made.

Stored in every seam record, so a rating keeps its context even after the library is corrected
or re-analysed.
"""

from __future__ import annotations

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo
from selecta.planner.fit import folded_gap


def pair_facts(script) -> dict:
    """What was true of the two songs when this seam was made. A rating without its context
    teaches almost nothing: the 4-bar and shaky-grid rules took 66 ratings to find because the
    records held no measurements. Kept at render time, so later library changes can't blur it."""
    a, b = script.a.song, script.b.song
    exit_bar = script.meta.get("exit_bar")
    entry_bar = script.meta.get("entry_bar")

    def local_energy(song: SongInfo, bar, before: bool) -> float | None:
        energy = song.energy_bars
        if bar is None or energy is None or energy.size == 0:
            return None
        chunk = energy[max(bar - 2, 0) : bar] if before else energy[bar : bar + 2]
        return float(chunk.mean()) if chunk.size else None

    exit_energy = local_energy(a, exit_bar, before=True)
    entry_energy = local_energy(b, entry_bar, before=False)
    return {
        "bpm": [round(a.bpm, 2), round(b.bpm, 2)],
        "gap": round(abs(a.bpm / b.bpm - 1.0), 4),
        "folded_gap": round(folded_gap(a, b), 4),
        "camelot": [a.camelot, b.camelot],
        "keys": camelot_distance(a.camelot, b.camelot),
        "grid": round(min(a.grid_confidence, b.grid_confidence), 3),
        "families": [a.family, b.family],
        "lufs_step": round(b.lufs - a.lufs, 2),
        "energy_step": (
            round(entry_energy - exit_energy, 3)
            if exit_energy is not None and entry_energy is not None
            else None
        ),
        "exit_section": a.section_label_at(exit_bar) if exit_bar is not None else None,
        "entry_section": b.section_label_at(entry_bar) if entry_bar is not None else None,
        "vocals_known": [bool(a.vocals_known), bool(b.vocals_known)],
    }
