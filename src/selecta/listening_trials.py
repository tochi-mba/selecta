"""Blind trials for a move still behind its flag: the new move against what the planner would
otherwise have chosen, for the same two songs from the owner's own library.

Each trial is two renders of one pair with the same amount of each song around the transition,
one planned with the move's flag on and one with it off, written as WAV files and as a manifest
`selecta listening-import` reads. With `register`, they go straight into the Workshop's blind
listening (`listening.register_comparison`), which hides which is which.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np

from selecta import flags
from selecta.planner_core.moves import MOVE_FLAGS

TRIAL_MOVES = ("loop_room", "tempo_bridge")
BEFORE_SECONDS = 12.0
AFTER_SECONDS = 16.0
SEARCH_PAIRS = 4000
"""Pairs looked at for each trial found; planning a pair takes milliseconds, rendering seconds."""


def _pairs(songs: list, rng: np.random.Generator):
    for _ in range(SEARCH_PAIRS):
        a, b = rng.choice(len(songs), 2, replace=False)
        yield songs[int(a)], songs[int(b)]


def _chooses(move: str, a, b) -> bool:
    """Whether the planner, with the move on, would try it first for this pair."""
    from selecta.planner_core.choose import enumerate_candidates

    with flags.bound({MOVE_FLAGS[move]: True}):
        found = enumerate_candidates(a, b, exits=a.exit_cues()[:4], entries=b.entry_cues()[:5])
    return bool(found) and found[0].recipe.name == move


def _render(a, b, move_on: bool, flag: str, cache, path: Path) -> str:
    """Plan and render the pair with the flag as given; write it in context; name the move."""
    import soundfile as sf

    from selecta.config import SAMPLE_RATE
    from selecta.planner.choose import choose_transition
    from selecta.render.engine import in_context

    with flags.bound({flag: move_on}):
        choice = choose_transition(a, b, cache=cache)
    heard, _ = in_context(choice.rendered, BEFORE_SECONDS, AFTER_SECONDS, cache)
    sf.write(path, heard, SAMPLE_RATE, subtype="PCM_16")
    return choice.candidate.recipe.name + (" (fallback)" if choice.fell_back else "")


def move_trials(
    conn,
    settings,
    move: str,
    count: int,
    register: bool = False,
    seed: int = 7,
    log: Callable[[str], None] = print,
) -> list[dict]:
    """Up to `count` trials of `move`, each written under the home folder's `move-trials`.
    Returns their manifests. A pair where both renders end up the same move is skipped."""
    from selecta.planner.reel import load_library
    from selecta.render.engine import SongCache
    from selecta.seam_kinds import RENDER_VERSION

    if move not in TRIAL_MOVES:
        raise ValueError(f"Trials are for {', '.join(TRIAL_MOVES)}, not {move!r}.")
    flag = MOVE_FLAGS[move]
    out = settings.home / "move-trials" / move
    out.mkdir(parents=True, exist_ok=True)
    songs = load_library(conn, settings)
    if len(songs) < 2:
        return []
    cache = SongCache(capacity=6)
    made: list[dict] = []
    tried: set[tuple[int, int]] = set()
    for a, b in _pairs(songs, np.random.default_rng(seed)):
        if len(made) >= count:
            break
        if (a.id, b.id) in tried or not _chooses(move, a, b):
            continue
        tried.add((a.id, b.id))
        pair = f"{a.id}-{b.id}"
        new_path, old_path = out / f"{pair}-{move}.wav", out / f"{pair}-planner.wav"
        new_move = _render(a, b, True, flag, cache, new_path)
        old_move = _render(a, b, False, flag, cache, old_path)
        if new_move == old_move:
            log(f"  {a.name} into {b.name}: both came out {new_move}, skipped")
            continue
        context = (
            f"song {a.id} into song {b.id}, {BEFORE_SECONDS:g} s before and "
            f"{AFTER_SECONDS:g} s after the transition clip"
        )
        manifest = {
            "study": f"{move}-trial",
            "pair": pair,
            "conditions": [
                {
                    "path": str(new_path),
                    "context": context,
                    "renderer": f"render-{RENDER_VERSION}",
                    "method": new_move,
                },
                {
                    "path": str(old_path),
                    "context": context,
                    "renderer": f"render-{RENDER_VERSION}",
                    "method": old_move,
                },
            ],
        }
        (out / f"{pair}.json").write_text(json.dumps(manifest, indent=2), "utf-8")
        if register:
            from selecta.listening import register_comparison

            register_comparison(conn, settings, manifest["study"], pair, manifest["conditions"])
        log(f"  {a.name} into {b.name}: {new_move} against {old_move}")
        made.append(manifest)
    return made
