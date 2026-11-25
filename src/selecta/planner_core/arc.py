"""Energy arcs and library-feasible targets for a planned set."""

from __future__ import annotations

import math
from collections.abc import Sequence


def target_energy(
    progress: float, preset: str = "slow_burn", custom: Sequence[float] | None = None
) -> float:
    """A two-peak 60-minute wave, normalised to 0..1."""
    x = min(1.0, max(0.0, progress))
    if custom:
        position = x * (len(custom) - 1)
        left = min(int(position), len(custom) - 1)
        right = min(left + 1, len(custom) - 1)
        fraction = position - left
        return float(custom[left]) + (float(custom[right]) - float(custom[left])) * fraction
    if preset == "steady":
        return 0.85 + 0.05 * math.sin(x * math.pi * 3)
    if preset == "climb":
        return 0.4 + 0.58 * x
    if preset == "wind_down":
        return 0.82 - 0.48 * x + 0.06 * math.sin(x * math.pi * 4)
    if preset == "peak_time":
        return min(
            1.0,
            0.72 + 0.23 * math.sin(min(x / 0.68, 1.0) * math.pi / 2) - 0.12 * max(0.0, x - 0.72),
        )
    anchors = ((0.0, 0.62), (0.3, 0.72), (0.65, 1.0), (0.78, 0.85), (0.9, 0.93), (1.0, 0.68))
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:], strict=False):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return anchors[-1][1]


def feasible_curve(
    energies: list[float], points: int = 61, preset: str = "slow_burn"
) -> list[float]:
    if not energies:
        return [0.0] * points
    ordered = sorted(energies)
    return [
        min(ordered, key=lambda value: abs(value - target_energy(i / (points - 1), preset)))
        for i in range(points)
    ]
