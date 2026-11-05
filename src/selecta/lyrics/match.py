"""Find places where one song can hand a word to another.

A link needs more than a shared word. A has to finish a line on it, and B has to open a line with
it, or there's no clean place to cut. "I" counts for nothing, which the first listener said out
loud. Recognition leads: a hook word people know beats a rare word they don't, and DJs recommend
"love" and "baby" for exactly that reason. Rarity is only a small modifier.

Only line starts and ends can link, so this stays small enough to run over a whole library.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from selecta.lyrics.lrclib import Line, clean_artist

TOKEN = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
_LATIN = re.compile(r"^[a-z0-9'àáâäãåæçèéêëìíîïñòóôöõøœùúûüýÿß]+$")

STOP = frozenset(
    """
    a about after again all also am an and any are as at be because been before being but by can
    could did do does doing done down each even ever every for from get gets getting go goes going
    gone got had has have having he her here hers him his how i if in into is it its just know let
    like made make many may maybe me might more most much must my no nor not now of off on once one
    only or other our out over own put really said same say says see she should so some still such
    take than that the their them then there these they thing things this those through to too two
    under until up us very want was way we well were what when where which while who whom why will
    with would you your yours i'm i'll i've i'd you're you'll you've you'd he's she's it's it'll
    we're we'll we've they're they'll they've that's there's what's who's don't doesn't didn't
    can't cannot won't wouldn't couldn't shouldn't ain't isn't aren't wasn't weren't gonna wanna
    gotta 'cause cause cuz tryna lemme gimme kinda sorta dont cant wont aint im ill ive youre
    need needs come comes came look looks tell told give gave think thought feel felt keep kept
    """.split()
)
FILLER = frozenset(
    """
    oh ooh oooh ah aah uh uhh huh hmm mm mmm hey yeah yea yeh ya yo ay ayy aye eh na nah la da doo
    woo whoa woah wo ha haha ho hoo ohh ooo sha shoo ba bam pa ra rah ooh-ooh oh-oh
    """.split()
)

MIN_PLAYED_SECONDS = 45.0
MIN_LEFT_AFTER_ENTRY = 60.0
LATEST_ENTRY_SHARE = 0.6
MIN_SECONDS_PER_WORD = 0.2
"""Faster than this and a word goes by too quickly to catch, which rules out most rap verses."""
MAX_PER_KEY = 30


@dataclass(frozen=True)
class LyricLink:
    song_a: int
    song_b: int
    kind: str
    phrase: str
    line_a: Line
    line_b: Line
    score: float


@dataclass(frozen=True)
class SongFacts:
    artist: str = ""
    title: str = ""
    duration: float = 0.0


@dataclass(frozen=True)
class _Spot:
    song: int
    line: Line
    hook: bool
    title_hit: bool
    pace: float


def normalise(text: str) -> tuple[str, ...]:
    return tuple(x.casefold().replace("’", "'") for x in TOKEN.findall(text))


def _useful(word: str) -> bool:
    return len(word) >= 3 and word not in STOP and word not in FILLER


def _linkable(tokens: tuple[str, ...]) -> bool:
    """Whether these words can carry a link, which at least one real content word has to do."""
    if any(word in FILLER for word in tokens):
        return False
    return any(_useful(word) for word in tokens)


def _latin(tokens: tuple[str, ...]) -> bool:
    return all(_LATIN.match(word) for word in tokens)


def _pace(lines: list[Line], i: int, tokens: tuple[str, ...]) -> float:
    following = lines[i + 1].start if i + 1 < len(lines) else lines[i].end
    span = max(lines[i].end - lines[i].start, min(following - lines[i].start, 8.0))
    return span / max(len(tokens), 1)


def _spots(
    song: int, lines: list[Line], facts: SongFacts
) -> tuple[dict[tuple[str, ...], list[_Spot]], dict[tuple[str, ...], list[_Spot]]]:
    repeats = Counter(normalise(line.text) for line in lines)
    title = set(normalise(facts.title))
    exits: dict[tuple[str, ...], list[_Spot]] = defaultdict(list)
    entries: dict[tuple[str, ...], list[_Spot]] = defaultdict(list)
    duration = facts.duration or (lines[-1].end + 30.0 if lines else 0.0)
    for i, line in enumerate(lines):
        tokens = normalise(line.text)
        if not tokens or not _latin(tokens):
            continue
        pace = _pace(lines, i, tokens)
        if pace < MIN_SECONDS_PER_WORD:
            continue
        hook = repeats[tokens] >= 2
        can_exit = line.start >= MIN_PLAYED_SECONDS and duration - line.end >= 15.0
        can_enter = (
            line.start <= duration * LATEST_ENTRY_SHARE
            and duration - line.start >= MIN_LEFT_AFTER_ENTRY
        )
        for size in (3, 2, 1):
            if len(tokens) < size:
                continue
            if can_exit and _linkable(tail := tokens[-size:]):
                exits[tail].append(_Spot(song, line, hook, bool(set(tail) & title), pace))
            if can_enter and _linkable(head := tokens[:size]):
                entries[head].append(_Spot(song, line, hook, bool(set(head) & title), pace))
    return exits, entries


def _strength(key: tuple[str, ...], a: _Spot, b: _Spot, share: float) -> tuple[float, str]:
    link = {1: 0.65, 2: 0.9, 3: 1.0}[len(key)]
    recognition = (1.0 if a.hook else 0.72) * (1.0 if b.hook else 0.8)
    if a.title_hit or b.title_hit:
        recognition = min(1.0, recognition + 0.2)
    longest = max(len(word) for word in key)
    clarity = 1.0 if longest >= 5 else 0.95 if longest == 4 else 0.8
    clarity *= min(1.0, 0.7 + min(a.pace, b.pace))
    rarity = 0.85 + 0.15 * (1.0 - share)
    kind = (
        "shared_hook"
        if a.hook and b.hook
        else "title_word"
        if a.title_hit or b.title_hit
        else "shared_phrase"
        if len(key) > 1
        else "shared_word"
    )
    return link * recognition * clarity * rarity, kind


def _best(spots: Iterable[_Spot]) -> list[_Spot]:
    ranked = sorted(spots, key=lambda s: (s.hook, s.title_hit, s.pace), reverse=True)
    chosen: list[_Spot] = []
    seen: set[int] = set()
    for spot in ranked:
        if spot.song in seen:
            continue
        seen.add(spot.song)
        chosen.append(spot)
        if len(chosen) == MAX_PER_KEY:
            break
    return chosen


def discover(
    lines_by_song: dict[int, list[Line]],
    limit: int = 5000,
    facts: dict[int, SongFacts] | None = None,
    keep_all_pairs: bool = False,
) -> list[LyricLink]:
    """Every song pair where A can finish a line on a word and B can open a line with it.
    Normally one link per pair, the best. `keep_all_pairs` keeps each phrase a pair shares."""
    facts = facts or {}
    exits: dict[tuple[str, ...], list[_Spot]] = defaultdict(list)
    entries: dict[tuple[str, ...], list[_Spot]] = defaultdict(list)
    uses: Counter[str] = Counter()
    for song, lines in lines_by_song.items():
        song_facts = facts.get(song, SongFacts())
        song_exits, song_entries = _spots(song, lines, song_facts)
        for key, spots in song_exits.items():
            exits[key].extend(spots)
        for key, spots in song_entries.items():
            entries[key].extend(spots)
        uses.update({word for line in lines for word in normalise(line.text)})

    total = max(len(lines_by_song), 1)
    artists = {song: clean_artist(fact.artist).casefold() for song, fact in facts.items()}
    best: dict[tuple, LyricLink] = {}
    for key, leaving in exits.items():
        arriving = entries.get(key)
        if not arriving:
            continue
        share = max(uses[word] for word in key) / total
        for a in _best(leaving):
            for b in _best(arriving):
                if a.song == b.song:
                    continue
                artist = artists.get(a.song)
                if artist and artist == artists.get(b.song):
                    continue
                score, kind = _strength(key, a, b, share)
                pair = (a.song, b.song, key) if keep_all_pairs else (a.song, b.song)
                if pair not in best or score > best[pair].score:
                    best[pair] = LyricLink(
                        a.song, b.song, kind, " ".join(key), a.line, b.line, round(score, 4)
                    )
    return sorted(best.values(), key=lambda link: -link.score)[:limit]


def varied_links(links: list[LyricLink], wanted: int) -> list[LyricLink]:
    """The best links with no song or meaningful word used twice, so a shortlist isn't all "love".

    A phrase that repeats one word, such as "dance dance", says nothing a single word doesn't.
    """
    chosen: list[LyricLink] = []
    words_used: set[str] = set()
    songs_used: set[int] = set()
    for link in links:
        words = link.phrase.split()
        if len(set(words)) < len(words):
            continue
        if any(word in words_used for word in words if len(word) > 3):
            continue
        if link.song_a in songs_used or link.song_b in songs_used:
            continue
        words_used.update(words)
        songs_used.update((link.song_a, link.song_b))
        chosen.append(link)
        if len(chosen) == wanted:
            break
    return chosen
