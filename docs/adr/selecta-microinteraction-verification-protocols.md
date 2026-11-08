# Selecta microinteraction verification protocols

These protocols implement the repeatable source-level deliverables for MI-0162 and MI-0164. They do not record results that have not happened. Every result must name the exact commit, reviewer, environment, fixture and limitation in the evidence ledger.

## Reference hardware matrix - MI-0162-01

Record all fields; a row with an unknown field is not a benchmark result.

| Tier | CPU / cores | GPU + driver | RAM | Storage | OS/build | Browser/build | Display/scale | Power mode | Audio device/buffer |
|---|---|---|---|---|---|---|---|---|---|
| Minimum supported | Required | Required | Required | Required | Windows build | Edge build | Resolution + scale | Plugged/battery | Device + sample rate |
| Typical | Required | Required | Required | Required | Windows build | Edge build | Resolution + scale | Plugged/battery | Device + sample rate |
| Stress/reference | Required | Required | Required | Required | Windows build | Edge build | Resolution + scale | Plugged/battery | Device + sample rate |

Also record cold/warm cache, library/mix/draft sizes, analysis/render activity, network state, theme, motion preference and whether DevTools recording overhead was present.

## Performance thresholds - MI-0164-06

These are release thresholds, not current measurements:

- Core navigation and ordinary controls: p75 INP ≤200 ms on minimum hardware; no single interaction >500 ms without a visible working state.
- Normal-motion UI: p95 frame duration ≤32 ms and no avoidable main-thread task >50 ms during route, overlay, card, grid or transport interaction.
- Reduced motion: no spatial animation and no continuous decorative animation; information and focus order remain identical.
- Library: first 100-row response and interaction remain usable with 20,000 songs; scrolling, menus and focus have no long task >100 ms attributable to rendering the loaded page.
- Editor: 100-song timeline keeps keyboard focus and reorder/selection response within the INP target; offscreen containment must not hide focused or open-menu content.
- Studio: 64 cells keep pointer and keyboard toggles within the INP target; playback scheduling must not depend on React render completion.
- Audio: no unexpected audible gap/overlap, duplicate preview, stale resume or timing drift in the defined load scenarios.

Publish raw trace filenames, captured time range and calculation method; do not report estimates as measurements.

## Visual candidate matrix - MI-0164-02

Capture each meaningful ready/loading/empty/partial/failure/recovery state, not only the ideal page.

| Surface | Dark | Light | System | Reduced motion | 320/375/430 | 768 | 1280/2560 | 200/400% zoom |
|---|---|---|---|---|---|---|---|---|
| First run / readiness | Required | Required | Required | Required | Required | Required | Required | Required |
| Listen / Stage / lyrics / seam | Required | Required | Required | Required | Required | Required | Required | Required |
| Mix ideas / My Mixes / drafts | Required | Required | Required | Required | Required | Required | Required | Required |
| Editor / Inspector | Required | Required | Required | Required | Required | Required | Required | Required |
| Studio | Required | Required | Required | Required | Required | Required | Required | Required |
| Library / song details | Required | Required | Required | Required | Required | Required | Required | Required |
| Requests / discovery | Required | Required | Required | Required | Required | Required | Required | Required |
| Workspace / export / studies | Required | Required | Required | Required | Required | Required | Required | Required |
| Dialogs / drawers / toasts / offline | Required | Required | Required | Required | Required | Required | Required | Required |

Each image filename includes SHA, route, fixture, state, theme, viewport, scale and motion mode. Candidate images are review inputs, never automatic approval.

## Auditory continuity protocol - MI-0164-03

1. Use real local audio with at least short/long tracks, silence at boundaries, different sample rates and difficult tempo/key pairings.
2. Capture the output device loopback while exercising normal handoff, late seam readiness, seam failure, skip, seek, Previous/Next, preview start/stop, Stage, Studio, discovery, request bridge and export preview.
3. Annotate expected and observed source start/end, seam cue, gap/overlap, preview owner, pause/resume intent generation and fallback.
4. Decode exported FLAC and compare song order, duration and frozen revision identity with the accepted job.
5. Record audible defects and raw files. A clean synthetic/unit test is not a listening pass.

## Uncoached task study - MI-0164-04

Use consented participants who did not build the feature. Record denominator, completion, wrong turns, hesitation, recovery, assistance and participant wording for:

1. Add a folder and reach first sound.
2. Choose and play a mix.
3. Request a song and understand any bridge/consent.
4. Edit/reorder a song and audition a transition.
5. Shape and apply a Studio transition.
6. Export the intended frozen revision and find the file.
7. Recover from an injected load, mutation and render failure.

Separate observed outcomes from preference and design interpretation. Never claim superiority without a defined comparison and raw counts.

## Rollback and preservation rehearsal - MI-0164-07

Use an isolated copied data directory; never the participant's only library.

1. On the old build, create preferences, current mix, multiple drafts, undo history, requests, ratings, corrections and export jobs; record canonical IDs and hashes.
2. Start playback, then stop cleanly. Snapshot the database and generated assets.
3. Open the exact candidate SHA, exercise reads and one mutation per scope, then stop cleanly.
4. Reopen the old build against the copied data. Compare original-file hashes, current/draft order and identity, preferences, ratings, corrections, requests and recoverable jobs.
5. Reopen the candidate and repeat the comparison. Record migrations, irreversible fields and recovery instructions.

`tests/rollback_check.py` is the automated baseline; an old→new→old rehearsal on the recorded candidate remains independent evidence.

## Controlled language - MI-0163-01 through MI-0163-03

- **Song:** a library recording. **Current mix:** the one playback owns. **Draft:** saved editable work that cannot affect playback until explicitly played.
- **Transition / seam:** the handoff between adjacent songs. Use “transition” in user-facing copy; “seam” may remain an internal/API term.
- **Requested:** user intent has been accepted. **Queued / rendering:** work has not finished. **Ready / rendered:** an artifact exists for the matching revision. **Heard / human-rated:** a person actually listened.
- **Request:** a desired song. **Bridge:** an additional proposed song that requires consent. **Render line:** preparation priority, never playback order.
- **Source:** original local media, never modified. **Preview:** temporary audition that owns audio focus. **Export:** a frozen-revision FLAC job and artifact.
- **Candidate / suggested:** generated or ranked option, not checked. **Prepared:** machine work completed. **Checked:** named automated or human criterion passed. **Human-rated:** a recorded person evaluated it.

Destructive and playback-affecting actions name the object and consequence: “Delete Friday night” plus recovery, “Replace current mix with draft” plus preservation, “Play next” versus “Add”, and “Take out of render line” explicitly not changing playback order. Success copy is emitted only after the authoritative mutation response.

