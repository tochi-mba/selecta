"""What a song is about and how it's sung, read from its lyrics.

Tempo and energy say how a song moves, not how it feels. A sad song and a happy one can share both.
The words can tell them apart, so mixes can be built around a feeling rather than a number. These
are rough readings, compared across the library rather than trusted one song at a time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from selecta.analysis.song import SongInfo

_SEASONAL = re.compile(
    r"\b(christmas|xmas|jingle|santa|sleigh|mistletoe|reindeer|snowman|navidad|holly|noel)\b"
)

THEMES: dict[str, frozenset[str]] = {
    "heartbreak": frozenset(
        """alone apart bleed bleeding broke broken cried cry crying empty forget forgot goodbye
        gone heartbreak hurt hurting hurts leave leaving left lie lied lies lonely lose losing lost
        miss missed missing moved pain regret scars sorry tears torn walked wrong""".split()
    ),
    "love": frozenset(
        """adore babe baby beautiful darling forever heart hold holding honey hug kiss kisses love
        loved lover loves loving mine sweet sweetheart together touch yours""".split()
    ),
    "party": frozenset(
        """bottle bottles bounce club crowd dance dancefloor dancing dj drink drinks drunk floor
        friday lights music party saturday shake shots sweat tequila tonight turn weekend""".split()
    ),
    "flex": frozenset(
        """bag bands benz boss cash chain chains diamonds drip gang hustle ice millions money paid
        racks rich stacks whip""".split()
    ),
    "night": frozenset(
        """dark darkness dream dreams late midnight moon night nights shadow shadows sleep stars
        streetlights""".split()
    ),
    "open_road": frozenset(
        """beach blue drive driving free freedom highway home ocean ride road run running sky sun
        sunset sunshine summer wind wild windows""".split()
    ),
}

_ENGLISH = frozenset(
    """a all and are as at be but by can do for from get go got have he her his i if in is it just
    know like me my no not now of on one so that the there they this to up was we what when will
    with you your""".split()
)
ENGLISH_SHARE = 0.25
"""About a third of ordinary English is these few words. Well under that means another language."""


@dataclass(frozen=True)
class LyricFacts:
    """Empty for a song with no timed lyrics."""

    themes: dict[str, float] = field(default_factory=dict)
    hook: float = 0.0
    density: float = 0.0
    english: bool = False


def read_lyrics(song: SongInfo) -> LyricFacts:
    lines = song.lines
    if not lines:
        return LyricFacts()
    words = [word for line in lines for word in line.words]
    if not words:
        return LyricFacts()
    themes = {
        name: sum(word in lexicon for word in words) / len(words)
        for name, lexicon in THEMES.items()
    }
    texts = [" ".join(line.words) for line in lines if line.words]
    repeated = sum(texts.count(text) > 1 for text in set(texts))
    sung = sum(max(line.end - line.start, 0.0) for line in lines)
    return LyricFacts(
        themes=themes,
        hook=repeated / max(len(set(texts)), 1),
        density=len(words) / max(sung, 1.0),
        english=sum(word in _ENGLISH for word in words) / len(words) >= ENGLISH_SHARE,
    )


def is_seasonal(song: SongInfo) -> bool:
    """A Christmas song in a mix for any other reason is a mistake, in November or in June."""
    return bool(_SEASONAL.search((song.title or "").casefold()))


def is_english(song: SongInfo) -> bool:
    """The word timing model only knows English, and it fails on anything else."""
    return read_lyrics(song).english
