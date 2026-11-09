"""Musical proposals for waiting requests, using the same cue and taste data as mixes.

All the waiting requests are planned together, oldest first, so they can't get in each other's way:
no song is used twice, whether it was asked for or is only there as a bridge, and each spot in the
mix goes to one request at a time. Going from one song into another only depends on those two songs,
so that's worked out once and kept, and rechecking is mostly a matter of looking things up.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

from selecta import flags
from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo
from selecta.library.scan import identity
from selecta.lyrics.lrclib import clean_artist
from selecta.planner import beam, choose
from selecta.planner.beam import _Cues, _Riders, handoff_quality
from selecta.planner.choose import enumerate_candidates
from selecta.planner.memory import RULES_VERSION, SeamMemory
from selecta.planner.wordreel import BLEND_MIN_GRID, modes_for, ride_lines
from selecta.requests import Slot, custom_seam, find_slot, open_spots
from selecta.seam_kinds import move_on
from selecta.seams import request_from

QUICK_BLENDS = ("bass_swap_blend", "filter_sweep", "tempo_ramp")
EFFECTS = ("delay_throw", "echo_out")
GOOD_ENOUGH = 0.5
RIDE_SCORE = 0.7
SAVE_EVERY_SECONDS = 30.0

SHORTLIST = 30  # who's looked at on every recheck. Find a bridge goes through every song
BRIDGES_SHOWN = 5
MOST_FROM_ONE_ARTIST = 2
TOP_STEPS = 16  # how many are tried for each step of the way, the most promising first
MOST_EXTRA_OFFERED = 2  # what's put to someone without them asking
MOST_EXTRA_WHEN_ASKED = 3
SEARCH_SECONDS = 20.0  # longer routes stop being looked for after this. What's found is still kept
EXTRA_SONG_COST = 0.1
LATER_COST = 0.012
LATER_COST_STOPS_AT = 8
SAME_ARTIST_COST = 0.08

_VERSION_NOTES = re.compile(r"[(\[].*?[)\]]")


def _rules() -> str:
    """Anything that decides what a pair can do. If it changes, nothing known about pairs stands."""
    sources = b"".join(Path(module.__file__).read_bytes() for module in (beam, choose))
    return hashlib.sha1(sources + str(RULES_VERSION).encode()).hexdigest()[:16]


def _stamp(song: SongInfo) -> str:
    """Enough to tell that a song has been analysed differently, or that its words have changed."""
    facts = [
        getattr(song, name, None)
        for name in (
            "bpm",
            "camelot",
            "grid_confidence",
            "beats_per_bar",
            "duration",
            "vocals_known",
            "instrumental",
            "energy",
            "sections",
        )
    ]
    bars = getattr(song, "bar_starts", ())
    lines = getattr(song, "lines", None) or ()
    timing = [round(line.start, 2) for line in lines]
    return hashlib.sha1(repr((facts, len(bars), timing)).encode()).hexdigest()[:16]


@dataclass(frozen=True)
class PairFacts:
    quality: float
    moves: tuple[tuple[str, float], ...] = ()


class PairBook:
    """What's been worked out about going from one song into another. It's kept across rechecks and
    restarts, and a song that changes only loses what was worked out about that song."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self._pairs: dict[tuple[int, int], PairFacts] = {}
        self._rides: dict[tuple[int, int], bool] = {}
        self._stamps: dict[int, str] = {}
        self._seen: dict[int, object] = {}
        self._riders = _Riders()
        self._cues = _Cues()
        self._lock = threading.Lock()
        self._unsaved = False
        self._saved_at = 0.0
        self._rules = _rules() if path is not None else ""
        self._load()

    def _load(self) -> None:
        if self.path is None:
            return
        try:
            saved = json.loads(self.path.read_text("utf-8"))
            if saved["rules"] != self._rules:
                return
            self._stamps = {int(song): stamp for song, stamp in saved["songs"].items()}
            for a, b, quality, moves, ride in saved["pairs"]:
                self._pairs[(a, b)] = PairFacts(quality, tuple((m, s) for m, s in moves))
                if ride is not None:
                    self._rides[(a, b)] = ride
        except (OSError, ValueError, KeyError, TypeError):
            self._pairs, self._rides, self._stamps = {}, {}, {}

    def sync(self, songs: Iterable[SongInfo]) -> None:
        """Forget only what's out of date. It's quick to ask: songs seen before are skipped."""
        changed: set[int] = set()
        with self._lock:
            for song in songs:
                if self._seen.get(song.id) is song:
                    continue
                self._seen[song.id] = song
                stamp = _stamp(song)
                before = self._stamps.get(song.id)
                if before != stamp:
                    self._stamps[song.id] = stamp
                    self._unsaved = True
                    if before is not None:
                        changed.add(song.id)
            if not changed:
                return
            self._pairs = {
                pair: facts
                for pair, facts in self._pairs.items()
                if pair[0] not in changed and pair[1] not in changed
            }
            self._rides = {
                pair: ride
                for pair, ride in self._rides.items()
                if pair[0] not in changed and pair[1] not in changed
            }
            for song_id in changed:
                self._riders._out.pop(song_id, None)
                self._riders._in.pop(song_id, None)
                self._cues._exits.pop(song_id, None)
                self._cues._entries.pop(song_id, None)

    def facts(self, a: SongInfo, b: SongInfo) -> PairFacts:
        pair = (a.id, b.id)
        known = self._pairs.get(pair)
        if known is not None:
            return known
        quality = handoff_quality(a, b, self._riders)
        moves: list[tuple[str, float]] = []
        if quality >= GOOD_ENOUGH:
            exits, entries = self._cues.exits(a), self._cues.entries(b)
            for name in (*QUICK_BLENDS, *EFFECTS):
                best = enumerate_candidates(a, b, name, exits=exits, entries=entries)
                if best:
                    moves.append((name, float(best[0].score)))
        facts = PairFacts(float(quality), tuple(moves))
        with self._lock:
            self._pairs[pair] = facts
            self._unsaved = self._unsaved or quality >= GOOD_ENOUGH
        return facts

    def quality(self, a: SongInfo, b: SongInfo) -> float:
        """Just how good it should be, which takes no time, for narrowing things down first."""
        known = self._pairs.get((a.id, b.id))
        return known.quality if known is not None else handoff_quality(a, b, self._riders)

    def moves(self, a: SongInfo, b: SongInfo, stems: str = "never") -> list[tuple[str, float]]:
        """Each move that could work between these two with how well it should go, in the order
        they're worth trying: quick blends, then a vocal ride, which takes longer, then effects."""
        facts = self.facts(a, b)
        if facts.quality < GOOD_ENOUGH:
            return []
        # only what this build can make; the facts are kept whole, so turning a move back on works
        usable = [(name, score) for name, score in facts.moves if move_on(name)]
        can_ride = stems != "never" and flags.on("stems") and move_on("vocal_ride")
        if can_ride and self._can_ride(a, b):
            blends = sum(name in QUICK_BLENDS for name, _ in usable)
            usable.insert(blends, ("vocal_ride", RIDE_SCORE))
        return usable

    def _can_ride(self, a: SongInfo, b: SongInfo) -> bool:
        pair = (a.id, b.id)
        known = self._rides.get(pair)
        if known is None:
            known = "word_blend" in modes_for(a, b) and bool(ride_lines(a, b))
            with self._lock:
                self._rides[pair] = known
                self._unsaved = True
        return known

    def save(self, now: bool = False) -> None:
        """Written every so often, since losing the last few seconds only means working them out
        again. Pairs too far apart to work aren't kept, since finding that out takes no time."""
        if self.path is None or not self._unsaved:
            return
        if not now and time.monotonic() - self._saved_at < SAVE_EVERY_SECONDS:
            return
        with self._lock:
            pairs = [
                [a, b, facts.quality, [list(move) for move in facts.moves], self._rides.get((a, b))]
                for (a, b), facts in self._pairs.items()
                if facts.quality >= GOOD_ENOUGH
            ]
            stamps = {str(song): stamp for song, stamp in self._stamps.items()}
            self._unsaved = False
            self._saved_at = time.monotonic()
        temporary = self.path.with_suffix(".tmp")
        try:
            temporary.write_text(
                json.dumps({"rules": self._rules, "songs": stamps, "pairs": pairs}), "utf-8"
            )
            os.replace(temporary, self.path)
        except OSError:
            self._unsaved = True  # something had the file open, so it's tried again next time


def same_song(song: SongInfo) -> str:
    """Two versions of a song are the same song to anyone listening to a set: an extended mix or a
    remaster straight after the original would sound like a mistake."""
    title = _VERSION_NOTES.sub(" ", getattr(song, "title", None) or "").split(" - ")[0]
    found = identity(getattr(song, "artist", None), title)
    return f"song {song.id}" if found.endswith("|") else found


class _Spoken:
    """Every song that's spoken for, by id and by what it actually is."""

    def __init__(self, library: dict[int, SongInfo]) -> None:
        self.library = library
        self.ids: set[int] = set()
        self.names: set[str] = set()

    def add(self, songs: Iterable[int]) -> None:
        for song_id in songs:
            self.ids.add(song_id)
            song = self.library.get(song_id)
            if song is not None:
                self.names.add(same_song(song))

    def has(self, song: SongInfo) -> bool:
        return song.id in self.ids or same_song(song) in self.names


@dataclass(frozen=True)
class Route:
    position: int
    songs: tuple[int, ...]
    bridges: tuple[int, ...]
    worth: float


class _Planner:
    def __init__(
        self,
        items: list[tuple[int, str | None, int]],
        songs: list[SongInfo],
        protected_through: int,
        memory: SeamMemory,
        state_of: Callable[[str], dict],
        stems: str,
        book: PairBook | None,
        allowed: set[int] | None,
        avoid: set[tuple[int, int]] | None = None,
    ) -> None:
        self.songs = songs
        self.library = {song.id: song for song in songs}
        self.order = [item[0] for item in items]
        self.protected = protected_through
        self.memory = memory
        self.state_of = state_of
        self.stems = stems
        self.book = book if book is not None else PairBook()
        self.book.sync(songs)
        self.allowed = allowed
        self.avoid = avoid or set()
        self.locked = [i for i, item in enumerate(items) if item[2]]
        self.custom = [i for i, item in enumerate(items) if custom_seam(item[1])]
        self.edges: dict[tuple[int, int], dict | None] = {}
        self.values: dict[tuple[int, int], float] = {}

    def edge(self, a_id: int, b_id: int) -> dict | None:
        """The way from one song into another. Each move gets its own full search for a placement,
        so these two are given a real chance before moving on to another spot in the mix. One that
        has already come out clean goes first, then quick blends, then a vocal ride, which takes
        longer, then effects. A near miss is what the rest of the mix would settle for, so it
        counts if nothing else is left. A bare cut never comes up here, because a request doesn't
        earn one."""
        key = (a_id, b_id)
        if key in self.edges:
            return self.edges[key]
        self.edges[key] = None
        a, b = self.library.get(a_id), self.library.get(b_id)
        if a is None or b is None or key in self.avoid:
            return None
        waiting, near = None, None
        for move, _score in self.book.moves(a, b, self.stems):
            if self.memory.move_factor(a_id, b_id, move) <= 0:
                continue
            settings = {"move": move, "from_request": True}
            state = self.state_of(request_from(a_id, b_id, settings).key)
            status = state.get("status")
            if status == "ready" and state.get("passed") is True:
                self.edges[key] = settings
                return settings
            if status == "ready":
                if near is None and state.get("near_miss") is True:
                    near = settings
            elif status != "failed" and waiting is None:
                waiting = settings
        self.edges[key] = waiting or near
        return self.edges[key]

    def fits(self, a_id: int, b_id: int) -> bool:
        return self.edge(a_id, b_id) is not None

    def worth(self, a_id: int, b_id: int) -> float:
        """How good this hand-over should be: what the listener's ratings say about pairs like it,
        how well the move lines up, and anything already known from hearing this very pair."""
        key = (a_id, b_id)
        if key not in self.values:
            a, b = self.library[a_id], self.library[b_id]
            settings = self.edge(a_id, b_id) or {}
            scores = dict(self.book.moves(a, b, self.stems))
            how_well = scores.get(settings.get("move"), 0.0)
            value = 0.6 * self.book.facts(a, b).quality + 0.4 * how_well
            value += 0.2 * self.memory.pair_value(a_id, b_id)
            self.values[key] = value * self.memory.learned_fit(a, b) ** 0.5
        return self.values[key]

    def chain(self, position: int, songs: tuple[int, ...]) -> list[int]:
        return [self.order[position - 1], *songs, *self.order[position : position + 1]]

    def _rate(self, position: int, songs: tuple[int, ...], requested: int, wait: int) -> Route:
        chain = self.chain(position, songs)
        links = [self.worth(a, b) for a, b in zip(chain, chain[1:], strict=False)]
        # a route is as good as its weakest moment, though it should be good the rest of the way too
        value = 0.6 * min(links) + 0.4 * sum(links) / len(links)
        bridges = tuple(song for song in songs if song != requested)
        value -= EXTRA_SONG_COST * max(len(bridges) - 1, 0) + LATER_COST * wait
        artists = [clean_artist(getattr(self.library[s], "artist", "")).casefold() for s in chain]
        repeats = sum(a == b and a != "" for a, b in zip(artists, artists[1:], strict=False))
        return Route(position, songs, bridges, value - SAME_ARTIST_COST * repeats)

    def _closest(self, songs: Iterable[int], to: int) -> list[int]:
        """The ones that get nearest in tempo to a song, which is where each step is heading."""
        target = self.library[to].bpm
        return sorted(songs, key=lambda song: abs(self.library[song].bpm / target - 1))[:TOP_STEPS]

    def _different(self, a: int, b: int) -> bool:
        return a != b and same_song(self.library[a]) != same_song(self.library[b])

    def _ways_in(
        self, before: int, requested: int, into: list[int], ids: list[int], two_steps: bool
    ) -> list[tuple[int, ...]]:
        """How to get from a song in the mix to the request: straight there, by way of one song, or,
        if that can't be done, two, walking the tempo over."""
        ways: list[tuple[int, ...]] = [()] if self.fits(before, requested) else []
        ones = [song for song in into if self.fits(before, song)]
        ones.sort(key=lambda s: self.worth(before, s) + self.worth(s, requested), reverse=True)
        ways += [(song,) for song in ones[:TOP_STEPS]]
        if ways or not two_steps or before not in self.library:
            return ways
        start = self.library[before]
        near = [s for s in ids if self.book.quality(start, self.library[s]) >= GOOD_ENOUGH]
        return [
            (first, second)
            for first in self._closest(near, requested)
            for second in self._closest(into, before)
            if self._different(first, second)
            and self.fits(before, first)
            and self.fits(first, second)
        ]

    def _ways_out(
        self, requested: int, after: int, out_of: list[int], ids: list[int], two_steps: bool
    ) -> list[tuple[int, ...]]:
        """The same on the way back: from the request to the song in the mix that comes next."""
        ways: list[tuple[int, ...]] = [()] if self.fits(requested, after) else []
        ones = [song for song in out_of if self.fits(song, after)]
        ones.sort(key=lambda s: self.worth(requested, s) + self.worth(s, after), reverse=True)
        ways += [(song,) for song in ones[:TOP_STEPS]]
        if ways or not two_steps or after not in self.library:
            return ways
        landing = self.library[after]
        near = [s for s in ids if self.book.quality(self.library[s], landing) >= GOOD_ENOUGH]
        return [
            (first, second)
            for first in self._closest(out_of, after)
            for second in self._closest(near, requested)
            if self._different(first, second)
            and self.fits(first, second)
            and self.fits(second, after)
        ]

    def routes(
        self,
        requested: int,
        spoken: _Spoken,
        taken: Iterable[int],
        *,
        shortlist: int | None = None,
        two_steps: bool = False,
    ) -> tuple[list[Route], int]:
        """Ways to reach a song using extra songs, best first, and how many songs were looked at.
        Everything hinges on who can lead into the song or out of it, and few can, so that's found
        first. Which of those the mix can reach is only worked out for them. A song far from the
        mix's tempo might need a song on each side, so every spot in the mix is looked at, with
        sooner counting for more."""
        wanted = self.library[requested]
        pool = [
            song
            for song in self.songs
            if song.id != requested
            and not spoken.has(song)
            and (self.allowed is None or song.id in self.allowed)
        ]
        if shortlist is not None:
            pool = sorted(pool, key=lambda song: abs(song.bpm / wanted.bpm - 1))[:shortlist]
        ids = [song.id for song in pool]
        into = [song for song in ids if self.fits(song, requested)]
        out_of = [song for song in ids if self.fits(requested, song)]
        spots = open_spots(
            self.order, self.protected, locked=self.locked, custom_seams=self.custom, taken=taken
        )
        most = MOST_EXTRA_WHEN_ASKED if two_steps else MOST_EXTRA_OFFERED
        give_up_at = time.monotonic() + SEARCH_SECONDS
        found: list[Route] = []
        for wait, position in enumerate(spots):
            longer = two_steps and time.monotonic() < give_up_at
            before = self.order[position - 1]
            coming = self._ways_in(before, requested, into, ids, longer)
            going: list[tuple[int, ...]] = [()]
            if position < len(self.order):
                going = self._ways_out(requested, self.order[position], out_of, ids, longer)
            for first in coming:
                for last in going:
                    extras = (*first, *last)
                    if not extras or len(extras) > most:
                        continue
                    if len({same_song(self.library[song]) for song in extras}) < len(extras):
                        continue
                    later = min(wait, LATER_COST_STOPS_AT)
                    found.append(self._rate(position, (*first, requested, *last), requested, later))
        return sorted(found, key=lambda route: -route.worth), len(pool)

    def place(self, rows: list[dict]) -> tuple[list[dict], _Spoken, dict[int, str]]:
        """Plan every request against the same mix, in turn. Songs someone has agreed to are spoken
        for from the start, along with everything in the mix and everything asked for, so nothing
        can be used twice, whichever order things happen in. Those who've chosen a route go first,
        then the rest, oldest first."""
        spoken = _Spoken(self.library)
        spoken.add(self.order)
        for row in rows:
            spoken.add([row["song_id"], *(row.get("picked") or ())])
        spots: dict[int, str] = {}
        planned: set[int] = set()
        results: list[dict] = [{} for _ in rows]
        for index in sorted(range(len(rows)), key=lambda i: not rows[i].get("picked")):
            results[index] = self._place_one(rows[index], spoken, spots, planned)
        return results, spoken, spots

    def _place_one(
        self, row: dict, spoken: _Spoken, spots: dict[int, str], planned: set[int]
    ) -> dict:
        song_id = row["song_id"]
        result = {**row, "plan": None}
        if not row.get("available", 1):
            result["reason"] = "This song is no longer available."
            result["stage"] = "unavailable"
        elif song_id in self.order:
            result["reason"] = "This song is already in the mix."
            result["stage"] = "in_mix"
        elif row.get("never"):
            result["reason"] = "This song is set to never play."
            result["stage"] = "never"
        elif song_id not in self.library:
            result["reason"] = "Waiting for song analysis and usable cues."
            result["stage"] = "analysing" if row.get("waiting_on") == "analysis" else "no_cues"
        elif not self.order:
            result["reason"] = "Start a mix to find a place for this request."
            result["stage"] = "no_mix"
        else:
            self._find_a_place(row, result, spoken, spots, planned)
        return result

    def _find_a_place(
        self, row: dict, result: dict, spoken: _Spoken, spots: dict[int, str], planned: set[int]
    ) -> None:
        song_id = row["song_id"]
        where = dict(locked=self.locked, custom_seams=self.custom)
        slot = None
        picked = tuple(row.get("picked") or ())
        if picked:
            usable = all(
                song in self.library and song not in self.order and song not in planned
                for song in picked
            )
            if usable:
                slot = find_slot(
                    self.order, song_id, self.protected, self.fits,
                    taken=set(spots), route=picked, **where,
                )  # fmt: skip
            result["bridge_lost"] = slot is None
        if slot is None:
            slot = find_slot(
                self.order, song_id, self.protected, self.fits, taken=set(spots), **where
            )
        if slot is None:
            sharing = find_slot(self.order, song_id, self.protected, self.fits, **where)
            if sharing is not None and sharing.position in spots:
                # it fits right there, so rather than bring in an extra song, it waits its turn
                result["behind"] = spots[sharing.position]
                result["reason"] = f"Waiting for {spots[sharing.position]} to join first."
                result["stage"] = "searching"
                return
        if slot is None and row.get("bridge_choice") is not False:
            routes, _looked_at = self.routes(song_id, spoken, set(spots), shortlist=SHORTLIST)
            if routes:
                slot = Slot(routes[0].position, routes[0].songs, routes[0].bridges)
        if slot is None:
            result["reason"] = "Waiting for a suitable place. Other requests can still fit."
            result["stage"] = "searching"
            return
        chain = self.chain(slot.position, tuple(slot.songs))
        result["plan"] = {
            **asdict(slot),
            "songs": list(slot.songs),
            "bridges": list(slot.bridges),
            "seams": [self.edge(a, b) for a, b in zip(chain, chain[1:], strict=False)],
        }
        result["reason"] = (
            "A bridge song could make this fit. Your approval is needed."
            if slot.bridges
            else "Found a place ahead of playback."
        )
        spots[slot.position] = row.get("title") or "another request"
        spoken.add(slot.songs)
        planned.update(slot.songs)


def proposals(
    rows: list[dict],
    items: list[tuple[int, str | None, int]],
    songs: list[SongInfo],
    protected_through: int,
    memory: SeamMemory,
    state_of: Callable[[str], dict],
    stems: str = "never",
    book: PairBook | None = None,
    allowed: set[int] | None = None,
    avoid: set[tuple[int, int]] | None = None,
) -> list[dict]:
    """No queue mutations. Unfitting requests remain visible while later ones are considered.

    Requests do not earn a forced cut just because they were requested. Only compatible
    handovers with real cues are proposed, and actual rendered audits remain the final gate.
    """
    planner = _Planner(
        items, songs, protected_through, memory, state_of, stems, book, allowed, avoid
    )
    return planner.place(rows)[0]


def _route_words(chain: list[SongInfo]) -> str:
    """What makes a route work, from what was measured, with nothing that wasn't."""
    pairs = list(zip(chain, chain[1:], strict=False))
    keys = max(camelot_distance(a.camelot, b.camelot) for a, b in pairs)
    gap = max(abs(a.bpm / b.bpm - 1.0) for a, b in pairs)
    tempo = " → ".join(str(round(song.bpm)) for song in chain) + " BPM"
    if gap <= 0.02:
        pace = "Tempo barely moves"
    elif gap <= 0.05:
        pace = "Tempo moves gently"
    else:
        pace = "Tempo walks there in steps"
    harmony = "keys match" if keys == 0 else "keys stay close" if keys <= 2 else "keys shift"
    return f"{pace}, {harmony}. {tempo}."


def bridge_options(
    row: dict,
    rows: list[dict],
    items: list[tuple[int, str | None, int]],
    songs: list[SongInfo],
    protected_through: int,
    memory: SeamMemory,
    state_of: Callable[[str], dict],
    stems: str = "never",
    book: PairBook | None = None,
    allowed: set[int] | None = None,
    shown: int = BRIDGES_SHOWN,
) -> dict:
    """The best ways of reaching one request, going through every song in the library. One extra
    song if that can be done, or two if it can't. What other requests are using isn't on offer."""
    planner = _Planner(items, songs, protected_through, memory, state_of, stems, book, allowed)
    others = [other for other in rows if other["id"] != row["id"]]
    _results, spoken, spots = planner.place(others)
    spoken.add([row["song_id"]])
    routes, looked_at = planner.routes(row["song_id"], spoken, set(spots), two_steps=True)
    chosen: list[Route] = []
    extras: set[tuple[int, ...]] = set()
    artists: dict[str, int] = {}
    for route in routes:
        extra = tuple(sorted(route.bridges))
        artist = clean_artist(getattr(planner.library[route.bridges[0]], "artist", "")).casefold()
        if extra in extras or artists.get(artist, 0) >= MOST_FROM_ONE_ARTIST:
            continue
        extras.add(extra)
        artists[artist] = artists.get(artist, 0) + 1
        chosen.append(route)
        if len(chosen) == shown:
            break
    direct = find_slot(
        planner.order, row["song_id"], protected_through, planner.fits,
        locked=planner.locked, custom_seams=planner.custom, taken=set(spots),
    )  # fmt: skip
    found = []
    for route in chosen:
        chain = planner.chain(route.position, route.songs)
        found.append(
            {
                "position": route.position,
                "songs": list(route.songs),
                "bridges": list(route.bridges),
                "chain": chain,
                "seams": [planner.edge(a, b) for a, b in zip(chain, chain[1:], strict=False)],
                "words": _route_words([planner.library[song] for song in chain]),
            }
        )
    wanted = planner.library[row["song_id"]]
    # a beat nothing can line up with isn't something another song can fix
    unsteady = getattr(wanted, "grid_confidence", 1.0) < BLEND_MIN_GRID
    return {
        "routes": found,
        "looked_at": looked_at,
        "direct": direct is not None,
        "unsteady": unsteady,
    }
