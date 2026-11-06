# Phrase rhythm and arrangement follow-up — 6 November 2026

## Evidence read

Robin Attas, [Defining Phrase in Popular Music](https://mtosmt.org/issues/mto.11.17.3/mto.11.17.3.attas.php), Music Theory Online 17.3 (2011), argues for identifying goal-directed musical units using several musical features, rather than equating a phrase with a breath. Its song analyses illustrate modified phrase structures. This supports retaining vocal, harmonic, and formal boundaries as distinct evidence. It does not validate an automatic phrase detector.

Nicole Biamonte, [Formal Functions of Metric Dissonance in Rock Music](https://mtosmt.org/issues/mto.14.20.2/mto.14.20.2.biamonte.php), Music Theory Online 20.2 (2014), examines grouping and displacement at rhythmic, metric, and larger structural levels. Syncopation and metric disruption can be meaningful features of arrangement. An onset away from the presumed beat is therefore insufficient evidence that a grid is wrong.

David Whitehead, [Crafting a Great DJ Set](https://articles.roland.com/crafting-a-great-dj-set/), Roland (2020), connects track preparation, phrasing, and the energy journey of a set. It discusses half/double-tempo material and phrase alignment as practical tools. This is practitioner guidance, not a controlled evaluation of an automatic mixer.

The [Beatmatch EQ discussion](https://www.reddit.com/r/Beatmatch/comments/1w4ok1d/question_about_eq_mixing/) contains firsthand descriptions of changing the entry element and EQ according to the tracks: percussion, midrange, bass clashes, and which element should recede. Accounts differ on gradual bass exchange versus a full swap. Treat these as hypotheses to audition, not universal rules or evidence that a fixed bass-swap curve works.

## Selecta consequences and required evidence

1. Keep the beat/bar countdown grounded in measured grid timestamps. A bar countdown describes the transition's temporal position; it must not imply that every fourth/eighth bar is a verified musical phrase boundary. A missing grid must remain unknown rather than being extrapolated from average BPM.
2. Score phrase endings using vocal completion, harmonic/section changes, and local arrangement. Test pickups, sustained phrases over a downbeat, extra bars, and instrumental answers; a fixed four-bar segmentation cannot establish success.
3. Preserve groove: beat-alignment audits should distinguish repeated syncopation from an actual timing offset. Validate against manually annotated beats across rap, Afrobeat, Latin, rock, and dance tracks before tightening thresholds.
4. Choose entry layers from arrangement occupancy. Compare a percussion-first entry, a harmonic-bed entry, and a bass-led handoff on the same pair. Measure vocal overlap and low-end level, then collect blind listening preferences. These are proposed comparisons, not completed listening results.
5. Harmonic compatibility needs local temporal evidence. A shared global key or mean chroma does not prove that simultaneous vocal and instrumental passages fit; chord order, local bass notes, and stem artifacts still matter.

## Runtime verification

The user subsequently confirmed that the grid is accurate. This is recorded as listening feedback on the current preview, not a library-wide annotation study.

The long-running API omitted the newly added beat/bar fields while serving the rebuilt frontend, producing the persistent “Beat grid unavailable” message. After a SQLite backup and server restart on 6 November, the live `/api/songs/140` response returned 66 bar positions, 262 beats, and four beats per bar. Analysis and mix-render requests were resumed.

Live browser verification on the same date: opened Now, pressed Play on WORSHIP, observed 39 bars remaining at bar 1 / beat 3 / playback 0:02, then 36 bars remaining at bar 4 / beat 3 / playback 0:10. Pressed Pause and observed the paused state retaining that position and countdown. The UI also exposed the live frequency visualizer and next song, squabble up. This establishes that the browser receives and advances the countdown with playback. It does not establish beat/downbeat ground-truth accuracy or subjective transition quality. Playback was left paused after verification.

The broader research backlog remains open: local harmonic tension, groove perception, auditory masking, loudness during overlaps, and blind comparisons of adaptive effects need source review and implementation-specific experiments. These notes do not establish subjective quality.
