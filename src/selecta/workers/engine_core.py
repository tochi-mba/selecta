"""A hosted seam chosen by the planner core, the Desktop's own loop (`cloud.hosted_brain`).

With the flag on, the server marks a `seam.render` job `"brain": "core"` and each side carries
the facts the engine store holds beyond the analysis file: the member's tempo and key correction
and the song's lyrics, if a device found them (`hosted_brain.side_facts`). The worker then:

- builds each `SongInfo` with `analysis.song.build_song`, the same function
  `engine_store.songs.load_song` uses, from the analysis arrays the song's facts were kept from;
- runs `planner.choose.choose_transition`: `planner_core.choose.enumerate_candidates`, then
  render, audit and `planner_core.repair.next_step` until a take is accepted, at most
  `MAX_REPAIRS` + 1 takes, then the fallback cut. Every take shares one `SongCache`, so each
  song is decoded once per job.

The server has no stems and no ears for voices (no separator runs in Cloud), so the loop runs
with `analysis.vocal_sense` bound off: moves that need vocal information are skipped, and a
blend longer than 4 bars is only offered when both songs' vocals are known from lyrics. That
is the planner core's own rule for songs whose vocals are unknown (`enumerate_candidates`).

Worst case per seam: 5 takes and 1 fallback cut, 6 renders (the older path, `engine_seams`,
could render 5 moves at 4 placements each, with a beat-tightening re-render each, and then the
cut's own loop: up to 46).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.render.engine import SongCache
from selecta.seam_kinds import MOVES, STEM_MOVES
from selecta.workers.context import InputInvalid
from selecta.workers.engine_seams import Take

ENGINE = "planner-core"
MARK = "core"
BAR_NAMES = ("energy_bars", "low_share_bars", "rms_db_bars", "chroma_bars", "mfcc_bars")


def facts_of(side: Mapping[str, Any]) -> dict[str, Any]:
    """The extra facts a side carries: `correction` ({bpm, camelot}) and `lyric` ({status,
    synced}), each None when there is none."""
    facts = side.get("facts") if isinstance(side.get("facts"), Mapping) else {}
    correction = facts.get("correction") if isinstance(facts.get("correction"), Mapping) else None
    lyric = facts.get("lyric") if isinstance(facts.get("lyric"), Mapping) else None
    return {"correction": dict(correction) if correction else None,
            "lyric": dict(lyric) if lyric else None}


def hash_part(a_side: Mapping[str, Any], b_side: Mapping[str, Any]) -> dict[str, str]:
    """What a core seam adds to its input hash: the mark and a digest of both sides' extra
    facts, so a correction or new lyrics make a new seam. The server and the worker both use
    this (`hosted_render.seam_hash`, `engine_handlers.render_seam`)."""
    text = json.dumps([facts_of(a_side), facts_of(b_side)], sort_keys=True)
    return {"brain": MARK, "facts": hashlib.sha256(text.encode()).hexdigest()}


def song_from_facts(
    analysis: Path, audio_path: Path, song_id: int, side: Mapping[str, Any]
) -> SongInfo:
    """A `SongInfo` as the engine store builds one (`build_song`), from a hosted analysis file
    and the side's correction and lyrics. Path is the worker's normalised copy of the upload."""
    from selecta.analysis.song import build_song, song_arrays

    try:
        with np.load(analysis) as data:
            summary = json.loads(str(data["summary"]))
            wanted = set(song_arrays())
            features = {
                "beats": data["beats"].astype(np.float64),
                "bar_starts": data["bar_starts"].astype(np.int32),
                **{name: data[name].astype(np.float32) for name in BAR_NAMES},
                **{name: data[name].astype(np.float32)
                   for name in ("pattern_bars", "swing_bars")
                   if name in data.files and name in wanted},
            }
    except (OSError, ValueError, KeyError) as error:
        raise InputInvalid("An analysis file is unreadable.") from error
    genre = side.get("genre") if isinstance(side.get("genre"), str) else None
    row = {
        "id": song_id, "path": str(audio_path),
        "artist": str(side.get("artist") or "Unknown artist"),
        "title": str(side.get("title") or "Untitled"), "genre": genre,
        "duration": float(summary["duration"]), "bpm": summary["bpm"],
        "constant_tempo": summary["constant_tempo"],
        "grid_confidence": summary["grid_confidence"],
        "beats_per_bar": summary["beats_per_bar"], "camelot": summary["camelot"],
        "key_confidence": summary["key_confidence"], "lufs": summary["lufs"],
        "peak_db": summary["peak_db"], "energy": summary["energy"],
        "sections": json.dumps(summary["sections"]),
    }
    extra = facts_of(side)
    correction = extra["correction"]
    if correction is not None:
        correction = {"bpm": correction.get("bpm"), "camelot": correction.get("camelot")}
    lyric = extra["lyric"]
    if lyric is not None:
        lyric = {"status": lyric.get("status"), "synced": lyric.get("synced")}
    return build_song(row, features, lyric, correction)


def _all_flags_with(changes: Mapping[str, bool]) -> dict[str, bool]:
    """Every flag as this job sees it now (the runner binds the account's answers), changed."""
    from selecta import flags

    return {**{flag_id: flags.on(flag_id) for flag_id in flags.effective()}, **changes}


def core_seam(
    a: SongInfo, b: SongInfo, style: str | None = None, *, cache: SongCache | None = None
) -> Take:
    """The planner core's choice for this pair (module notes). `style` narrows the candidates
    to one move, as the Desktop's `choose_transition(a, b, style)` does, when it names a move
    the core can plan that has a place here; otherwise every move is weighed."""
    from selecta import flags
    from selecta.planner.choose import choose_transition, enumerate_candidates
    from selecta.planner_core.recipes import all_recipes

    cache = cache or SongCache()
    with flags.bound(_all_flags_with({"analysis.vocal_sense": False})):
        asked = style if style in all_recipes() else None
        if asked is not None and not enumerate_candidates(a, b, asked):
            asked = None
        choice = choose_transition(a, b, asked, cache=cache)
    tried = [
        {"move": attempt.candidate.recipe.name,
         "why": "no script there" if attempt.report is None
         else ", ".join(check.name for check in attempt.report.failures)}
        for attempt in choice.attempts
        if attempt.report is None or not attempt.report.passed
    ]
    skipped = sorted(STEM_MOVES & set(MOVES))
    why = "; ".join(choice.candidate.reasons)
    return Take(choice.rendered, choice.report, choice.candidate.recipe.name, why,
                choice.fell_back, tried, skipped)


def renders_at_most() -> int:
    """The most renders one core seam can make: every take the rule allows, and the cut."""
    from selecta.planner_core.repair import MAX_REPAIRS

    return MAX_REPAIRS + 1 + 1


__all__ = ["ENGINE", "MARK", "core_seam", "facts_of", "hash_part", "renders_at_most",
           "song_from_facts"]
