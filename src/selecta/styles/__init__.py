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
    description: str = ""
    options: dict = field(default_factory=dict)


def all_recipes() -> dict[str, Recipe]:
    from selecta.styles.advanced import (
        brake,
        drop_swap,
        half_double,
        long_blend,
        loop_roll_build,
        riser_air,
        tempo_ramp,
        word_cut,
        word_loop,
    )
    from selecta.styles.blend import bass_swap_blend, filter_sweep
    from selecta.styles.exits import cut_on_one, delay_throw, echo_out, reverb_wash
    from selecta.styles.stems import acapella_bridge, exchange, staged_stem_swap, vocal_swap

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
            "long_blend", long_blend, True, lengths=(32,), description="Long instrumental blend"
        ),
        Recipe("drop_swap", drop_swap, False, description="Swap one drop for another"),
        Recipe("half_double", half_double, False, description="Half/double-time handoff"),
        Recipe("loop_roll_build", loop_roll_build, False, lengths=(1, 2, 4)),
        Recipe("tempo_ramp", tempo_ramp, True, lengths=(16,)),
        Recipe("brake", brake, False, lengths=(1,)),
        Recipe("riser_air", riser_air, False, lengths=(1,)),
        Recipe("word_cut", word_cut, False, needs_vocal_info=True),
        Recipe("word_loop", word_loop, False, lengths=(1, 2, 4), needs_vocal_info=True),
        Recipe("vocal_swap", vocal_swap, True, lengths=(8, 16), needs_vocal_info=True),
        Recipe("staged_stem_swap", staged_stem_swap, True, lengths=(16,), needs_vocal_info=True),
        Recipe("acapella_bridge", acapella_bridge, True, lengths=(8,), needs_vocal_info=True),
        Recipe("exchange", exchange, True, lengths=(4,), needs_vocal_info=True),
    ]
    return {recipe.name: recipe for recipe in recipes}
