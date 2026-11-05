"""Build SongInfo objects from synthetic tracks, without the models or the database."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from synth import SR, SynthTrack, make_track

from selecta.analysis.song import SongInfo, genre_family
from selecta.lyrics.lrclib import Line


def song_from_track(
    tmp_path: Path,
    name: str,
    track: SynthTrack | None = None,
    lines: list[Line] | None = None,
    camelot: str = "8A",
    genre: str = "Dance",
    confidence: float = 0.95,
) -> SongInfo:
    track = track or make_track()
    path = tmp_path / f"{name}.flac"
    sf.write(path, track.audio, SR, subtype="PCM_24")
    bars = track.downbeats.size
    beat_index = np.arange(0, track.beats.size, 4)
    half = bars // 2
    sections = [
        {
            "start_bar": 0,
            "end_bar": half,
            "label": "verse",
            "energy": 0.6,
            "group": 0,
            "chorus_prob": 0.2,
        },
        {
            "start_bar": half,
            "end_bar": bars,
            "label": "chorus",
            "energy": 0.8,
            "group": 1,
            "chorus_prob": 0.9,
        },
    ]
    return SongInfo(
        id=abs(hash(name)) % 100000,
        path=str(path),
        artist="Synth",
        title=name,
        genre=genre,
        family=genre_family(genre),
        duration=track.audio.shape[0] / SR,
        bpm=track.bpm,
        beats=track.beats,
        bar_starts=beat_index,
        beats_per_bar=4,
        constant_tempo=True,
        grid_confidence=confidence,
        sections=sections,
        camelot=camelot,
        key_confidence=0.9,
        lufs=-14.0,
        peak_db=-2.0,
        energy=0.7,
        energy_bars=np.full(bars, 0.7, dtype=np.float32),
        low_share_bars=np.full(bars, 0.3, dtype=np.float32),
        lines=lines or [],
        vocals_known=True,
        instrumental=not lines,
    )
