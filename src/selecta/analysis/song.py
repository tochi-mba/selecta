"""Everything known about one song, gathered for planning and rendering.

Cues are generated here rather than found. DJs agree on an exact cue only about a quarter of the
time, so a song has several valid ones, and the planner scores them jointly with the transition.
"""

from __future__ import annotations

import json
import re
import sqlite3
from bisect import bisect_right
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from selecta.analysis.pipeline import load_features
from selecta.config import Settings
from selecta.lyrics.lrclib import Line, parse_lrc

TARGET_LUFS = -14.0
PEAK_CEILING_DB = -1.0
VOCAL_MARGIN = 0.25
HOOK_LEAD_BARS = (4, 8, 16)

Family = Literal["hiphop", "rnb", "dance", "afro", "latin", "rock", "pop", "other"]

_FAMILIES: tuple[tuple[str, str], ...] = (
    ("afro", r"afro|amapiano|highlife|fuji"),
    ("hiphop", r"rap|hip.?hop|trap|drill|grime"),
    ("latin", r"latin|reggaeton|salsa|bachata|cumbia|dembow|regional mexican|corrido"),
    ("rnb", r"r&b|rnb|soul|funk"),
    ("dance", r"dance|house|techno|trance|electro|edm|garage|disco|drum|bass|club"),
    ("rock", r"rock|metal|punk|indie|alternativ|grunge|new wave"),
    ("pop", r"pop|singer|k-pop"),
)


def genre_family(genre: str | None) -> Family:
    text = (genre or "").lower()
    for family, pattern in _FAMILIES:
        if re.search(pattern, text):
            return family  # type: ignore[return-value]
    return "other"


@dataclass(frozen=True)
class Cue:
    bar: int
    time: float
    kind: str
    quality: float
    vocal_free_bars: int


@dataclass
class SongInfo:
    id: int
    path: str
    artist: str
    title: str
    genre: str | None
    family: Family
    duration: float
    bpm: float
    beats: np.ndarray
    bar_starts: np.ndarray
    beats_per_bar: int
    constant_tempo: bool
    grid_confidence: float
    sections: list[dict]
    camelot: str
    key_confidence: float
    lufs: float
    peak_db: float
    energy: float
    energy_bars: np.ndarray
    low_share_bars: np.ndarray
    lines: list[Line] = field(default_factory=list)
    vocals_known: bool = False
    instrumental: bool = False
    chroma_bars: np.ndarray | None = None
    rms_db_bars: np.ndarray | None = None
    mfcc_bars: np.ndarray | None = None
    _line_index: tuple | None = field(default=None, repr=False, compare=False)

    @property
    def name(self) -> str:
        return f"{self.artist} - {self.title}"

    @property
    def bar_times(self) -> np.ndarray:
        return self.beats[self.bar_starts]

    @property
    def gain_db(self) -> float:
        """Loudness match, held back so a quiet song isn't pushed into clipping."""
        return float(min(TARGET_LUFS - self.lufs, PEAK_CEILING_DB - self.peak_db))

    @property
    def period(self) -> float:
        return 60.0 / self.bpm

    def bar_time(self, bar: int) -> float:
        bars = self.bar_times
        return float(bars[int(np.clip(bar, 0, bars.size - 1))])

    def bar_at(self, time: float) -> int:
        return int(
            np.clip(np.searchsorted(self.bar_times, time + 1e-3) - 1, 0, self.bar_times.size - 1)
        )

    def beat_index_of_bar(self, bar: int) -> int:
        return int(self.bar_starts[int(np.clip(bar, 0, self.bar_starts.size - 1))])

    def singing_at(self, time: float, margin: float = VOCAL_MARGIN) -> bool:
        return any(line.start - margin < time < line.end + margin for line in self.lines)

    def mid_line(self, time: float, margin: float = 0.15) -> bool:
        """Whether a line is under way here. A boundary between two lines is a fine place to cut,
        which matters for rap, where lines often leave no gap at all."""
        return any(line.start + margin < time < line.end - margin for line in self.lines)

    def vocal_seconds(self, start: float, end: float) -> float:
        """How much singing falls in this stretch. Planning asks this constantly, so it only looks
        at lines near the stretch, which LRC's in-order lines make possible."""
        lines = self.lines
        if not lines or end <= start:
            return 0.0
        if self._line_index is None or self._line_index[0] is not lines:
            self._line_index = (lines, [line.start for line in lines])
        first = max(bisect_right(self._line_index[1], start) - 1, 0)
        total = 0.0
        for line in lines[first:]:
            if line.start >= end:
                break
            if line.end > start:
                total += min(end, line.end) - max(start, line.start)
        return total

    def vocal_free_after(self, time: float) -> float:
        """Seconds of no singing from here, or the rest of the song if there's no more."""
        if not self.vocals_known:
            return 0.0
        following = [line.start for line in self.lines if line.end > time]
        return (min(following) - time) if following else (self.duration - time)

    def vocal_free_before(self, time: float) -> float:
        if not self.vocals_known:
            return 0.0
        earlier = [line.end for line in self.lines if line.start < time]
        return (time - max(earlier)) if earlier else time

    def bars_in(self, seconds: float) -> int:
        bar_length = self.period * self.beats_per_bar
        return int(max(seconds, 0.0) / bar_length)

    def chorus_end_bars(self) -> list[int]:
        return [s["end_bar"] for s in self.sections if s["label"] == "chorus"]

    def chorus_start_bars(self) -> list[int]:
        return [s["start_bar"] for s in self.sections if s["label"] == "chorus"]

    def exit_cues(self, min_played: float = 60.0, party: bool = True) -> list[Cue]:
        """Where A could finish. A's vocal must be finished by then, never cut mid-line.

        Normally a chorus has to have played first. If that leaves nowhere to go, because a
        chorus was only found at the very end, the time floor alone applies.
        """
        first_chorus_end = min(self.chorus_end_bars(), default=None)
        floor = min_played
        if first_chorus_end is not None:
            floor = max(self.bar_time(first_chorus_end), min_played)
        cues = self._exit_cues_after(floor, party)
        return cues or self._exit_cues_after(min_played, party)

    def _exit_cues_after(self, floor: float, party: bool) -> list[Cue]:
        bars = self.bar_times
        choruses = set(self.chorus_end_bars())
        cues: list[Cue] = []
        seen: set[int] = set()

        candidates = [(s["end_bar"], s) for s in self.sections]
        for section in self.sections:
            candidates += [
                (bar, section) for bar in range(section["start_bar"] + 4, section["end_bar"], 4)
            ]
        for bar, section in candidates:
            if bar in seen or bar >= bars.size or bar < 4:
                continue
            seen.add(bar)
            time = float(bars[bar])
            if time < floor or self.duration - time < 2.0:
                continue
            if self.vocals_known and self.mid_line(time):
                continue
            is_section_end = bar == section["end_bar"]
            quality = 0.45
            kind = "phrase"
            if bar in choruses:
                quality, kind = 0.9, "after chorus"
            elif is_section_end:
                quality, kind = 0.65, "after section"
            if section["label"] == "outro":
                quality, kind = max(quality, 0.7), "outro"
            if party:
                quality *= _play_time_fit(time)
            if not self.vocals_known:
                quality *= 0.8
            cues.append(
                Cue(bar, time, kind, round(quality, 3), self.bars_in(self.vocal_free_after(time)))
            )
        return sorted(cues, key=lambda c: -c.quality)

    def entry_cues(self, min_remaining: float = 60.0) -> list[Cue]:
        """Where B could start: phrase starts in the first part of the song."""
        bars = self.bar_times
        limit = self.duration * 0.55
        cues: list[Cue] = []
        seen: set[int] = set()
        for section in self.sections:
            bar = section["start_bar"]
            if bar in seen or bar >= bars.size:
                continue
            seen.add(bar)
            time = float(bars[bar])
            if time > limit or self.duration - time < min_remaining:
                continue
            free = self.vocal_free_after(time)
            if self.vocals_known and self.mid_line(time):
                continue
            if bar == 0:
                quality, kind = 0.85, "song start"
            elif section["label"] == "chorus":
                quality, kind = 0.7, "chorus"
            elif section["label"] == "verse":
                quality, kind = 0.6, "verse"
            else:
                quality, kind = 0.5, section["label"]
            cues.append(Cue(bar, time, kind, quality, self.bars_in(free)))
        for chorus in self.chorus_start_bars():
            for lead_bars in HOOK_LEAD_BARS:
                bar = chorus - lead_bars
                if bar < 0 or bar in seen or bar >= bars.size:
                    continue
                time = float(bars[bar])
                if time > limit or self.duration - time < min_remaining:
                    continue
                if self.vocals_known and self.mid_line(time):
                    continue
                seen.add(bar)
                free = self.vocal_free_after(time)
                cues.append(Cue(bar, time, "before chorus", 0.75, self.bars_in(free)))
        return sorted(cues, key=lambda c: -c.quality)


def _play_time_fit(time: float, low: float = 105.0, high: float = 180.0) -> float:
    """Party mode wants a song to play for about 1:45 to 3:00."""
    if time < low:
        return 0.55 + 0.45 * time / low
    if time <= high:
        return 1.0
    return max(0.6, 1.0 - (time - high) / 200.0)


def refine_sections(sections: list[dict], lines: list[Line], bar_times: np.ndarray) -> list[dict]:
    """Lines that repeat across a song are strong evidence of a chorus, so blend them in."""
    if not lines:
        return sections
    repeats = Counter(" ".join(line.words) for line in lines if len(line.words) >= 2)
    refined = []
    for section in sections:
        start = bar_times[section["start_bar"]]
        end_bar = min(section["end_bar"], bar_times.size - 1)
        end = bar_times[end_bar]
        inside = [line for line in lines if start <= line.start < end]
        updated = dict(section)
        if inside:
            repeated = [line for line in inside if repeats.get(" ".join(line.words), 0) >= 2]
            share = len(repeated) / len(inside)
            updated["chorus_prob"] = round(float(0.5 * section["chorus_prob"] + 0.6 * share), 3)
            if updated["label"] in {"verse", "chorus", "break"}:
                updated["label"] = "chorus" if updated["chorus_prob"] >= 0.55 else "verse"
        elif section["label"] in {"verse", "chorus"}:
            updated["label"] = "instrumental"
            updated["chorus_prob"] = round(section["chorus_prob"] * 0.4, 3)
        refined.append(updated)
    return refined


def _at_corrected_tempo(features: dict, sections: list[dict], found: float, right: float):
    """When analysis heard a song at half or double its real speed, the beats and bars have to
    change with it, or it would be mixed as if it were still at the wrong speed. A correction that isn't
    half or double only changes what the tempo is called, since there's no way to know where those
    beats would fall."""
    ratio = right / found if found else 1.0
    beats = features["beats"]
    bar_arrays = ("energy_bars", "low_share_bars", "chroma_bars", "rms_db_bars", "mfcc_bars")
    if abs(ratio - 2.0) < 0.1:
        doubled = np.empty(beats.size * 2 - 1, dtype=beats.dtype)
        doubled[::2] = beats
        doubled[1::2] = (beats[:-1] + beats[1:]) / 2
        changed = {**features, "beats": doubled, "bar_starts": features["bar_starts"] * 2}
        starts = changed["bar_starts"]
        whole = np.arange(
            starts[0], doubled.size, (starts[1] - starts[0]) // 2 if starts.size > 1 else 4
        )
        changed["bar_starts"] = whole
        factor = whole.size / max(starts.size, 1)
        for name in bar_arrays:
            if name in features:
                changed[name] = np.repeat(features[name], 2, axis=0)[: whole.size]
        return changed, [_scaled_section(section, factor) for section in sections]
    if abs(ratio - 0.5) < 0.05:
        starts = features["bar_starts"]
        halved = beats[::2]
        whole = (starts[::2] // 2).astype(starts.dtype)
        changed = {**features, "beats": halved, "bar_starts": whole}
        for name in bar_arrays:
            if name in features:
                changed[name] = features[name][::2][: whole.size]
        return changed, [_scaled_section(section, 0.5) for section in sections]
    return features, sections


def _scaled_section(section: dict, factor: float) -> dict:
    return {
        **section,
        "start_bar": int(section["start_bar"] * factor),
        "end_bar": int(section["end_bar"] * factor),
    }


def load_song(conn: sqlite3.Connection, settings: Settings, song_id: int) -> SongInfo:
    row = conn.execute(
        "SELECT s.*, a.bpm, a.constant_tempo, a.grid_confidence, a.beats_per_bar, a.camelot, "
        "a.key_confidence, a.lufs, a.peak_db, a.energy, a.sections "
        "FROM songs s JOIN analysis a ON a.song_id = s.id WHERE s.id = ?",
        (song_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"song {song_id} hasn't been analysed")
    features = dict(load_features(settings, song_id))
    lyric = conn.execute("SELECT * FROM lyrics WHERE song_id = ?", (song_id,)).fetchone()
    corrected = conn.execute(
        "SELECT bpm, camelot FROM song_overrides WHERE song_id = ?", (song_id,)
    ).fetchone()
    lines: list[Line] = []
    vocals_known = False
    instrumental = False
    if lyric is not None:
        if lyric["status"] == "synced":
            lines = parse_lrc(lyric["synced"], row["duration"])
            vocals_known = bool(lines)
        elif lyric["status"] == "instrumental":
            vocals_known = True
            instrumental = True

    raw_sections = json.loads(row["sections"])
    bpm = row["bpm"]
    camelot = row["camelot"]
    if corrected is not None:
        camelot = corrected["camelot"] or camelot
        if corrected["bpm"]:
            features, raw_sections = _at_corrected_tempo(
                features, raw_sections, row["bpm"], corrected["bpm"]
            )
            bpm = corrected["bpm"]
    bar_starts = features["bar_starts"]
    beats = features["beats"]
    sections = refine_sections(raw_sections, lines, beats[bar_starts])
    return SongInfo(
        id=row["id"],
        path=row["path"],
        artist=row["artist"] or "Unknown artist",
        title=row["title"] or "Untitled",
        genre=row["genre"],
        family=genre_family(row["genre"]),
        duration=row["duration"],
        bpm=bpm,
        beats=beats,
        bar_starts=bar_starts,
        beats_per_bar=row["beats_per_bar"],
        constant_tempo=bool(row["constant_tempo"]),
        grid_confidence=row["grid_confidence"],
        sections=sections,
        camelot=camelot,
        key_confidence=row["key_confidence"],
        lufs=row["lufs"],
        peak_db=row["peak_db"],
        energy=row["energy"],
        energy_bars=features["energy_bars"].astype(np.float32),
        low_share_bars=features["low_share_bars"].astype(np.float32),
        lines=lines,
        vocals_known=vocals_known,
        instrumental=instrumental,
        chroma_bars=features["chroma_bars"].astype(np.float32),
        rms_db_bars=features["rms_db_bars"].astype(np.float32),
        mfcc_bars=features["mfcc_bars"].astype(np.float32),
    )
