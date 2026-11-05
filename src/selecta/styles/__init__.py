"""Transition recipes. Each one is a small function that returns a TransitionScript."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import TransitionScript


class MakeScript(Protocol):
    def __call__(
        self, a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int, **options
    ) -> TransitionScript | None: ...


@dataclass(frozen=True)
class Recipe:
    name: str
    make: MakeScript
    beatmatched: bool
    lengths: tuple[int, ...] = (0,)
    needs_vocal_info: bool = False
    max_gap: float | None = None
    description: str = ""
    options: dict = field(default_factory=dict)


def all_recipes() -> dict[str, Recipe]:
    """Recipes the planner can pick from bar cues. Word cuts need word timing from a lyric link,
    so `selecta.styles.wordplay` is reached through the word-link search instead."""
    from selecta.styles.blend import bass_swap_blend, filter_sweep, tempo_ramp
    from selecta.styles.exits import cut_on_one, delay_throw, echo_out, reverb_wash

    recipes = [
        Recipe("cut_on_one", cut_on_one, False, description="Cut on the downbeat"),
        Recipe("echo_out", echo_out, False, description="Echo A out, B lands under the tail"),
        Recipe(
            "delay_throw",
            delay_throw,
            False,
            needs_vocal_info=True,
            description="Throw A's last word into a delay, then slam B in",
        ),
        Recipe("reverb_wash", reverb_wash, False, description="Wash A in reverb as B arrives"),
        Recipe(
            "bass_swap_blend",
            bass_swap_blend,
            True,
            lengths=(4, 8, 16, 32),
            description="Beatmatched blend, trading the bass on a phrase line",
        ),
        Recipe(
            "filter_sweep",
            filter_sweep,
            True,
            lengths=(8, 16),
            description="A filters up and away as B opens up",
        ),
        Recipe(
            "tempo_ramp",
            tempo_ramp,
            True,
            lengths=(4,),
            max_gap=0.16,
            description="Ride both songs to a shared tempo for a short overlap",
        ),
    ]
    return {recipe.name: recipe for recipe in recipes}
