"""Temporal harmonic candidates; bar chroma cannot establish a shared melody."""

from __future__ import annotations

import numpy as np


def harmonic_sequence(a: np.ndarray, b: np.ndarray, bars: int = 8) -> dict | None:
    """Compare every equal-length bar offset under each fixed pitch transposition.

    Reject silent and stationary windows: a held chord is weak evidence for a
    sequence connection. The threshold is a shortlist heuristic, not a quality gate.
    """
    if bars < 4:
        raise ValueError("Sequence matches need at least four bars")
    arrays = []
    for source in (a, b):
        values = np.asarray(source, dtype=float)
        if values.ndim != 2 or values.shape[1] != 12 or len(values) < bars:
            return None
        if not np.isfinite(values).all():
            return None
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        arrays.append(values / np.maximum(norms, 1e-9))
    left, right = arrays

    def windows(values):
        candidates = []
        for start in range(len(values) - bars + 1):
            window = values[start : start + bars]
            if np.any(np.linalg.norm(window, axis=1) < 0.5):
                continue
            if float(np.mean(np.sum(np.diff(window, axis=0) ** 2, axis=1))) < 0.05:
                continue
            candidates.append((start, window))
        return candidates

    best = None
    best_score = 0.93
    left_windows, right_windows = windows(left), windows(right)
    if not left_windows or not right_windows:
        return None
    left_matrix = np.stack([window for _, window in left_windows]).reshape(len(left_windows), -1)
    right_stack = np.stack([window for _, window in right_windows])
    for shift in range(12):
        right_matrix = np.roll(right_stack, shift, axis=2).reshape(len(right_windows), -1)
        scores = left_matrix @ right_matrix.T / bars
        a_index, b_index = np.unravel_index(np.argmax(scores), scores.shape)
        similarity = float(scores[a_index, b_index])
        if similarity > best_score:
            best_score = similarity
            best = {
                "a_bar": left_windows[a_index][0],
                "b_bar": right_windows[b_index][0],
                "bars": bars,
                "transpose": shift,
                "similarity": similarity,
                "method": "ordered_bar_chroma",
                "reason": (
                    "An ordered harmonic sequence matches; "
                    "melody and stem compatibility remain unverified."
                ),
            }
    return best
