"""Synthetic song facts for the Cloud planning tests (`cloud.brain`): numbers only, no audio.

`facts_body` is one song's facts as a device sends them (`PUT /api/song-facts/{song_id}`);
`song_info` builds the same song's `SongInfo` directly from the same numbers, the way Desktop's
library read does (`analysis.song.build_song`), so a test can compare the two paths.
"""

from __future__ import annotations

import numpy as np

from selecta.analysis.song import SongInfo, build_song
from selecta.engine_store import facts as song_facts

# (key, Camelot) pairs near one another on the wheel, so neighbours can blend
KEYS = (
    ("A minor", "8A"),
    ("E minor", "9A"),
    ("D minor", "7A"),
    ("C major", "8B"),
    ("G major", "9B"),
    ("B minor", "10A"),
    ("F major", "7B"),
    ("A minor", "8A"),
)
LABEL_ENERGY = {"intro": 0.35, "verse": 0.55, "chorus": 0.85, "break": 0.4, "outro": 0.3}


def _sections(bars: int) -> list[dict]:
    """An intro, then 16-bar verses and choruses in turn, a break, and an outro to the end."""
    sections, start, group = [], 0, 0
    plan = ["intro"] + ["verse", "chorus"] * 2 + ["break", "chorus"]
    for label in plan:
        length = 8 if label in {"intro", "break"} else 16
        end = min(start + length, bars - 4)
        if end <= start:
            break
        sections.append(
            {
                "start_bar": start,
                "end_bar": end,
                "label": label,
                "energy": LABEL_ENERGY[label],
                "group": {"chorus": 1, "verse": 2}.get(label, group + 3),
                "chorus_prob": 0.9 if label == "chorus" else 0.1,
            }
        )
        start, group = end, group + 1
    sections.append(
        {
            "start_bar": start,
            "end_bar": bars,
            "label": "outro",
            "energy": LABEL_ENERGY["outro"],
            "group": 9,
            "chorus_prob": 0.0,
        }
    )
    return sections


def arrays_for(seed: int, bpm: float, duration: float, sections: list[dict] | None = None):
    """The planner's seven arrays for a steady song, in their checked types, and its sections."""
    period = 60.0 / bpm
    beats = np.arange(int((duration - 1.0) / period)) * period + 0.25
    bars = beats.size // 4
    starts = (np.arange(bars) * 4).astype(np.int32)
    sections = sections if sections is not None else _sections(bars)
    rng = np.random.default_rng(seed)
    energy = np.zeros(bars)
    for section in sections:
        energy[section["start_bar"] : section["end_bar"]] = section["energy"]
    energy = np.clip(energy + rng.normal(0, 0.03, bars), 0.0, 1.0)
    chroma = rng.random((bars, 12))
    chroma = chroma / chroma.max(axis=1, keepdims=True)
    arrays = {
        "beats": beats.astype(np.float64),
        "bar_starts": starts,
        "energy_bars": energy.astype(np.float32),
        "low_share_bars": (0.2 + 0.1 * rng.random(bars)).astype(np.float32),
        "rms_db_bars": (-20.0 + 10.0 * energy).astype(np.float32),
        "chroma_bars": chroma.astype(np.float32),
        "mfcc_bars": np.clip(rng.normal(0, 20, (bars, 20)), -500, 500).astype(np.float32),
    }
    return arrays, sections


def scalars(seed: int, bpm: float) -> dict:
    key, camelot = KEYS[seed % len(KEYS)]
    return {
        "bpm": bpm,
        "constant_tempo": True,
        "grid_confidence": 0.95,
        "beats_per_bar": 4,
        "key": key,
        "camelot": camelot,
        "key_confidence": 0.8,
        "key_agrees_chroma": True,
        "lufs": -9.0 - seed % 3,
        "peak_db": -0.5,
        "energy": 0.7,
    }


def facts_body(
    seed: int,
    *,
    sha: str,
    bpm: float = 120.0,
    duration: float = 200.0,
    implementation: str = "web-dsp-1",
) -> dict:
    """One song's facts as a device sends them."""
    arrays, sections = arrays_for(seed, bpm, duration)
    return {
        "content_sha256": sha,
        "implementation": implementation,
        **scalars(seed, bpm),
        "sections": sections,
        "arrays": {name: song_facts.encode_array(name, values) for name, values in arrays.items()},
    }


def song_info(
    song_id: int,
    seed: int,
    *,
    title: str,
    artist: str,
    bpm: float = 120.0,
    duration: float = 200.0,
) -> SongInfo:
    """The same song built directly from the same numbers, as Desktop's library read builds it."""
    import json

    arrays, sections = arrays_for(seed, bpm, duration)
    values = scalars(seed, bpm)
    row = {
        "id": song_id,
        "path": "",
        "artist": artist,
        "title": title,
        "genre": None,
        "duration": duration,
        **values,
        "constant_tempo": int(values["constant_tempo"]),
        "sections": json.dumps(sections),
    }
    return build_song(row, dict(arrays), None, None)


def sha_for(seed: int) -> str:
    return f"{seed:02x}" * 32
