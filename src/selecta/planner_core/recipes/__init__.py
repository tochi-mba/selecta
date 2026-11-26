"""Transition recipes. Each one is a small function that builds a TransitionScript from song facts
alone, so any studio can render what the planner core chose. Word moves need word timing from the
separated voice, so they live in `selecta.styles.wordplay`, outside the core."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from selecta import flags
from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import TransitionScript


class MakeScript(Protocol):
    def __call__(
        self, a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int, **options
    ) -> TransitionScript | None: ...


@dataclass(frozen=True)
class Room:
    """Where a move that builds its own overlap puts it, so the planner scores what will really
    play together rather than A's natural bars before the exit."""

    b_enters_bar: int
    """A's bar (in its own count) where B's first downbeat lands."""
    overlap_bars: int
    """How many bars both songs sound together."""
    loop_bars: int
    """How many of A's bars play under B, for the harmony guess."""


class FindRoom(Protocol):
    def __call__(
        self, a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int
    ) -> Room | None: ...


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
    on_request: bool = False
    """Only made when a person asks for this move by name, never offered by the planner."""
    room: FindRoom | None = None
    """For a move that makes its own overlap from clean bars of A: where that room is for a cue
    pair, or None where the move doesn't belong. A's side is then free of singing by design."""


def all_recipes() -> dict[str, Recipe]:
    """Recipes the planner can pick from bar cues. Word cuts need word timing from a lyric link,
    so `selecta.styles.wordplay` is reached through the word-link search instead."""
    from selecta.planner_core.recipes.blend import bass_swap_blend, filter_sweep, tempo_ramp
    from selecta.planner_core.recipes.exits import cut_on_one, delay_throw, echo_out, reverb_wash

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
            # every rated ramp was disliked, and its design forces the 4-bar overlap the
            # ratings also ruled out, so it only renders when a person asks for it by name
            on_request=True,
        ),
    ]
    # moves still waiting for the owner's ears: with their flag off they don't exist, so nothing
    # the planner enumerates changes
    if flags.on("move.loop_room"):
        from selecta.planner_core.recipes.loop import loop_room, loop_room_fits

        recipes.append(
            Recipe(
                "loop_room",
                loop_room,
                True,
                lengths=(8, 16),
                description="Loop A's last clean bars to make room for a long blend",
                room=loop_room_fits,
            )
        )
    if flags.on("move.tempo_bridge"):
        from selecta.planner_core.recipes.bridge import BRIDGE_BARS, tempo_bridge, tempo_bridge_fits

        recipes.append(
            Recipe(
                "tempo_bridge",
                tempo_bridge,
                True,
                lengths=(BRIDGE_BARS,),
                max_gap=BRIDGE_GATE_GAP,
                description="Carry A's stripped loop to B's tempo, then bring B in untouched",
                room=tempo_bridge_fits,
            )
        )
    return {recipe.name: recipe for recipe in recipes}


BRIDGE_GATE_GAP = 0.085
"""Loose enough for the bridge's own gate (`recipes.bridge`), which measures the stretch exactly."""
