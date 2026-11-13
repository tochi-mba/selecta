"""Blind mix test: anonymised trial generator and result scorer (ADR-0438, AV-0438-03).

The protocol is docs/autopilot/blind-mix-test-protocol.md. Listeners hear two excerpts per
trial, labelled only A and B, and say which they prefer and how smooth each transition felt.
They never learn which system made which excerpt.

- `generate()` builds a balanced plan: every pair of conditions is compared equally often, each
  condition sits in position A as often as in B, and excerpts rotate. It returns two separate
  things: the participant sheet (trial ids and A/B labels only) and the sealed key (which
  condition and excerpt each label is). The key stays with the person running the session.
- `score()` joins responses to the key and reports, per condition, wins, the preference rate,
  a two-sided exact binomial p-value against no preference, and mean ratings.

This module holds no participant results. Running sessions with listeners is a person step.

    python -m selecta.venueops.blind_test plan.json --participants 12 --out <dir>
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import random
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

FLAG = "venue.rollout_gates"
RATINGS = ("transition_smoothness", "fits_the_room", "would_keep_playing")


@dataclass(frozen=True)
class Trial:
    trial_id: str
    participant: str
    a_condition: str
    a_excerpt: str
    b_condition: str
    b_excerpt: str

    def sheet_row(self) -> dict:
        return {"trial": self.trial_id, "participant": self.participant,
                "play_first": "A", "play_second": "B"}

    def key_row(self) -> dict:
        return {"trial": self.trial_id, "A": [self.a_condition, self.a_excerpt],
                "B": [self.b_condition, self.b_excerpt]}


def _opaque(seed: int, *parts: str) -> str:
    return hashlib.sha256("|".join((str(seed), *parts)).encode()).hexdigest()[:10]


def generate(
    excerpts: Mapping[str, Sequence[str]],
    participants: int,
    *,
    repeats: int = 2,
    seed: int = 438,
) -> tuple[list[dict], list[dict]]:
    """(participant sheet, sealed key) for a balanced, anonymised blind test."""
    conditions = sorted(excerpts)
    if len(conditions) < 2:
        raise ValueError("A blind test needs at least two conditions.")
    if any(not excerpts[c] for c in conditions):
        raise ValueError("Every condition needs at least one excerpt.")
    if participants < 1 or repeats < 1:
        raise ValueError("Need at least one participant and one repeat.")
    rng = random.Random(seed)
    pairs = list(itertools.combinations(conditions, 2))
    rotation = {c: 0 for c in conditions}
    trials: list[Trial] = []
    for p in range(participants):
        person = f"P{p + 1:02d}"
        planned: list[tuple[str, str]] = []
        for r in range(repeats):
            for n, (x, y) in enumerate(pairs):
                # Alternate positions by participant, repeat and pair so A/B balance exactly.
                planned.append((x, y) if (p + r + n) % 2 == 0 else (y, x))
        rng.shuffle(planned)
        for a, b in planned:
            ea = excerpts[a][rotation[a] % len(excerpts[a])]
            eb = excerpts[b][rotation[b] % len(excerpts[b])]
            rotation[a] += 1
            rotation[b] += 1
            tid = _opaque(seed, person, str(len(trials)))
            trials.append(Trial(tid, person, a, ea, b, eb))
    return [t.sheet_row() for t in trials], [t.key_row() for t in trials]


def binomial_two_sided(wins: int, n: int) -> float:
    """Exact two-sided p-value for `wins` of `n` against a fair coin."""
    if n == 0:
        return 1.0
    probs = [math.comb(n, k) / 2**n for k in range(n + 1)]
    observed = probs[wins]
    return min(1.0, sum(p for p in probs if p <= observed + 1e-12))


def score(key: Iterable[Mapping], responses: Iterable[Mapping]) -> dict:
    """Join responses ({trial, prefer: "A"|"B", ratings: {A: {...}, B: {...}}}) to the key."""
    by_trial = {row["trial"]: row for row in key}
    wins: dict[str, int] = {}
    shown: dict[str, int] = {}
    pair_wins: dict[tuple[str, str], list[int]] = {}
    ratings: dict[str, dict[str, list[float]]] = {}
    unknown: list[str] = []
    for response in responses:
        row = by_trial.get(response.get("trial"))
        if row is None:
            unknown.append(str(response.get("trial")))
            continue
        a, b = row["A"][0], row["B"][0]
        prefer = str(response.get("prefer", "")).upper()
        for cond in (a, b):
            shown[cond] = shown.get(cond, 0) + 1
            wins.setdefault(cond, 0)
        pair = tuple(sorted((a, b)))
        tally = pair_wins.setdefault(pair, [0, 0])
        if prefer in ("A", "B"):
            winner = a if prefer == "A" else b
            wins[winner] += 1
            tally[pair.index(winner)] += 1
        for label, cond in (("A", a), ("B", b)):
            for name, value in (response.get("ratings", {}).get(label) or {}).items():
                if name in RATINGS:
                    ratings.setdefault(cond, {}).setdefault(name, []).append(float(value))
    return {
        "conditions": {
            cond: {
                "shown": shown[cond],
                "wins": wins[cond],
                "preference_rate": round(wins[cond] / shown[cond], 4) if shown[cond] else None,
                "mean_ratings": {k: round(sum(v) / len(v), 3)
                                 for k, v in ratings.get(cond, {}).items()},
            }
            for cond in sorted(shown)
        },
        "pairs": [
            {"pair": list(pair), "wins": tally,
             "p_value": round(binomial_two_sided(tally[0], sum(tally)), 4)}
            for pair, tally in sorted(pair_wins.items())
        ],
        "unknown_trials": unknown,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m selecta.venueops.blind_test")
    parser.add_argument("plan", type=Path, help="JSON: {condition: [excerpt ids]}")
    parser.add_argument("--participants", type=int, default=12)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--seed", type=int, default=438)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    sheet, key = generate(json.loads(args.plan.read_text("utf-8")), args.participants,
                          repeats=args.repeats, seed=args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "participant-sheet.json").write_text(json.dumps(sheet, indent=2), "utf-8")
    (args.out / "sealed-key.json").write_text(json.dumps(key, indent=2), "utf-8")
    print(f"{len(sheet)} trials written; keep sealed-key.json away from listeners.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
