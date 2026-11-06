# Groove perception and listening evaluation — 6 November 2026

## Evidence and limits

Witek et al., [Syncopation, Body-Movement and Pleasure in Groove Music](https://pmc.ncbi.nlm.nih.gov/articles/PMC3989225/) (2014), reports an inverted-U relationship between syncopation and ratings of pleasure/wanting to move for the drum-break stimuli studied. This supports treating groove as more than tempo or onset alignment. It does not establish a universal optimum for full-song DJ overlaps, genres, listeners, or separated stems. The publication also has a [2015 correction record](https://pubmed.ncbi.nlm.nih.gov/26401949/); retain that association when citing it.

[ITU-R BS.1116-3](https://www.itu.int/rec/R-REC-BS.1116-3-201502-I) concerns subjective assessment of small impairments in audio systems. Its hidden-reference methodology is relevant to reducing identity bias, but Selecta's creative transition preferences are a different outcome. A paired preference study must not be advertised as BS.1116 compliance merely because method names are hidden.

## Consequences for Selecta

- Preserve the source's stable groove and subdivisions. An off-grid onset can be intentional syncopation; avoid treating every offbeat transient as a beat-tracking error.
- Compare rhythm in local passages. Whole-track BPM and energy cannot establish whether two simultaneous drum patterns reinforce or compete with one another.
- Do not automatically add microtiming jitter to sound human. The cited study does not demonstrate that random timing errors improve groove.
- Separate timing integrity from preference: a transition can have accurate downbeats and still sound crowded, dull, or stylistically wrong.

## Required paired comparison

Use the same ordered song pair and source cues for conventional and adaptive renders. Match playback loudness and excerpt duration; include enough surrounding music to judge the handoff. Randomize A/B placement per trial and conceal style names and metadata. Preserve the hidden mapping independently of the review screen. Allow replay, a tie/no-preference response, and an explicit cannot-judge response.

Ask separately about continuity of groove, vocal intelligibility, exposed stem artifacts, energy continuity, and overall preference. Record pair, source cue, renderer version, condition mapping, randomization seed, response, and listening setup. Keep unanswered trials unanswered. A failed render is an engineering failure and must not silently vanish from the denominator.

Report completed trials and listeners, ties, missing answers, per-pair outcomes and uncertainty. Do not treat repeated ratings by one listener on the same pair as independent listeners. Reserve held-out pairs before tuning from feedback. Existing Good/Bad preview tags remain useful pair-level feedback but are not a blinded comparative study.

## Current gate

Trial storage, an anonymous A/B API, Workshop review controls, and a validated audio importer are implemented. Completed paired results are still missing. These notes define the experiment needed; they are not evidence that Selecta wins it. The user's confirmation of the current grid is valuable direct feedback, but does not substitute for comparison of adaptive effects and conventional transitions.

On 6 November, study `listening-01` registered one exploratory comparison of cached phrase-roll variants for ordered song IDs 271 → 154. Both previews have 1,806,087 frames at 44.1 kHz, equal declared source start/end, transition duration and preview offset. Decoded sample differences establish distinct audio, not an improvement. Source revision provenance is unknown and is explicitly recorded as such. Study copies are loudness matched and preserved outside disposable caches. This trial cannot be used as an adaptive-versus-baseline result. It has no recorded response. The currently running server still needs the listening routes deployed before the Workshop can use it.
