"""Which moves and senses this build has turned on. Flag reads only, so every studio agrees."""

from __future__ import annotations

from selecta import flags

STUDIO_SESSION = "studio_session"

# The flag each move answers to. "auto" has none: letting Selecta pick is always possible, since
# a cut is core and can't be turned off.
MOVE_FLAGS = {
    "cut_on_one": "move.cut",
    "bass_swap_blend": "move.bass_swap_blend",
    "vocal_ride": "move.vocal_ride",
    "filter_sweep": "move.filter_sweep",
    "tempo_ramp": "move.tempo_ramp",
    "echo_out": "move.echo_out",
    "delay_throw": "move.delay_throw",
    "reverb_wash": "move.reverb_wash",
    "word_cut": "move.word_cut",
    "word_blend": "move.word_blend",
    "phrase_roll": "move.phrase_roll",
    "word_exchange": "move.call_and_response",
    "stem_arrange": "move.strip_and_land",
    "stem_intertwine": "move.intertwined_stems",
    "stem_studio": "stem_studio",
    STUDIO_SESSION: "stem_studio",
}


def move_on(move: str) -> bool:
    """Whether this build can make the move. One that isn't a move at all is left for whatever
    checks names to refuse."""
    flag = MOVE_FLAGS.get(move)
    return flag is None or flags.on(flag)


def sense_on() -> bool:
    """Whether a studio may listen to separated voices for singing, so a song without lyrics can
    still earn a long blend. The listening itself happens in the studio."""
    return flags.on("analysis.vocal_sense") and flags.on("stems")
