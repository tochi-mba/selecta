# Calibrating the planner's gates from ratings

The move planner refuses or marks down a pair by a handful of limits ("gates") in
`planner_core/fit.py`. They were set by hand from the first 66 rated seams. Every rendered seam
now keeps the pair's facts from render time (the `pair` block of its record, written by
`seam_context.pair_facts`), and the owner keeps clicking Good and Bad, so `selecta calibrate`
re-reads them and says, gate by gate, whether the hand-set limit still holds.

## What is fitted

| Gate | Today | Which seams | The fact | Passes when | Range |
|---|---|---|---|---|---|
| Tempo gap for a blend (`tempo`) | 4.5% | beat-locked moves | `pair.folded_gap`, else `pair.gap` | gap at or under | 2% to 8% |
| Beat grid confidence (`grid`) | 0.8 | beat-locked moves | `pair.grid` (the lower of the two) | at or over | 0.6 to 0.95 |
| Shortest blend (`overlap`) | 8 bars | beat-locked moves | the seam's `bars` | at or over | 5 to 16 |
| Key distance (`keys`) | 5 steps | beat-locked and tempo-free moves | `pair.keys` | under | 3 to 7 |
| Cut or echo tempo gap (`tempo_free_gap`) | 16% | cuts, echoes, throws, washes | `pair.folded_gap` | at or under | 8% to 20% |
| Cut or echo level step (`level_step`) | 4 dB | cuts, echoes, throws, washes | `pair.level_step`, size | at or under | 2.5 to 6 dB |

Beat-locked moves are the bass-swap blend, the filter sweep, loop room, the vocal ride and the
word and stem blends. The tempo ramp and the tempo bridge carry their own tempo limits, so their
seams are left out of the tempo gate. A seam that was the last-resort cut (`fell_back`) is left
out of every gate: no gate chose it. The level step has been kept in seam records only since
2026-11-26, so older seams can't speak to it yet.

## The rule

For each gate, the rated seams of its moves are split at a limit into those it lets through and
those it holds back. A split is weighed only with at least **5 seams on each side**, and a gate
is fitted only with at least **3 liked and 3 disliked** seams. Of the limits inside the gate's
range (each whole number for keys and bars, the midpoints between observed values otherwise,
and today's), the one with the best **balanced accuracy** wins: the mean of the share of liked
seams it lets through and the share of disliked seams it holds back, so a gate can't look good
by passing everything when most seams were liked. A tie goes to the limit nearest today's.

The verdict, in plain words:

- **keep**: today's limit is the best, or the best beats it by less than 0.05.
- **move to X (n seams)**: the best beats today's by 0.05 or more and the 95% Wilson intervals
  of the liked rate on its two sides don't overlap.
- **not enough ratings to say (n)**: too few seams, no split wide enough, or a better split
  whose intervals still overlap (the report names it, so it can be watched).

Counts and intervals only, so every line can be checked by hand from the table it prints. This
is `planner_core.calibrate`, pure: plain records in, suggestions out. A 1 to 5 listening grade
counts as liked at 4 or more and disliked at 2 or less (3 is left out) when a record carries one;
the listening study's grades are not yet linked to seam records, so the command reads Good and
Bad clicks only (to-do item).

## Reading the report

`selecta calibrate` (or `--home FOLDER` for another home) prints how many rated seams it read and
over which dates, how many were left out and why (the last-resort cut, older records without
facts, unreadable files), then one section per gate: today's split (liked and disliked let
through and held back, its balanced accuracy, the liked-rate intervals), the better split if
there is one, and the verdict. `--json` gives the same as data. It reads the seam records under
`renders/seams/*/seam.json` and `seam-history/*.json` of that one home and nothing else: not
the database, not older folders on the PC. It writes nothing.

## Applying and undoing

The owner decides when to apply. `selecta calibrate --apply` shows what would change and writes
nothing; `--apply --yes` writes `calibration.json` in the home with the date, the number of
seams and their dates, and for each moved gate its old value, its new one and the full evidence.
Only gates whose verdict is "move" are written. `selecta calibrate --reset` removes the file.

The planner core never reads the file. `selecta.calibration.desktop_gates` loads it for the
Desktop's seam planning (`seam_making`: the move a seam request plans, and whether a move is
offered) and passes it to `enumerate_candidates(gates=...)`, and only with the
`planner.calibrated_gates` flag on; with the flag off it reads no file. `Gates.with_overrides`
holds every value inside the range in the table above, whatever the file says, and ignores a
name or value it doesn't know. Cloud planning passes no gates. With the flag off or no file,
every gate is exactly today's constant.

## What is not fitted

- The recipe curves (fade shares, swap position, filter sweeps), the move preferences in
  `choose._style_fit`, the score weights and the vocal-clash allowance: they are not limits on
  one fact, and the ratings don't isolate them.
- The audit's limits (`audit/checks.py`): they judge a render, not a pair.
- The roll limits and the word rules (`vibes.py`, `wordreel.py`), the stem gates and the set
  planner (`beam.py`) keep the hand-set values even with a calibration applied (to-do item).
- The one-drummer rule's threshold (`planner_core/rhythm.py`): no seam has its rhythm in its
  record yet.
