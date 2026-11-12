"""Benchmark a replacement key method against S-KEY on a real library (ADR-0405, SC-0405-02).

S-KEY's weights can't ship in Cloud without a licence, so a replacement must first prove itself
against S-KEY on the owner's own music. This harness reads the S-KEY key Selecta already stored
for each analysed song, runs a candidate method on the same audio, and reports how often they
agree in the four ways that matter to a DJ, scored the MIREX way:

| Relation to S-KEY | Weight | Why it counts |
|---|---|---|
| same key | 1.0 | identical |
| a fifth away (same mode) | 0.5 | one step round the Camelot wheel, still mixable |
| relative major/minor | 0.3 | same notes, same Camelot number |
| parallel major/minor | 0.2 | same tonic, a common confusion |
| anything else | 0.0 | a different key |

Where the owner corrected a song's key by hand (`song_overrides.camelot`), the report also scores
S-KEY and the candidate against those corrections, because S-KEY itself is not ground truth.

The library is opened read-only and nothing is written. Choosing the threshold and the
replacement, and the listening check, stay with the owner; `meets()` only applies the threshold
they pick.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from selecta.analysis.key import camelot, chroma_key, parse_key, tonic_of_camelot

WEIGHTS = {"same": 1.0, "fifth": 0.5, "relative": 0.3, "parallel": 0.2, "other": 0.0}
RELATIONS = tuple(WEIGHTS)
FALLBACK_CONFIDENCE = 0.2
"""What `pipeline.analyse_audio` stores when S-KEY wasn't available and chroma stood in."""

Candidate = Callable[[Path], str]
"""A key method: a song's file to a key name such as "A minor"."""


def _tonic_mode(key: str) -> tuple[int, bool]:
    """A key name ("A minor") or a Camelot code ("8A") to (pitch class, is major)."""
    if " " in key:
        return parse_key(key)
    return tonic_of_camelot(key)


def relation(candidate: str, reference: str) -> str:
    """How `candidate` relates to `reference`; both may be key names or Camelot codes."""
    tonic, major = _tonic_mode(candidate)
    ref_tonic, ref_major = _tonic_mode(reference)
    step = (tonic - ref_tonic) % 12
    if major == ref_major:
        if step == 0:
            return "same"
        return "fifth" if step in (5, 7) else "other"
    if step == 0:
        return "parallel"
    # The relative minor sits three semitones below its major.
    relative = 9 if ref_major else 3
    return "relative" if step == relative else "other"


@dataclass
class Score:
    """Agreement of one method with one reference across a set of songs."""

    counts: Counter = field(default_factory=Counter)

    def add(self, candidate: str, reference: str) -> str:
        found = relation(candidate, reference)
        self.counts[found] += 1
        return found

    @property
    def songs(self) -> int:
        return sum(self.counts.values())

    def share(self, *names: str) -> float:
        return sum(self.counts[name] for name in names) / self.songs if self.songs else 0.0

    @property
    def weighted(self) -> float:
        if not self.songs:
            return 0.0
        return sum(WEIGHTS[name] * self.counts[name] for name in RELATIONS) / self.songs

    def as_dict(self) -> dict:
        return {
            "songs": self.songs,
            "counts": {name: self.counts[name] for name in RELATIONS},
            "exact": round(self.share("same"), 4),
            "mixable": round(self.share("same", "fifth", "relative"), 4),
            "weighted": round(self.weighted, 4),
        }


@dataclass
class Report:
    candidate: str
    against_skey: Score = field(default_factory=Score)
    candidate_vs_owner: Score = field(default_factory=Score)
    skey_vs_owner: Score = field(default_factory=Score)
    skipped: Counter = field(default_factory=Counter)
    disagreements: list[dict] = field(default_factory=list)

    def meets(self, threshold: float) -> bool:
        """Whether the candidate's weighted score against S-KEY reaches the owner's threshold."""
        return self.against_skey.songs > 0 and self.against_skey.weighted >= threshold

    def as_dict(self, threshold: float | None = None) -> dict:
        found = {
            "candidate": self.candidate,
            "against_skey": self.against_skey.as_dict(),
            "against_owner_corrections": {
                "candidate": self.candidate_vs_owner.as_dict(),
                "skey": self.skey_vs_owner.as_dict(),
            },
            "skipped": dict(self.skipped),
            "disagreements": self.disagreements,
        }
        if threshold is not None:
            found["threshold"] = threshold
            found["meets_threshold"] = self.meets(threshold)
        return found


def chroma_candidate(path: Path) -> str:
    """The template match already in `analysis/key.py`, run on the whole song."""
    import librosa

    from selecta import audio
    from selecta.analysis.features import FEATURE_SR, HOP, N_FFT

    mono = audio.to_mono(audio.decode(path, sample_rate=FEATURE_SR))
    power = np.abs(librosa.stft(mono, n_fft=N_FFT, hop_length=HOP)) ** 2
    chroma = librosa.feature.chroma_stft(S=power, sr=FEATURE_SR)
    return chroma_key(chroma.mean(axis=1))


CANDIDATES: dict[str, Candidate] = {"chroma": chroma_candidate}


def open_read_only(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def rows(conn: sqlite3.Connection, limit: int | None = None) -> Iterable[sqlite3.Row]:
    query = (
        "SELECT s.id, s.path, s.artist, s.title, a.key, a.key_confidence, a.key_agrees_chroma, "
        "o.camelot AS owner_camelot FROM songs s JOIN analysis a ON a.song_id = s.id "
        "LEFT JOIN song_overrides o ON o.song_id = s.id "
        "WHERE a.key IS NOT NULL AND s.is_music = 1 AND s.duplicate_of IS NULL ORDER BY s.id"
    )
    if limit is not None:
        query += f" LIMIT {int(limit)}"
    return conn.execute(query)


def _stood_in_for_skey(row: sqlite3.Row) -> bool:
    # S-KEY's confidence is at least 0.25 whenever chroma agrees, so 0.2 with agreement is the
    # chroma fallback, not an S-KEY answer.
    confidence = row["key_confidence"]
    return (
        confidence is not None
        and abs(float(confidence) - FALLBACK_CONFIDENCE) < 1e-9
        and bool(row["key_agrees_chroma"])
    )


def run(
    conn: sqlite3.Connection,
    candidate: Candidate,
    *,
    name: str = "chroma",
    limit: int | None = None,
    progress: Callable[[int], None] | None = None,
    keep_disagreements: int = 50,
) -> Report:
    report = Report(name)
    for number, row in enumerate(rows(conn, limit), start=1):
        if progress is not None:
            progress(number)
        if _stood_in_for_skey(row):
            report.skipped["no S-KEY answer"] += 1
            continue
        path = Path(row["path"])
        if not path.exists():
            report.skipped["file missing"] += 1
            continue
        try:
            guess = candidate(path)
            camelot(guess)
        except Exception:  # noqa: BLE001 - one unreadable song must not end the benchmark
            report.skipped["candidate failed"] += 1
            continue
        found = report.against_skey.add(guess, row["key"])
        if found != "same" and len(report.disagreements) < keep_disagreements:
            report.disagreements.append(
                {
                    "song_id": row["id"],
                    "artist": row["artist"],
                    "title": row["title"],
                    "skey": row["key"],
                    "candidate": guess,
                    "relation": found,
                }
            )
        owner = row["owner_camelot"]
        if owner:
            report.candidate_vs_owner.add(guess, owner)
            report.skey_vs_owner.add(row["key"], owner)
    return report


def write(report: Report, path: Path, threshold: float | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.as_dict(threshold), indent=2), "utf-8")
