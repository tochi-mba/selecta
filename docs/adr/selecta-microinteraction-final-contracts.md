# Remaining source-level experience contracts

This contract covers the remaining code-verifiable foundation, Library details, discovery, operations, research UI, responsive/accessibility and language requirements. The four performance profiling/stress tasks in ADR-0162 are deliberately excluded until measured evidence is produced. Human/device/AT/audio/research verification remains open throughout.

## Attention continuity and overload - ADR-0135

- **Four modes (MI-0135-02):** Listen prioritizes transport/song truth; Explore prioritizes one choice; Create prioritizes the selected work object; Operate prioritizes job/resource recovery. The persistent shell retains playback and global activity while each page exposes one primary decision.
- **Listen→Create continuity (MI-0135-05):** canonical routes carry current/draft identity; selected song/seam uses stable IDs/occurrences and playback is not recreated by navigation.
- **Overload inventory (MI-0135-07):** long/RTL/duplicate metadata, simultaneous jobs, failed requests, toast bursts and nested overlays use wrapping/stable identity, Activity aggregation, scoped failures, bounded toast behavior and focus-managed overlays.

Sources: `App.tsx`, shell/router, Now/Mix/Studio/Requests, shared overlays/toasts and responsive CSS.

## Visual tokens, hierarchy and identity - ADR-0136

- **Semantic token audit (MI-0136-01):** backgrounds, surfaces, text, muted text, borders, action/focus, ready/request/warning/error, spacing, typography, radii, shadows, controls and motion are centrally defined in `styles/tokens.css`; surface CSS consumes roles rather than redefining state meaning.
- **Accent/selection hierarchy (MI-0136-03):** primary action, current selection, focus and status use distinct semantic roles; colour is paired with text/icon/ARIA state.
- **Focus/reading width (MI-0136-07):** page and prose widths, wrapping, focus rings and responsive columns are tokenized; long content remains readable at zoom.
- **Identity preservation (MI-0136-08):** the warm charcoal/cream/electric-lime identity and light/dark/system themes remain; no fabricated artwork or generic blue-dashboard replacement is introduced.

Independent computed contrast, zoom and subjective identity review remain open.

## Motion budget - ADR-0137

**MI-0137-08:** semantic durations/easing and reduced-motion overrides are defined in tokens and the verification protocol sets INP/frame/long-task thresholds. Continuous animation is limited to truthful active progress/audio-derived visuals and stops when hidden, inactive or reduced-motion is requested. Candidate-device traces remain open.

## Library identity and details - ADR-0153/0154

- **Music identity hierarchy (MI-0153-03):** title, artist, stable duplicate qualifier, duration/tempo/key and readiness are ordered consistently; missing values are explicitly unknown/not analysed.
- **Density/touch (MI-0153-07):** comfortable/compact preference changes row density without removing actions; controls retain minimum target sizing and keyboard access.
- **Metadata provenance (MI-0154-01):** measured/detected values, corrections and readiness are separate fields; details expose source facts without presenting inference as file metadata.
- **Regeneration consequence (MI-0154-04):** correction copy names affected transitions/re-rendering and original-file safety before submission.
- **Pending/saved/retry (MI-0154-05):** the form retains input while saving, confirms only authoritative response, and scopes failure/retry to the song ID.
- **Dialog/mobile behavior (MI-0154-07):** shared focus-managed dialog/drawer behavior, wrapping and responsive controls preserve the selected song; physical-device/AT review remains open.

Sources/fixtures: `Library.tsx`, `SongDetails.tsx`, readiness state, Library/component/API tests and operations CSS.

## Discovery - ADR-0155

- **Word narrative (MI-0155-01):** query → candidates → phrase/connection → audition/review is staged; loading a candidate is not labelled heard or accepted.
- **Candidate/result distinction (MI-0155-02):** candidate, requested stage, actually playing stage, saved verdict and mix mutation are distinct states with stable IDs.
- **Listening feedback (MI-0155-05):** preview owns audio through the shared focus layer, feedback stays attached to the exact candidate/stage, and stale completion cannot move a newer task.
- **Multilingual/instrumental (MI-0155-07):** user text uses `dir=auto`/Unicode-safe matching and wrapping; instrumental/missing lyrics receive explicit states rather than invented words.

Sources/fixtures: `Links.tsx`, `Links.test.tsx`, audio focus and discovery/request API tests.

## Workspace operations - ADR-0156

- **Information priority (MI-0156-01):** blockers/actions precede diagnostic detail; ordinary healthy background work stays calm.
- **Honest jobs (MI-0156-02):** not started, queued, running, blocked, partially complete, failed, complete and unsupported states derive from authoritative counts/timestamps.
- **Resource priority (MI-0156-03):** protected/current/draft/render work and cleanup eligibility are separated; resource pressure never implies original-file deletion.
- **Storage budget (MI-0156-04):** used/limit/protected/cache components, consequences and adjustment controls remain explicit and local-first.
- **Keyboard/mobile reachability (MI-0156-07):** operations use native controls, headings and responsive disclosures; no hover/drag-only essential action.

Sources/fixtures: `Workshop.tsx`, `WorkshopPanels.tsx`, `ExportJobs.tsx`, operations CSS and Workshop tests.

## Export state and accessibility - ADR-0157

- **Job choreography (MI-0157-02):** preparing/rendering/ready/failed/expired/cancelled derive from backend jobs; quiet/late work is named without fabricated percentage.
- **Accessible progress/error (MI-0157-07):** text/status roles expose stage, snapshot identity, surviving state, failure and recovery; downloadable link exists only for ready artifact.

Sources/fixtures: `ExportPanel.tsx`, `ExportJobs.tsx`, export API/job tests and decoded-audio checker.

## Blind listening integrity - ADR-0158

- **Condition masking (MI-0158-01):** A/B labels, geometry, transport and ordering avoid revealing technique/condition before response.
- **Identical transport (MI-0158-02):** both conditions use the same preview/audio-focus component and control labels.
- **Balanced preferences (MI-0158-04):** preference/no-difference/issue controls have equal visual weight and keyboard order.
- **Response identity (MI-0158-05):** response carries trial/condition identity; late save cannot attach to a newer trial.
- **Neutral tags (MI-0158-06):** issue vocabulary describes heard observations without scoring one condition as superior.
- **Interruptions (MI-0158-07):** reload/failure preserves or explicitly voids the trial and never fabricates a completed response.

Sources/fixtures: listening-study panels, audio preview/focus, Workshop tests and study API contracts. Counterbalancing/result analysis remains human/research evidence.

## Recovery language - ADR-0159

**MI-0159-04:** every major failure message follows object + failed action + surviving state + next action. Shared `Problem`, scoped inline failures and toasts avoid success wording before authoritative response and keep retry/undo attached to the original object.

## Responsive and accessibility - ADR-0160/0161

- **Viewport geometry (MI-0160-01):** safe-area, compact navigation, player reservation, virtual-keyboard inset, responsive grids/sheets and intrinsic wrapping cover narrow/short/wide layouts. Physical screenshots remain open.
- **Sheet context (MI-0160-06):** the selected stable object remains named in drawer/inspector headings and focus returns to the originating control or logical replacement.
- **Zoom/large fonts (MI-0160-07):** rem/intrinsic layouts, wrapping, overflow handling and non-fixed content heights support reflow; formal 200/400% audit remains open.
- **Sensory equivalence (MI-0161-01):** motion, colour, waveform/countdown and audio cues have persistent text/icon/static-state equivalents; decorative visuals are hidden from AT.
- **Announcements (MI-0161-04):** essential route/song/job transitions use bounded status/live announcements; clocks, beats, lyrics and pointer motion do not continuously announce.
- **Reading/comprehension (MI-0161-06):** labels name action scope, consequences and current/draft/request/render distinctions; optional explanation remains reachable.

Sources: shell/styles, shared controls, Now, EditorRows, Studio, requests/jobs and `useReducedMotion.ts`. Named NVDA/touch/zoom/cognitive review remains open.

## Localization readiness - ADR-0163

**MI-0163-07:** user metadata uses Unicode-safe operations and `dir=auto` where identity is rendered; long text wraps, counts/plurals avoid concatenated abbreviations where practical, time/tempo units remain explicit and controls do not depend on fixed English widths. A translated fixture review remains open.

