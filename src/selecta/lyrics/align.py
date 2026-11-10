"""Find exactly when each word of a known line is sung.

The lyric text is already known, so this is forced alignment rather than transcription: an acoustic
model says what each 20 ms of audio sounds like, and a search finds the best path through the line's
letters. The audio window is wider than the line because LRC times are approximate, so the path may
start and finish anywhere inside it.

A forced fit always returns an answer, even a wrong one, and letter scores run low on singing
even when the timing is right. So the check is independent: the same model also says what it hears
with no lyrics to guide it, and a fit is trusted when its words start where those words start.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

import numpy as np

from selecta import jobs
from selecta.lyrics.lrclib import Line

MIN_WORD_SECONDS = 0.08
MAX_EDGE_SEARCH = 0.08
HEARD_TOLERANCE = 0.1
BLANK = 0


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float
    confidence: float


def provisional_words(line: Line) -> list[Word]:
    """A line-level fallback for highlighting only; never trusted for audio cuts."""
    words = line.words
    weights = np.array([max(1, len(word)) for word in words], dtype=float)
    edges = np.r_[0.0, np.cumsum(weights) / max(weights.sum(), 1)]
    return [
        Word(
            word,
            line.start + edges[i] * (line.end - line.start),
            line.start + edges[i + 1] * (line.end - line.start),
            0.25,
        )
        for i, word in enumerate(words)
    ]


def energy_minimum_boundary(
    envelope: np.ndarray, guess: float, sample_rate: int, reach: float = MAX_EDGE_SEARCH
) -> float:
    centre = int(guess * sample_rate)
    radius = int(reach * sample_rate)
    lo, hi = max(0, centre - radius), min(envelope.size, centre + radius + 1)
    return (lo + int(np.argmin(envelope[lo:hi]))) / sample_rate if hi > lo else guess


def cut_safe(word: Word, minimum_confidence: float = 0.7) -> bool:
    return word.confidence >= minimum_confidence and word.end - word.start >= MIN_WORD_SECONDS


def spell(word: str) -> str:
    """Letters an English acoustic model knows, with accents folded away."""
    folded = unicodedata.normalize("NFKD", word)
    letters = "".join(c for c in folded if not unicodedata.combining(c)).upper()
    return re.sub(r"[^A-Z']", "", letters)


def best_path(emissions: np.ndarray, tokens: np.ndarray) -> np.ndarray:
    """The most likely frame for each token, free to start and finish anywhere in the window.

    `emissions` is log probabilities shaped (frames, labels). Scores are measured against the best
    label in each frame, so waiting costs nothing, and a letter only costs what it loses to the
    model's own favourite at that moment. Returns each token's frame.
    """
    frames, count = emissions.shape[0], tokens.size
    relative = emissions - emissions.max(axis=1, keepdims=True)
    # score[j] is the best path having emitted j tokens by this frame
    score = np.full(count + 1, -np.inf)
    score[0] = 0.0
    moved = np.zeros((frames, count + 1), dtype=bool)
    token_rows = np.arange(count)
    for t in range(frames):
        frame = relative[t]
        hold = np.maximum(frame[BLANK], frame[tokens])
        advance = score[:-1] + frame[tokens[token_rows]]
        stay = score[1:] + hold
        stay[-1] = score[-1]  # nothing left to sing, so waiting is free
        take = advance > stay
        moved[t, 1:] = take
        score[1:] = np.where(take, advance, stay)
    # walk back from the final frame
    positions = np.zeros(count, dtype=np.int64)
    j = count
    for t in range(frames - 1, -1, -1):
        if j == 0:
            break
        if moved[t, j]:
            j -= 1
            positions[j] = t
    return positions


def words_from_path(
    words: list[str],
    spellings: list[str],
    positions: np.ndarray,
    probabilities: np.ndarray,
    seconds_per_frame: float,
    origin: float,
) -> list[Word]:
    """Turn letter frames into word times. A word's end is only where its last letter began, so
    a held note runs long past it. `settle_edges` finds the real ending from the voice itself."""
    result: list[Word] = []
    cursor = 0
    for word, spelling in zip(words, spellings, strict=True):
        last = cursor + len(spelling)
        result.append(
            Word(
                word,
                origin + int(positions[cursor]) * seconds_per_frame,
                origin + (int(positions[last - 1]) + 1) * seconds_per_frame,
                float(np.mean(probabilities[cursor:last])),
            )
        )
        cursor = last + 1  # step over the separator between words
    return result


def settle_edges(
    word: Word,
    vocal: np.ndarray,
    sample_rate: int,
    origin: float,
    latest_end: float,
    frame_seconds: float = 0.01,
) -> Word:
    """Move a word's edges onto what the separated voice actually does.

    The start slides to the quiet just before the syllable. The end follows the note until the
    voice drops 18 dB below the word's own peak, so a long held word isn't cut short. Both stop at
    any neighbouring word.
    """
    mono = vocal.mean(axis=1) if vocal.ndim == 2 else vocal
    frame = max(int(frame_seconds * sample_rate), 1)
    usable = mono.size - mono.size % frame
    if usable == 0:
        return word
    envelope = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1))
    to_frame = lambda time: int(np.clip((time - origin) / frame_seconds, 0, envelope.size - 1))  # noqa: E731
    first, last = to_frame(word.start), to_frame(word.end)
    last = max(last, first + 1)
    peak = float(envelope[first : last + 1].max())
    if peak <= 1e-6:
        return word
    floor = peak * 10 ** (-18 / 20)
    stop = to_frame(latest_end)
    end = last
    while end < stop and envelope[end] >= floor:
        end += 1
    reach = int(MAX_EDGE_SEARCH / frame_seconds)
    lo = max(first - reach, 0)
    start = lo + int(np.argmin(envelope[lo : first + reach // 2 + 1]))
    return Word(
        word.text,
        origin + start * frame_seconds,
        origin + end * frame_seconds,
        word.confidence,
    )


def word_starts_heard(
    best_labels: np.ndarray, separator: int, seconds_per_frame: float
) -> list[float]:
    """Where words begin in an unguided reading: `best_labels` is the top label for each frame."""
    starts: list[float] = []
    previous = BLANK
    open_word = False
    for frame, label in enumerate(best_labels):
        if label != previous:
            if label == separator:
                open_word = False
            elif label != BLANK and not open_word:
                starts.append(frame * seconds_per_frame)
                open_word = True
        previous = label
    return starts


def letters_heard(
    best_labels: np.ndarray, labels: tuple[str, ...], seconds_per_frame: float
) -> list[tuple[float, str]]:
    """Each new letter in an unguided reading, with when it was heard."""
    found: list[tuple[float, str]] = []
    previous = BLANK
    for frame, label in enumerate(best_labels):
        if label != previous and label != BLANK and labels[label] != "|":
            found.append((frame * seconds_per_frame, labels[label]))
        previous = label
    return found


def letter_match(words: list[Word], heard: list[tuple[float, str]], margin: float = 0.06) -> float:
    """How closely the letters heard during each fitted word resemble that word, 0 to 1.

    An unguided reading runs words together ("NESO ME" for "next to me"), so comparing word starts
    alone unfairly fails good lines. Weighted by length, so long words count for more.
    """
    total, weight = 0.0, 0
    for word in words:
        spelled = spell(word.text)
        text = "".join(c for t, c in heard if word.start - margin <= t <= word.end + margin)
        total += SequenceMatcher(None, spelled, text).ratio() * len(spelled)
        weight += len(spelled)
    return total / weight if weight else 0.0


def agreement(words: list[Word], heard: list[float], tolerance: float = HEARD_TOLERANCE) -> float:
    """The share of fitted words that start where an unguided reading also hears a word start."""
    if not words:
        return 0.0
    if not heard:
        return 0.0
    points = np.array(heard)
    close = [float(np.min(np.abs(points - word.start))) <= tolerance for word in words]
    return float(np.mean(close))


class Aligner:
    """English first. Other languages score low here and so get no word cuts, for now."""

    def __init__(self, models_dir: str | None = None):
        from selecta.modes.models import require_model

        require_model("torchaudio.wav2vec2_asr_base_960h")
        import torch
        import torchaudio

        bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        options = {"model_dir": models_dir} if models_dir else None
        self._torch = torch
        self.model = bundle.get_model(dl_kwargs=options).eval()
        self.rate = int(bundle.sample_rate)
        self.labels = bundle.get_labels()
        self.index = {label: i for i, label in enumerate(self.labels)}
        self.separator = self.index["|"]

    def emissions(self, audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
        jobs.check_in()
        import soxr

        mono = audio.mean(axis=1) if audio.ndim == 2 else audio
        wave = soxr.resample(mono, sample_rate, self.rate).astype(np.float32)
        wave = (wave - wave.mean()) / (wave.std() + 1e-7)
        with self._torch.inference_mode():
            logits, _ = self.model(self._torch.from_numpy(wave)[None])
            logs = self._torch.log_softmax(logits[0], dim=-1).numpy()
        return logs, (mono.size / sample_rate) / logs.shape[0]

    def check(
        self, audio: np.ndarray, sample_rate: int, words: list[Word], origin: float = 0.0
    ) -> float:
        """How well fitted words agree with what the model hears when it isn't told the lyrics.
        Give it audio reaching well past the words, since a reading goes wrong at its edges."""
        emissions, seconds = self.emissions(audio, sample_rate)
        best = emissions.argmax(axis=1)
        starts = word_starts_heard(best, self.separator, seconds)
        letters = letters_heard(best, self.labels, seconds)
        return max(
            agreement(words, [origin + start for start in starts]),
            letter_match(words, [(origin + time, letter) for time, letter in letters]),
        )

    def align(
        self, audio: np.ndarray, sample_rate: int, text: str, origin: float = 0.0
    ) -> list[Word]:
        """Times for each word in `text`, relative to `origin`, the audio's start in the song."""
        words = Line(0.0, 0.0, text).words
        spellings = [spell(word) for word in words]
        kept = [(word, s) for word, s in zip(words, spellings, strict=True) if s]
        if not kept:
            return []
        words = [word for word, _ in kept]
        spellings = [s for _, s in kept]
        tokens = np.array(
            [self.index[c] for c in "|".join(spellings)],
            dtype=np.int64,
        )
        emissions, seconds = self.emissions(audio, sample_rate)
        if emissions.shape[0] <= tokens.size:
            return []
        positions = best_path(emissions, tokens)
        probabilities = np.exp(emissions[positions, tokens])
        return words_from_path(words, spellings, positions, probabilities, seconds, origin)
