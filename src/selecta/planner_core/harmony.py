"""How rough two sets of notes sound together, from chroma alone.

The audit's harmony check and the planner's guess before a render share this kernel and limit, so
the planner can ask what the render's own check will roughly say. Measuring chroma from audio stays
in the audit.
"""

from __future__ import annotations

import numpy as np

HARMONY_LIMIT = 0.16

_ROUGHNESS_BY_INTERVAL = np.array(
    [0.0, 1.0, 0.45, 0.12, 0.1, 0.03, 0.6, 0.03, 0.1, 0.12, 0.45, 1.0]
)


def _roughness(chroma_a: np.ndarray, chroma_b: np.ndarray) -> float:
    a = chroma_a / np.maximum(chroma_a.sum(axis=0, keepdims=True), 1e-9)
    b = chroma_b / np.maximum(chroma_b.sum(axis=0, keepdims=True), 1e-9)
    kernel = np.stack([np.roll(_ROUGHNESS_BY_INTERVAL, i) for i in range(12)])
    return float(np.mean(np.einsum("it,ij,jt->t", a, kernel, b)))


def excess_roughness(profile_a: np.ndarray, profile_b: np.ndarray) -> float:
    """How rough two averaged chroma profiles sound together, over how rough each is alone.
    The same interval kernel as the rendered harmony check, so a planner can ask before paying
    for a render what the render's own check will roughly say."""
    a = np.asarray(profile_a, dtype=np.float64).reshape(12, 1)
    b = np.asarray(profile_b, dtype=np.float64).reshape(12, 1)
    together = _roughness(a, b)
    alone = (_roughness(a, a) + _roughness(b, b)) / 2
    return together - alone
