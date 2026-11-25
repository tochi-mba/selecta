"""The room's pulse: the few things that change by the second (ADR-0488).

The guest page reads the whole room every five seconds, which is right for requests and wrong
for a vote that lasts forty-five. The pulse is the small, fast part: which song is on and how
many hearts it has, whether its blend can still be loved, the vote that is open and its tally,
and whether a big screen is showing. The guest page and the big screen both read it.

It says nothing about any one guest, so every phone in a room gets the same answer, and it is
worked out once a second for the whole room (`PulseCache`), not once per phone. A room of a
hundred phones costs one look at the database a second on each app instance.

Guests have no event stream. Reading a small shared answer survives weak venue Wi-Fi, needs
nothing kept open per phone, and works the same on every app instance.

`screen` is the phone-first rule in one word: true only while a paired screen has looked in the
last half minute. A phone never waits on it; it only changes what the phone says about where
else to look.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from selecta.persistence import transaction
from selecta.rooms import plays
from selecta.rooms.host_features import SOCIAL, HostFeatures, offered, on_screen
from selecta.rooms.ports import SongSummary
from selecta.rooms.store import RoomContext, load_room, resolve_now
from selecta.rooms.views import now_playing_for, screens_live

LIVE_SECONDS = 1.0  # how long one answer serves a room
MAX_ROOMS = 2000


@dataclass(frozen=True)
class Pulse:
    now: float  # the server's clock, so a phone's countdown ignores its own
    live: bool  # the room is open
    screen: bool  # a paired big screen is showing now
    features: Mapping[str, bool]  # which of the five the room offers
    shows: Mapping[str, bool]  # which of them a big screen joins in with
    song: SongSummary | None = None
    paused: bool = False
    play: plays.Play | None = None
    blend_from: SongSummary | None = None  # set while the blend into this song can be loved
    blend_until: float | None = None
    # Filled by the features that have something to say this second: the open vote, the
    # dedication on the playing song. Already in the shape the page reads.
    extras: Mapping[str, Any] = field(default_factory=dict)


Extra = Callable[[Any, Any, "Pulse"], Mapping[str, Any]]


def build(
    ctx: RoomContext,
    host: HostFeatures,
    workspace_id: str,
    room_id: str,
    *,
    extras: tuple[Extra, ...] = (),
    now: float | None = None,
) -> Pulse:
    playing = now_playing_for(ctx, workspace_id)
    decided = host.of(workspace_id)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        # An ended room offers nothing: its page shows the recap and the songs a guest kept.
        features = (
            offered(room.settings, decided) if room.live else dict.fromkeys(SOCIAL, False)
        )
        screen = (
            room.live
            and bool(decided.get("rooms.display", False))
            and screens_live(conn, ctx, room, now) > 0
        )
        play = plays.observe(conn, room, playing, now)
        pulse = Pulse(
            now=now,
            live=room.live,
            screen=screen,
            features=features,
            shows=on_screen(room.settings, features),
            song=playing.current if room.live else None,
            paused=playing.paused,
            play=play,
        )
        added: dict[str, Any] = {}
        for extra in extras:
            added.update(extra(conn, room, pulse))
    pulse = replace(pulse, extras=added)
    # The catalogue opens its own connection, so the song the blend came from is looked up
    # only once this transaction, which may have written the play, is over.
    if play is not None and play.blend_open(now) and play.previous_song_id is not None:
        came_from = ctx.catalog.describe(workspace_id, [play.previous_song_id]).get(
            play.previous_song_id
        )
        if came_from is not None:
            pulse = replace(
                pulse,
                blend_from=came_from,
                blend_until=play.started_at + plays.BLEND_WINDOW_SECONDS,
            )
    return pulse


def _song(song: SongSummary | None) -> dict[str, Any] | None:
    if song is None:
        return None
    return {
        "song_id": song.song_id,
        "title": song.title,
        "artist": song.artist,
        "length_s": song.length_s,
    }


def pulse_json(pulse: Pulse) -> dict[str, Any]:
    play = pulse.play
    reactions = pulse.features.get("reactions", False)
    return {
        "now": pulse.now,
        "live": pulse.live,
        "screen": pulse.screen,
        "features": dict(pulse.features),
        "shows": dict(pulse.shows),
        "song": _song(pulse.song),
        "paused": pulse.paused,
        "play": None
        if play is None
        else {
            "play_id": play.id,
            "song_id": play.song_id,
            "started_at": play.started_at,
            # Counts are the room's, never a guest's: nobody learns who tapped.
            "loves": play.loves if reactions else 0,
            "blends": play.blends if reactions else 0,
            "blend": None
            if pulse.blend_from is None or not reactions
            else {"from": _song(pulse.blend_from), "until": pulse.blend_until},
        },
        **pulse.extras,
    }


class PulseCache:
    """One answer per room per second, shared by every phone and screen in it."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._lock = threading.Lock()
        self._kept: dict[str, tuple[float, dict[str, Any]]] = {}

    def get(self, room_id: str, make: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        now = self.clock()
        with self._lock:
            kept = self._kept.get(room_id)
            if kept is not None and kept[0] > now:
                return kept[1]
        # Made outside the lock: two phones arriving together may both make it, and the second
        # answer simply replaces the first. Holding the lock would queue every room behind one.
        made = make()
        with self._lock:
            if len(self._kept) >= MAX_ROOMS:
                for stale in [key for key, value in self._kept.items() if value[0] <= now]:
                    del self._kept[stale]
                while len(self._kept) >= MAX_ROOMS:
                    del self._kept[next(iter(self._kept))]
            self._kept[room_id] = (now + LIVE_SECONDS, made)
        return made

    def forget(self, room_id: str) -> None:
        """Drop a room's answer after a write, so the guest who tapped sees it at once."""
        with self._lock:
            self._kept.pop(room_id, None)


__all__ = ["Extra", "Pulse", "PulseCache", "build", "pulse_json"]
