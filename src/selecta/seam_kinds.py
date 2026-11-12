"""What a seam is: the moves there are, how one is asked for, and what counts as good enough."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass, fields

from selecta import flags
from selecta.audit.checks import AuditReport, Check
from selecta.config import ANALYSIS_VERSION
from selecta.lyrics.lrclib import Line

RENDER_VERSION = 2

PREVIEW_SECONDS = 12.0

RIDES_BEFORE_OTHERS = 0.35

NEAR_MISS = {"beat alignment": 20.0, "level fall": 3.0, "entry level": 1.5}

UNSURE_WORDS = "Selecta can’t tell exactly when these words are sung, so it won’t cut on them."

PLACEMENTS_TO_TRY = 4

MOVES: dict[str, tuple[str, str]] = {
    "auto": ("Let Selecta pick", "The best move for these two songs that passes its checks."),
    "bass_swap_blend": ("Blend", "Both songs play in time, and they trade the bass halfway."),
    "vocal_ride": ("Vocal ride", "B's band comes in under A's voice, before B starts singing."),
    "stem_studio": ("Your stems", "You chose which stems play when, in the studio."),
    "stem_arrange": (
        "Strip and land",
        "A strips down to its melody, B is teased, then B's bass and drums land.",
    ),
    "stem_intertwine": (
        "Intertwined stems",
        "Trade drums, bass and harmonic layers over sixteen bars, with vocals taking turns.",
    ),
    "filter_sweep": ("Filter sweep", "A filters away upward as B opens up."),
    "tempo_ramp": ("Tempo ramp", "Both songs drift to a shared speed for a short overlap."),
    "word_blend": ("Word blend", "A vocal ride that hands over on a phrase both songs share."),
    "word_exchange": (
        "Call and response",
        "The voices trade a phrase over B's band until B keeps it.",
    ),
    "phrase_roll": ("Phrase roll", "A's phrase repeats, faster and faster, into B singing it."),
    "word_cut": ("Word cut", "A sets a phrase up, and B sings it."),
    "cut_on_one": ("Cut", "A clean cut onto B's downbeat."),
    "echo_out": ("Echo out", "A's last beat rings on as B lands under it."),
    "delay_throw": ("Delay throw", "A's last word is thrown into a delay as B slams in."),
    "reverb_wash": ("Reverb wash", "A dissolves into a room as B arrives."),
}

WORD_MOVES = {"word_blend", "word_exchange", "phrase_roll", "word_cut"}

STEM_MOVES = WORD_MOVES | {"vocal_ride", "stem_intertwine", "stem_studio", "stem_arrange"}

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


def moves_on() -> dict[str, tuple[str, str]]:
    """The moves this build can make, with their names and descriptions."""
    return {name: words for name, words in MOVES.items() if move_on(name)}


NOT_IN_THE_CHOOSER = {"stem_studio"}

SESSION_MOVES = {"stem_studio", "stem_arrange", STUDIO_SESSION}


@dataclass(frozen=True)
class SeamRequest:
    a: int
    b: int
    move: str = "auto"
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None
    soft: bool = False
    """Selecta chose this move, not the person, so if it doesn't pass, use whatever does."""
    shape: str | None = None
    """For the Seam Studio: which stems play when, as a person chose them."""
    leave_after: float | None = None
    """The seam into A lands this late, so this one can't start any sooner. Seconds into A."""

    @property
    def key(self) -> str:
        # r11: the request is frozen, so its key never changes. It is kept on the instance
        # (outside the fields, so equality, hashing and asdict() don't see it), and requests
        # rebuilt with the same fields share one worked out before. The text is unchanged.
        cached = self.__dict__.get("_key")
        if cached is None:
            # each value with its type, and floats by their text, so 1 and 1.0, True and 1,
            # or 0.0 and -0.0 (which json writes differently) never share a key
            values = tuple(map(self.__dict__.__getitem__, _REQUEST_FIELDS))
            same = (
                tuple(map(type, values)),
                tuple(repr(value) if type(value) is float else value for value in values),
            )
            cached = _KEYS.get(same)
            if cached is None:
                cached = self._compute_key()
                if len(_KEYS) >= _KEYS_KEPT:
                    _KEYS.clear()
                _KEYS[same] = cached
            object.__setattr__(self, "_key", cached)
        return cached

    def _compute_key(self) -> str:
        fields = asdict(self)
        # seams from before these existed keep their keys, and their audio
        for name in ("shape", "leave_after"):
            if fields[name] is None:
                del fields[name]
        text = json.dumps([fields, ANALYSIS_VERSION, RENDER_VERSION], sort_keys=True)
        return hashlib.sha256(text.encode()).hexdigest()[:20]


_REQUEST_FIELDS = tuple(field.name for field in fields(SeamRequest))
# r11: keys already worked out, by their request's fields. A library's seams number in the
# thousands; past this many the memo starts again rather than grow without end.
_KEYS: dict[tuple, str] = {}
_KEYS_KEPT = 50_000


class CannotRender(ValueError):
    """This move can't work on these two songs. The message says why, in plain words."""


CHECK_WORDS = {
    "beat alignment": ("Beats line up", "Beats drift apart"),
    "vocal overlap": ("Vocals take turns", "Two voices clash"),
    "phrase integrity": ("Nothing cut mid-line", "A line gets cut off"),
    "quiet time": ("No gap in the sound", "There's a quiet gap"),
    "entry level": ("B doesn't jump out", "B comes in too loud"),
    "level fall": ("The level holds up", "The level drops after the seam"),
    "low end clash": ("Clean low end", "Two bass lines fight"),
    "harmony": ("Keys sit together", "The keys clash"),
    "true peak": ("No clipping", "It clips"),
    "stretch": ("Tempo change is gentle", "Tempo is stretched too far"),
}


def _plain_checks(report: AuditReport) -> list[dict]:
    return [
        {
            "name": check.name,
            "passed": check.passed,
            "text": CHECK_WORDS.get(check.name, (check.name, check.name))[0 if check.passed else 1],
            "value": f"{check.value}{check.unit}",
        }
        for check in report.checks
    ]


def fallback_order(
    a: int, b: int, can_ride: bool, used: Counter[str], can_strip: bool = False
) -> list[str]:
    """What to try when a planned move can't work, with the rest of the mix in mind. Whatever the
    mix has used least comes first, so a fallback doesn't add to what it already has plenty of.
    Reverb stays last of the effects, because the listener doesn't care for it."""
    total = sum(used.values())
    rides_full = used["vocal_ride"] >= max(1.0, RIDES_BEFORE_OTHERS * total)
    blends = sorted(("filter_sweep", "bass_swap_blend", "tempo_ramp"), key=lambda move: used[move])
    effects = sorted(
        ("delay_throw", "echo_out"),
        key=lambda move: (used[move], hashlib.sha1(f"{a}{b}{move}".encode()).digest()),
    )
    ride = ["vocal_ride"] if can_ride else []
    strip = ["stem_arrange"] if can_strip else []
    middle = [*blends, *ride, *strip] if rides_full else [*ride, *strip, *blends]
    return [move for move in (*middle, *effects, "reverb_wash") if move_on(move)]


def good_enough(report: AuditReport) -> bool:
    """Passed, or only a near miss on checks that have proved stricter than the ear. None of the
    measurements told good seams from bad on the listening reels, and the beat check misreads
    syncopated drums, so a near miss is worth far more than falling back to a cut."""
    for check in report.failures:
        slack = NEAR_MISS.get(check.name)
        if slack is None or check.value > check.limit + slack:
            return False
    return True


def _what_failed(report: AuditReport) -> str:
    names = ", ".join(check.name for check in report.failures)
    return f"It didn't pass: {names}"


def usable_settings(seam: dict | None) -> dict:
    """A seam's saved settings, with a move this build can't make read as "Let Selecta pick".
    Nothing saved is changed, so turning the move back on brings the choice back."""
    seam = seam or {}
    move = seam.get("move")
    if move and not move_on(move):
        return {**seam, "move": "auto"}
    return seam


def request_from(a: int, b: int, seam: dict | None) -> SeamRequest:
    seam = usable_settings(seam)
    return SeamRequest(
        a=a,
        b=b,
        move=seam.get("move") or "auto",
        bars=seam.get("bars"),
        exit_bar=seam.get("exit_bar"),
        entry_bar=seam.get("entry_bar"),
        phrase=seam.get("phrase"),
        soft=bool(seam.get("soft", False)),
        shape=seam.get("shape"),
        leave_after=seam.get("leave_after"),
    )


def failed_checks(checks: Iterable[Check]) -> list[str]:
    return [check.name for check in checks if not check.passed]


def line_from(data: list) -> Line:
    return Line(float(data[0]), float(data[1]), str(data[2]))
