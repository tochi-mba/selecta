# Selecta — creative-interface implementation checklist: 140 individually tracked CI tasks

**Documentation-only proposal, 2026-11-08. Decision: 20 Accepted (owner approved 2026-11-08). Implementation: 140 Not started, 0 In progress, 0 Implemented. Independent verification: 0 Verified.** All implementation boxes remain unchecked. Previous MI code/status does not automatically complete a new CI requirement.

**Tracking rule:** A checked box eventually means merged implementation and its tests, not independent verification. Every item separately tracks the owner, implementing PR/SHA and real-world evidence in the [CI evidence ledger](selecta-creative-interface-implementation-evidence.md).


## [ADR-0165 — Creative-interface charter and attention modes](adr-0165-creative-interface-charter.md)

**Priority / phase:** P0 / Foundation. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0165-01 — Inventory current scenes and interruptions.** **Acceptance:** Map primary action, supporting data, conflicts and source state for every core journey. **Required verification:** Annotated source baseline and uncoached observation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-02 — Define Explore Create Listen scene hierarchy.** **Acceptance:** Each has one first-glance focal object without losing advanced actions. **Required verification:** Design specimens in both themes and five-second glance test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-03 — Specify entry, exit and context retention.** **Acceptance:** Route, Back/Forward, current/draft and selected seam survive changes. **Required verification:** History, focus, audio and revision regression tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-04 — Establish intentional interruption policy.** **Acceptance:** Only consent, requested overlay and significant failure may interrupt. **Required verification:** Injected render/request/error fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-05 — Define music-led language and affordance policy.** **Acceptance:** Intent controls do not require BPM/cues while experts can still reach them. **Required verification:** Novice/expert comprehension study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-06 — Document attention and visual-intensity limits.** **Acceptance:** No unrelated autoplay, constant pulsing, competing CTA or disguised status. **Required verification:** Audited scene checklist and reduced-motion fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0165-07 — Record end-to-end quality baseline.** **Acceptance:** First play, edit, seam preview, request and export remain complete without hidden changes. **Required verification:** Real-audio, keyboard and participant protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0166 — Shared song, seam, Energy Horizon and route visual grammar](adr-0166-music-object-visual-grammar.md)

**Priority / phase:** P0 / Foundation. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0166-01 — Specify four reusable musical objects.** **Acceptance:** Each has stable identity, semantic variants and known/unknown representations. **Required verification:** Component specimens at compact and full sizes. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-02 — Design decorative song fingerprint provenance.** **Acceptance:** Identical song yields stable motif with no genre or quality inference. **Required verification:** Missing metadata, duplicate title and re-render fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-03 — Define seam visual technique catalogue.** **Acceptance:** Supported methods are recognizably different and accurately named. **Required verification:** Expert diagram versus rendered seam review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-04 — Separate requested and achieved energy.** **Acceptance:** Unknown/relative analysis never appears numerically comparable with user shape. **Required verification:** Data provenance and user interpretation audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-05 — Encode semantic colours and patterns.** **Acceptance:** Status remains legible without color and on light/dark/forced colours. **Required verification:** Computed contrast and AT snapshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-06 — Validate visual scaling across surfaces.** **Acceptance:** Mini-player/card/timeline/inspector share object without overflow. **Required verification:** 320–2560px and 400% zoom review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0166-07 — Evaluate diagram meaning without legend.** **Acceptance:** Listeners can distinguish planned, audible and unavailable states. **Required verification:** Uncoached graphic comprehension study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0167 — Cross-scene continuity, contextual navigation and persistent context](adr-0167-creative-scene-continuity.md)

**Priority / phase:** P0 / Foundation. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0167-01 — Map exact object identity across routes.** **Acceptance:** Mix/scope/seam/song IDs survive navigation and stale responses. **Required verification:** Deep-link and popstate matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-02 — Storyboard mix idea to generated sequence.** **Acceptance:** The selected concept remains identifiable without false rendered state. **Required verification:** Confirmed-build fixture and review video. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-03 — Storyboard seam to Inspector to Studio.** **Acceptance:** Same pair/revision and audio owner always preserved. **Required verification:** Open/close/reorder conflict test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-04 — Prioritize contextual actions in shell.** **Acceptance:** Primary creation and request actions clear without utility clutter. **Required verification:** Keyboard/desktop/mobile focus review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-05 — Design responsive panel and return path.** **Acceptance:** Closing sheet returns to originating song/seam with meaningful focus. **Required verification:** Escape, nested modal and 320px tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-06 — Protect playback through page transitions.** **Acceptance:** No route change unexpectedly plays, seeks or resumes audio. **Required verification:** Real audio multitab and manual Pause audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0167-07 — Test stale state and deep-link recovery.** **Acceptance:** Missing draft or late build never steals navigation or changes wrong mix. **Required verification:** Network-race and missing-route tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0168 — Make a Mix: expressive idea selection and honest result reveal](adr-0168-expressive-mix-selection-and-reveal.md)

**Priority / phase:** P0 / Explore. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0168-01 — Design featured hero and one primary CTA.** **Acceptance:** Intent, Play and approximate length readable at first glance. **Required verification:** 375/1440px screenshots and glance testing. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-02 — Create distinct card motif set.** **Acceptance:** The moment/mood/sound/journey distinguishable without made-up facts. **Required verification:** Motif provenance and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-03 — Retain all three card commitments.** **Acceptance:** Play/Shape/Save reachable and correctly scoped on keyboard/touch. **Required verification:** Replacement and draft creation tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-04 — Design approximate-length effect.** **Acceptance:** Choice changes intention graphic without promising exact minutes. **Required verification:** Short/long fixtures and copy review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-05 — Reveal generated track order honestly.** **Acceptance:** Only server-returned songs and seam states are shown as created. **Required verification:** Slow, error, stale and success build tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-06 — Avoid button-heavy mobile cards.** **Acceptance:** No accidental change of current playing mix from card surface. **Required verification:** Usability and 320px touch test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0168-07 — Measure first choice confidence.** **Acceptance:** Users choose intended feeling without technical coaching. **Required verification:** Uncoached task completion and hesitation counts. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0169 — Energy Horizon, tactile shaping and destination scope](adr-0169-energy-horizon-and-scoped-shaping.md)

**Priority / phase:** P0 / Create. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0169-01 — Design reusable five-stop horizon.** **Acceptance:** Same semantic start/finish form works in builder/draft/editor. **Required verification:** Responsive and state specimens. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-02 — Specify finger/stylus drawing precision.** **Acceptance:** Pointer capture, scroll behaviour and cancellation are deterministic. **Required verification:** Touch and stylus trace tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-03 — Preserve numeric and keyboard equivalence.** **Acceptance:** Every point editable at 400% zoom without SVG interaction. **Required verification:** NVDA and keyboard tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-04 — Separate intended and measured arc scales.** **Acceptance:** No misleading comparison or invented song energy. **Required verification:** Data and copy validation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-05 — Create overlap-style mini diagrams.** **Acceptance:** Smooth/punchy/adaptive visually meaningful but no audio claim. **Required verification:** Expert comprehension and static fallback. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-06 — Clarify destination and settings scope.** **Acceptance:** User understands future defaults, fallback and cancellation. **Required verification:** Reload/error/global-setting scenario tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0169-07 — Measure perceived creative control.** **Acceptance:** User can describe and achieve different journeys. **Required verification:** Uncoached task and actual musical-result review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0170 — Listen: audio-clock musical scene, real spectrum and handoff](adr-0170-listen-audio-clock-and-handoffs.md)

**Priority / phase:** P0 / Listen. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0170-01 — Prototype dominant Listen song scene.** **Acceptance:** Song/artist and transport legible while Next remains discoverable. **Required verification:** Dark/light mobile and wide-display review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-02 — Specify real audio-reactive motif variants.** **Acceptance:** No animation without actual analyzer data and valid audio ownership. **Required verification:** Muted, paused, hidden-tab and low-power fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-03 — Design two-song transition representation.** **Acceptance:** Visual overlap matches real seam timing and fallback semantics. **Required verification:** Real recorded audio synchronized to frame timeline. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-04 — Clarify beat countdown and seeking.** **Acceptance:** Beat labels conditional on known data and blocked seek clearly explained. **Required verification:** Missing timing, seek-during-seam and touch tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-05 — Refine intensity settings and persistence.** **Acceptance:** Quiet/standard/focused never change playback or create audio. **Required verification:** Preference and navigation regression tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-06 — Protect playback and main-thread budget.** **Acceptance:** Visual effects cannot cause gaps or missed input under render load. **Required verification:** Measured frame/audio trace on named hardware. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0170-07 — Validate listener anticipation and comfort.** **Acceptance:** People can predict handoff without visual fatigue or misinformation. **Required verification:** Uncoached real-audio participant study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0171 — Lyrics, authentic wordplay handoffs and fullscreen Stage](adr-0171-lyrics-wordplay-and-stage.md)

**Priority / phase:** P1 / Listen. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0171-01 — Specify lyrics confidence levels.** **Acceptance:** UI distinguishes timed word, line, plain and missing lyric with truthful fallback. **Required verification:** Actual synced/unsynced/instrumental fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-02 — Design shared-phrase visual choreography.** **Acceptance:** Phrase continuity shows real source text and does not imply false precision. **Required verification:** Verified wordplay clip review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-03 — Compose immersive Stage identity.** **Acceptance:** Readable title, lyrics and minimum transport from a distance. **Required verification:** 1440/2560px large-screen and physical distance testing. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-04 — Protect manual lyric scroll and focus.** **Acceptance:** Automatic following never wrestles manual browsing. **Required verification:** Keyboard, wheel, touch and assistive-tech tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-05 — Preserve fullscreen rejection and exit.** **Acceptance:** Escape, focus restoration and paused state function in both modes. **Required verification:** Browser fullscreen-denied and Back test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-06 — Specify reduced motion and contrast.** **Acceptance:** No flash, scrolling overload or foreground loss over reactive visuals. **Required verification:** Reduced-motion and photosensitivity review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0171-07 — Measure audiovisual lyric correspondence.** **Acceptance:** Screened handoff is not earlier or more precise than valid data. **Required verification:** Recorded frame-by-frame audio/video comparison. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0172 — Transition Inspector: interpretive seam diagrams and honest A/B audition](adr-0172-seam-inspector-and-audition-comparison.md)

**Priority / phase:** P0 / Create. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0172-01 — Define diagram variants by real technique.** **Acceptance:** Each actual move has accurately labeled distinct graphic. **Required verification:** Expert semantic review and rendered examples. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-02 — Preserve pair/revision identity.** **Acceptance:** Inspector never edits or auditions a newly unrelated seam after reorder. **Required verification:** Stale pair, repeated title and race tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-03 — Separate intent, render and quality.** **Acceptance:** Requested move and actual fallback never conflated with human rating. **Required verification:** Passed-warning-fallback fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-04 — Expose disabled-move reasons.** **Acceptance:** Keyboard and pointer can understand unsupported choice. **Required verification:** Cue and tempo-compatibility test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-05 — Write optional immutable A/B contract.** **Acceptance:** UI only shows compare when two actual revisions and previews exist. **Required verification:** API feasibility review and provenance check. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-06 — Integrate auditory focus and cancellation.** **Acceptance:** No overlapping main/preview audio or surprise resume. **Required verification:** Real-media and multi-tab tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0172-07 — Evaluate comprehension and creative control.** **Acceptance:** Novices can hear/change a seam and identify real resulting move. **Required verification:** Observed audition-edit-compare task. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0173 — Arrangement timeline: tactile songs, seam edges and energy overview](adr-0173-tactile-mix-editor-and-energy-overview.md)

**Priority / phase:** P0 / Create. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0173-01 — Define song block/seam link material.** **Acceptance:** Song and connection distinguishable without extra reading. **Required verification:** Full density and 320px specimens. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-02 — Prototype affected-seam drag preview.** **Acceptance:** Users see valid insertion and relevant changed neighbours. **Required verification:** Pointer and repeated-ID move fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-03 — Preserve keyboard and touch reorder.** **Acceptance:** Handle never traps vertical scroll; non-drag path has same result. **Required verification:** Coarse pointer, focus and keyboard tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-04 — Implement optional honest energy mini-map.** **Acceptance:** Real relative energy shown with unknown fallback and stable current position. **Required verification:** 40+ track and metadata-missing sample. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-05 — Clarify lock, draft scope and revision.** **Acceptance:** Cannot accidentally edit current while drafting or unlock by drag. **Required verification:** Revision and current/draft tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-06 — Animate confirmed add/remove/undo only.** **Acceptance:** Displayed row order equals actual returned authoritative state. **Required verification:** Conflict, failed write and Undo fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0173-07 — Measure long-editor response.** **Acceptance:** Inspector, open menus and 40+ songs stay interactive. **Required verification:** Performance trace and screen reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0174 — Stem Studio: tactile layers, accurate playhead and human–Selecta differences](adr-0174-stem-studio-tangible-layers-and-diffs.md)

**Priority / phase:** P0 / Create. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0174-01 — Design eight-lane visual material system.** **Acceptance:** Four parts and both songs recognized through text/pattern, not only hue. **Required verification:** Color-blind, forced-colors and expert review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-02 — Specify Shape Grid List equivalence.** **Acceptance:** No mode switch loses or coarsens cell values or focus. **Required verification:** 8–64-cell roundtrip property tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-03 — Refine painting and solo feedback.** **Acceptance:** Pointer strokes toggle once per cell; solo never changes saved arrangement. **Required verification:** Pointer, keyboard and audio tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-04 — Drive true preview playhead.** **Acceptance:** Preview cursor follows deck and stops on Stop, error, hidden and close. **Required verification:** Real clock and audio owner tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-05 — Show exact AI suggestion diffs.** **Acceptance:** Only returned changes highlighted and old shape recoverable. **Required verification:** Stale-tune, canceled generation and Undo fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-06 — Clarify recovery versus applied audio.** **Acceptance:** Unsaved/recovered/applying/rendered all visibly distinct. **Required verification:** Storage-quota, restart and render failure tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0174-07 — Validate low-resource Studio precision.** **Acceptance:** Grid responsive and audible preview free of overlap during render load. **Required verification:** Named-device input/frame/audio measurements. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0175 — Requests: visible musical routes, ghost placement and bridge consent](adr-0175-requests-and-consented-route-visualization.md)

**Priority / phase:** P0 / Engage. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0175-01 — Specify intent/position/ready visual states.** **Acceptance:** User can distinguish requested, proposed and audible states. **Required verification:** State-machine and screen-reader fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-02 — Design direct versus bridge route graphic.** **Acceptance:** Only returned ordered songs and valid edges shown. **Required verification:** Bridge search and unavailable-route tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-03 — Add provisional timeline representation.** **Acceptance:** Ghost position cannot be confused with a ready playable transition. **Required verification:** Editor and request integration fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-04 — Preserve approval and atomic insert.** **Acceptance:** No extra bridge track inserted before consent or only partially. **Required verification:** Server race, approve/decline and multi-tab tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-05 — Clarify force and cancel operations.** **Acceptance:** Rough transition consequences and cancel focus are obvious. **Required verification:** Play anyway, cancel error and recoverability audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-06 — Prevent stale/duplicate request feedback.** **Acceptance:** Late/failed search cannot visually add wrong track twice. **Required verification:** Idempotency and offline replay tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0175-07 — Measure listener trust in bridge plan.** **Acceptance:** Users understand why extra songs appear and when desired song will play. **Required verification:** Uncoached real-audio request study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0176 — Musical discovery: phrase bridges and focused harmonic connection explorer](adr-0176-lyric-harmonic-connection-explorer.md)

**Priority / phase:** P1 / Explore. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0176-01 — Design legible phrase bridge.** **Acceptance:** Shared word and both songs obvious with long/multilingual lyric lines. **Required verification:** Text and source provenance screenshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-02 — Prototype bounded song-neighbour graph.** **Acceptance:** Only real links appear and dense sets remain traversable. **Required verification:** Graph capacity and keyboard navigation test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-03 — Visualize real four-stage harmony audition.** **Acceptance:** Current stage and bar match confirmed clip position. **Required verification:** Media playback and chord clock fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-04 — Separate candidate from approved claim.** **Acceptance:** Machine suggestion cannot appear human-validated before rating. **Required verification:** Rating and no-audio state audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-05 — Keep audition and add-to-mix scope.** **Acceptance:** No unsolicited playback or wrong draft addition. **Required verification:** Audio ownership and revision tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-06 — Design empty and rejected states.** **Acceptance:** Absent candidates and failed previews remain truthful and recoverable. **Required verification:** No analysis/failed clip/offline scenarios. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0176-07 — Evaluate surprise versus comprehension.** **Acceptance:** Users understand relationship and distinguish hypothesis from confirmation. **Required verification:** Uncoached discovery and blind listening notes. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0177 — Library: expressive collection browsing and trustworthy track identity](adr-0177-musical-library-and-real-track-identity.md)

**Priority / phase:** P1 / Explore. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0177-01 — Prototype alternative song browse layout.** **Acceptance:** Song/artist legible and unknown artwork doesn't imply a real cover. **Required verification:** 1000-song and missing-art fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-02 — Preserve list feature parity and deep links.** **Acceptance:** Query/filter/sort/density/search continue identically. **Required verification:** URL and pagination/regression tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-03 — Surface readiness reasons at every density.** **Acceptance:** Blocked song's reason accessible in compact and card layouts. **Required verification:** Readiness and screen-reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-04 — Connect Start a mix to song identity.** **Acceptance:** Chosen source track identifiable in resulting set. **Required verification:** Build response and route tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-05 — Expose validated related discoveries.** **Acceptance:** Only existing song connections with candidate labels displayed. **Required verification:** No links/partial analysis fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-06 — Clarify measured versus corrected BPM/key.** **Acceptance:** Active override and restoration consequence transparent. **Required verification:** Correction/reanalysis/rerender tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0177-07 — Validate performance and browser access.** **Acceptance:** Large collection remains responsive with keyboard-first list available. **Required verification:** Scroll/frame/zoom and assistive technology review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0178 — Onboarding: honest library awakening and first audible DJ reward](adr-0178-first-run-library-awakening.md)

**Priority / phase:** P1 / Onboarding. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0178-01 — Design inviting but clear folder start.** **Acceptance:** Creative purpose understandable while path entry/privacy remain visible. **Required verification:** Cold-start usability and accessible form test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-02 — Preserve local path validation.** **Acceptance:** All existing missing/inside-added/no-audio/no-access errors recover. **Required verification:** Filesystem preflight fixture tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-03 — Visualize honest readiness milestone.** **Acceptance:** Six ready songs distinguished from total analysis count. **Required verification:** Mixed ready/analysed/lyric fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-04 — Show genuine new-musical-possibility events.** **Acceptance:** Reveals appear only with verified backend song/link data. **Required verification:** Event and no-result provenance tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-05 — Create first-seam earned-reward moment.** **Acceptance:** Only audible finished seam triggers nonblocking reveal. **Required verification:** Real first-play, Pause and dismissed-state tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-06 — Keep background analysis independent.** **Acceptance:** User can hear a first set while analysis continues safely. **Required verification:** Large-library slow-job tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0178-07 — Measure time to first understood value.** **Acceptance:** Users recognize difference from ordinary playlist without explanation. **Required verification:** Observed first-use task metrics and interviews. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0179 — My Mixes: current-performance identity, drafts and real render line](adr-0179-my-mixes-drafts-and-render-line-presence.md)

**Priority / phase:** P1 / Create. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0179-01 — Distinguish current mix and saved draft.** **Acceptance:** Current/draft scope always legible and labelled in all densities. **Required verification:** Side-by-side dark/light and screen reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-02 — Design truthful energy thumbnail.** **Acceptance:** Real relative values and unknown fallback only. **Required verification:** Missing and nonnumeric energy fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-03 — Clarify draft action outcomes.** **Acceptance:** Play/Edit/Delete/Prioritize cannot be mistaken for each other. **Required verification:** Current-playing and paused confirmation tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-04 — Visualize segmented transition readiness.** **Acceptance:** Ready/queued/failure shown per seam, no invented total percent. **Required verification:** Render status and ETA fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-05 — Show actual render-line priority.** **Acceptance:** Displayed reorder corresponds to server order under collisions. **Required verification:** Queue reorder/concurrency tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-06 — Preserve missing and empty draft recovery.** **Acceptance:** Cannot silently edit deleted draft or lose current mix. **Required verification:** Stale route and Undo tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0179-07 — Measure multi-draft retrieval.** **Acceptance:** Users can find intended project and know readiness quickly. **Required verification:** Timed multi-draft task and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0180 — Workspace: library health, truthful processing and operational calm](adr-0180-workspace-library-health-and-progress.md)

**Priority / phase:** P1 / Operate. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0180-01 — Reframe overview around library health.** **Acceptance:** User sees usable/blocked state and one most relevant next action. **Required verification:** Glance review and actual counts audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-02 — Distinguish pipeline status ownership.** **Acceptance:** Scan, lyrics, analysis, seams and export cannot be confused. **Required verification:** Mixed job and readiness fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-03 — Explain resource priority and ETA.** **Acceptance:** Deferred analysis during mix render is not shown as stuck. **Required verification:** Priority queue and estimate scenarios. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-04 — Design storage safety hierarchy.** **Acceptance:** Cache and original music distinct in labels and graphics. **Required verification:** Storage limit, cleanup and source-file tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-05 — Improve source and diagnostic recovery.** **Acceptance:** Every major failure has context-specific safe action. **Required verification:** Missing drive, no permission and offline tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-06 — Enforce calm motion and focused alerts.** **Acceptance:** No background task interrupts current playback or active control. **Required verification:** Many-job/reduced-motion listening review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0180-07 — Validate stale and uncertain status.** **Acceptance:** Out-of-date values marked and refreshed without false success. **Required verification:** Server disconnect and retry tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0181 — Export: frozen mix revision, real preparation and finished artifact](adr-0181-export-frozen-revision-and-artifact.md)

**Priority / phase:** P1 / Operate. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0181-01 — Design frozen revision visual object.** **Acceptance:** Export identity remains distinct from current mutable mix. **Required verification:** Concurrent edit and export fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-02 — Show prerequisite transition states.** **Acceptance:** Progress derived from real seam readiness and job stages only. **Required verification:** Queued/ready/failed render tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-03 — Specify full export failure taxonomy.** **Acceptance:** Canceled, expired and unavailable file distinguished. **Required verification:** Server error and missing file fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-04 — Confirm actual completed FLAC presentation.** **Acceptance:** Filename/duration/download appear only after true completion. **Required verification:** Decoding and revision/track-order comparison. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-05 — Preserve job discovery and reload.** **Acceptance:** Closing UI never erases or restarts existing job. **Required verification:** Activity/Workspace and navigation tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-06 — Design accessible completion feedback.** **Acceptance:** No flashing or fake quality claims; immediate keyboard download. **Required verification:** Reduced-motion/AT review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0181-07 — Verify original media and exact output.** **Acceptance:** No original file mutation and artifact matches frozen revision. **Required verification:** Real audio gap/overlap and disk-integrity audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0182 — Unified microinteraction vocabulary, semantic feedback and musical copy](adr-0182-causal-motion-and-microcopy.md)

**Priority / phase:** P0 / Foundation. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0182-01 — Inventory triggers and cancellation contract.** **Acceptance:** Every animation has data owner, states and interruption rules. **Required verification:** Per-component microstate matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-02 — Specify shared easing and motion tokens.** **Acceptance:** No ad-hoc global animation and every use has semantic reason. **Required verification:** CSS token/style audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-03 — Differentiate pending versus committed state.** **Acceptance:** Busy and proposed never visually equal completed. **Required verification:** Slow network and failure fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-04 — Define consistent revert and Undo response.** **Acceptance:** Reversal changes correct object and status, not just toast. **Required verification:** Undo conflict and Activity tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-05 — Refine musical microcopy glossary.** **Acceptance:** Users understand plan/render/play versus human quality feedback. **Required verification:** Writing and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-06 — Apply sensory fallback contract.** **Acceptance:** Same information/action without motion or color. **Required verification:** Reduced-motion and forced-colors regression. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0182-07 — Measure cost and comfort of motion.** **Acceptance:** No measurable playback impairment or cognitive distraction. **Required verification:** Named-hardware trace and participant evaluation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0183 — Responsive sensory design, keyboard parity and audio performance](adr-0183-responsive-accessibility-and-performance.md)

**Priority / phase:** P0 / Quality. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0183-01 — Define intensity choice and persistence.** **Acceptance:** User choice survives reload with no influence on music engine. **Required verification:** Pref and Stage tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-02 — Provide no-motion/no-color alternatives.** **Acceptance:** All key objects and actions understandable in forced colors. **Required verification:** NVDA/Edge and high contrast review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-03 — Adapt tactile features to narrow touch.** **Acceptance:** Timeline drag, grid paint and energy curve never trap page scroll. **Required verification:** 320/375/430px coarse pointer tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-04 — Validate high zoom and international text.** **Acceptance:** 400% zoom/RTL/emoji names retain controls and identity. **Required verification:** Responsive layout screenshots and keyboard. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-05 — Set audio graphics resource budget.** **Acceptance:** No new dropout during simultaneous audio analysis/render. **Required verification:** Actual hardware p95 frame and audio trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-06 — Validate keyboard inset and layered overlays.** **Acceptance:** Focus, bottom navigation and player never hide active field. **Required verification:** Phone keyboard and fullscreen tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0183-07 — Record independent accessibility acceptance.** **Acceptance:** Named screen reader/touch/low-vision tester signs exact SHA. **Required verification:** Human evidence protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## [ADR-0184 — Incremental implementation, evidence, neutrality and release gates](adr-0184-research-status-and-release-governance.md)

**Priority / phase:** P0 / Quality. **Decision:** Proposed; **Implementation:** 0/7; **Verified:** 0/7.

- [ ] **CI-0184-01 — Establish source baseline and prior-work crosswalk.** **Acceptance:** CI tasks distinguish novel delta from already implemented MI behavior. **Required verification:** Exact main SHA and parity diff. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-02 — Create reversible delivery slices.** **Acceptance:** Each PR changes one bounded surface with rollback plan. **Required verification:** Feature-flag and migration review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-03 — Map test and visual matrices to task IDs.** **Acceptance:** Every new CI task has state, viewport and negative-case coverage. **Required verification:** Coverage matrix review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-04 — Run real uncoached creative tasks.** **Acceptance:** Listener/creator/expert success and hesitation counts documented. **Required verification:** Human task protocol and raw denominators. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-05 — Protect A/B study neutrality.** **Acceptance:** Blind versions have identical appearance and audio ownership. **Required verification:** Study bias review and real media test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-06 — Rehearse correctness rollback.** **Acceptance:** Draft, revision, bridge, privacy and FLAC survive old/new/old. **Required verification:** Isolated data and real audio regression. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
- [ ] **CI-0184-07 — Record owner GO/NO-GO with independent review.** **Acceptance:** Every P0 passed; P1 dispositioned and signed for exact SHA. **Required verification:** Named reviewer evidence and release decision. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Totals, implementation and independent verification policy

**0/140 implementation checkboxes checked; 140 Not started, 0 In progress, 0 Implemented, 0 independently Verified; all 20 new ADR decisions Proposed.** These counts apply only to the CI programme, not current Selecta capabilities.

On a new task implementation, attach owner, actual code PR, exact SHA and source/tests; advance implementation only when merged. After independent human/real-audio/AT/device/performance review, set Verified Yes with named evidence. Update its ADR, this checklist, the evidence ledger, roadmap and release gates together. Older MI tasks and source-level checkmarks must be reconciled, never automatically inherited.
