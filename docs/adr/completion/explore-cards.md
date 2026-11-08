# Explore cards and the Library selection rail

## Inventory

What one mix-idea card shows (`web/src/views/Mixes.tsx`), where each value comes from
(`src/selecta/planner/vibes.py` `describe()`), and whether it decides the choice.

| Element | Source | Decision-critical? | Shown |
|---|---|---|---|
| Title | `vibe.name` | yes | always |
| Decorative motif | `VibeMotif` from the idea key and group (no artwork claim) | no | always, `aria-hidden` |
| Tempo range "X–Y BPM" | 10th–90th percentile of felt BPM of the eligible songs | yes, for DJs | when songs exist |
| "Stays within <family>" | `FAMILY_NAMES[vibe.family]` | yes | family ideas only |
| Summary | `vibe.blurb`, clamped to two lines | yes | always |
| "N matching songs" | `len(eligible)` | yes | always |
| "About m:ss of matching source songs" | eligible durations × 0.65 (`PLAYED_SHARE`) | yes | always |
| Play / Shape first / Save draft | `ask()` / `keepAsDraft()` | yes | always |
| "Draws from" artists | first four distinct artists by fit | detail | disclosure |
| How it mixes | `MOVE_WORDS[vibe.language]` | detail | disclosure |
| Planning note and consequences | static copy | yes, before committing | disclosure; the confirmation dialog repeats the replacement consequence |
| "Needs N more" | `MIN_SONGS - len(eligible)` | yes | "Needs more mix-ready songs" list |

## Default content

The scan surface shows title, tempo range, family scope, a two-line summary, two comparable facts and
three ranked actions (Play is primary). Full explanation, artists and move preferences sit behind a
named `<details>` disclosure that opens by pointer, touch and keyboard. Essential warnings are never
inside the disclosure: unavailable ideas move to their own list with the reason, and replacing the
current mix always asks first.

## Comparison facts

Every ready card shows the same two facts (matching songs; approximate source length) plus an
optional tempo range, all computed from the songs that would really be used. None is a promise of a
song order, a length or a transition quality; the disclosure says so in words.

## Promise audit

| Card promise | Planner behaviour | Verdict |
|---|---|---|
| "N matching songs" | `eligible()` filters the library by the idea's rules | true |
| tempo range | percentile of the same eligible songs | true (a range, not a target) |
| "Stays within <family>" | `family_vibe()` restricts eligibility to that family | true |
| move words | `vibe.language` weights move choice in planning | preference only - labelled so |
| approximate length | 65 % of eligible song time | approximate - labelled "About" |
| Play replaces after confirmation | `ask()` opens the replacement dialog when a mix is active | true (`web/src/views/Mixes.test.tsx` "keeps the active mix until confirmation") |
| Save draft leaves playback alone | `keepAsDraft()` only creates a draft | true |
| No genre or mood evidence beyond tags | `describe()` reads stored tags/traits only | true |

## Library rail baseline

Measured from source before and after `c95f170` (PR #36), with nothing selected:

| | Before | After |
|---|---|---|
| Controls in the batch area | 6 buttons (Select up to 200, Clear, Prioritize, Remove priority, Never play, Allow), 5 disabled | 1 button ("Select up to 200 loaded songs") + one hint |
| Explanatory text | one paragraph always visible | one short hint; the scope sentence appears with a selection |
| With a selection | same 6 buttons enabled | rail with count "N of M loaded recordings selected (limit 200)", Clear, 4 actions |

Selection entry stays visible at zero; actions appear only for a real selection; clearing returns
focus to the entry button (`web/src/views/Library.test.tsx` "contextual selection controls").
