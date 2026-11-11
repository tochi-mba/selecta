# Selecta - microinteraction states, timing, causality and reduced-motion matrix

**Decision:** all 30 ADRs are Accepted. **Source-level implementation:** 213 Implemented, 3 In progress, 24 Not started on PR #31. **Independent verification:** 0. Suggested timing and performance budgets are not proven on representative hardware; code-level motion tokens and reduced-motion paths exist but require device and AT review.

## Shared motion language

| Intent | Proposed timing | Treatment | Non-negotiable truth | Reduced-motion fallback |
|---|---|---|---|---|
| Press/selected | 0–140 ms | color, outline, icon | semantic state and hit target immediate | instant icon/text |
| Hover and focus | 100–140 ms | border/background | focus distinct; never hover-only essentials | still focus ring |
| Tooltip or local disclosure | 0–160 ms | opacity | no delayed keyboard visibility | immediate reveal |
| Page transition | 120–180 ms | opacity, ≤8px translation | route/focus/player state authoritative | instant content |
| Overlay or sheet | 160–240 ms | opacity, transform | focus trapped and returned, background inert | instant overlay |
| Song identity | 160–240 ms | opacity | only on real current-song switch | instant title |
| Timeline drop | 120–180 ms | transform | confirmed position, no stale mutation | instant ordered rows |
| Energy preset | 180–240 ms | SVG interpolate | actual five preference values | instant correct curve |
| Audio visualizer | real clock, adaptive FPS | genuine analyser data | no guessed beat/waveform, stop when hidden | static true status |
| Progress or readiness | actual event-driven | numeric/status update | no fake %, no early success | instant value |
| Error or blocker | immediate persistent | text/icon/border | no shake, flash, or missing recovery | static warning |

**Global restrictions:** no sound effects, strobing, fictitious progress, fake DJ 'thinking', animated quality scores, repeated attention-seeking pulses, surprise auto-resume, moving press targets, fake artwork, audio waveform without true data, or preview overlap. Use semantically correct green ready, blue request, orange warning and lime focus/action in dark/light/system and high contrast.

## Detailed per-ADR choreography

### [ADR-0135 - Experience choreography, musical attention and the calm-to-creative ladder](adr-0135-experience-choreography-and-attention-budget.md)

- Idle baseline: no pulsing accents or perpetual celebratory loops; animation frequency depends on actual playback or a user action.
- Mode entry: 120–240 ms opacity/position continuity only; never obscure transport or move focus until navigation completes.
- When a seam becomes ready, one short local state change, not a page-level celebration; unready remains visibly unready.
- Under reduced motion, retain the exact information sequence using instant state changes and labels.

**Decision:** Accepted · **Implementation:** 6/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0136 - Visual materials, typography, hierarchy and authentic musical identity](adr-0136-visual-language-and-music-materials.md)

- Surfaces do not continuously shimmer; use a maximum 120 ms contrast/color response for hover and active states.
- Do not animate layout-sensitive type measurements during a song change; crossfade old/new identity only after the song identity actually changes.
- Album-art placeholders are static, legible and non-deceptive; no fake waveform or invented musical cover.
- Light-mode lime remains a filled high-contrast action with dark text, never a thin unreadable lime line on cream.

**Decision:** Accepted · **Implementation:** 8/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0137 - Motion grammar: timings, easing, causality and reduced-motion equivalence](adr-0137-motion-tokens-timing-and-reduced-motion.md)

- Button acknowledgment 100–140 ms; chip selection 120–160 ms; tooltip 0–120 ms; menu/overlay 160–240 ms.
- Drag feedback follows pointer continuously but settles within 120–180 ms after valid release; invalid drop returns without misleading persistence.
- Song change: restrained opacity exchange 160–240 ms; display lyrics only when matching actual current song.
- Reduced motion: instant opacity/state swap, no spatial travel, no persistent pulse, no auto-scroll that disorients focus.

**Decision:** Accepted · **Implementation:** 8/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0138 - Tactile microinteractions for buttons, menus, fields, chips and feedback](adr-0138-tactile-controls-and-feedback-microstates.md)

- Pointer-down uses modest 100–120 ms surface color/outline response; no scale jump that makes hit boxes move.
- Busy starts immediately in place with stable text footprint; determinate indicators move only from actual progress; no eternal spinners for blocked states.
- Success is a brief 160 ms local confirmation, then returns to persistent final status without celebratory loops.
- Failure is a stable high-contrast icon/text change, not a shake animation, alarm flash or auto-dismissing diagnosis.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0139 - Navigation choreography, breadcrumbs, page continuity and scene orientation](adr-0139-navigation-scene-transitions-and-orientation.md)

- Route content: 120–180 ms opacity reveal, optionally ≤8 px translation in normal motion, instant in reduced motion.
- Active nav state: immediate semantic selection, with ≤120 ms background-color transition; no travelling shared underline across unrelated destinations.
- Drawer from desktop side or mobile bottom: 180–240 ms transform/opacity, with focus entered only after mount and restored on close.
- Back/Forward restores recorded scroll without added scroll animation; page transitions never control playback.

**Decision:** Accepted · **Implementation:** 8/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0140 - Persistent mini-player, audio-focus handoff and frictionless microtransport](adr-0140-persistent-player-audio-focus-and-microtransport.md)

- Mini-player entrance when playback first exists: short 160–220 ms fade while page bottom padding is established before paint.
- Song title updates crossfade at most 180 ms with full accessible identity announced once, not on every clock tick.
- Pause/Play icon switches within 100 ms, with no spin or delay; scrub progress remains clock-derived.
- Preview handoff changes ownership label immediately; on completion resume only when intent generation still permits.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0141 - First run, library readiness and the first audible reward](adr-0141-onboarding-progress-and-first-musical-reward.md)

- Folder submission responds within one frame with locked duplicate-submit and stable copy.
- Count increases use gentle numeric update ≤160 ms only on real new data; no rolling counter that suggests fabricated progress.
- At six mix-ready songs, an accessible ready cue appears once, with no auto-play or focus steal.
- In reduced motion, progress labels and milestones update instantly with the same meaning.

**Decision:** Accepted · **Implementation:** 6/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0142 - Mix-idea cards, meaningful recommendation reveals and selection confidence](adr-0142-mix-ideas-cards-and-discovery-delight.md)

- Hero enters once with ≤220 ms opacity/translate after genuine content load; offscreen cards need not animate.
- Card hover/focus uses 100–140 ms border/emphasis; no lift >2 px and no moving target during click.
- Category filtering/selection uses ≤180 ms local reveal while preserving scroll and focus.
- Selected mix preview control, when real, immediately marks ownership and switches to Stop without autoplay.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0143 - Mix-shaping controls, expressive energy arc and destination selection](adr-0143-mix-shaping-energy-arc-and-destination-gestures.md)

- Energy handles follow pointer using transform without easing lag during drag; snap feedback ≤140 ms on release.
- Preset selection morphs curve within 180–240 ms only if the path is truthful; reduced motion redraws instantly.
- Selected tempo/feel chips switch emphasis in ≤120 ms and keep keyboard focus stable.
- Destination selection confirms chosen song once; no celebratory motion that suggests a route is already possible.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0144 - Listen as an immersive musical scene: song identity, ambient visuals and restraint](adr-0144-listen-hero-ambient-visuals-and-song-identity.md)

- Song identity updates with one ≤200 ms crossfade after playback actually changes; no temporal mismatch with audio.
- Ambient treatment reacts at most 10–15 fps, low opacity, and is frozen/static in reduced motion; never flashes rapidly.
- Dynamic background must not lower text contrast in dark/light/system or forced colors.
- Opening DJ controls gently reveals options ≤180 ms without scrolling away from the transport.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0145 - Transport precision: play, pause, seeking, jump and honest progress](adr-0145-transport-scrubbing-and-timing-feedback.md)

- Play/Pause glyph changes in 80–120 ms, but semantic phase changes immediately; no celebratory bounce.
- Progress follows the actual clock; no CSS ease causing the indicator to run past real audio. Scrub ghost marker follows the input directly.
- Seeking may show a local ≤160 ms confirmation; if rejected, marker returns to actual time without falsely changing song identity.
- For bars remaining, number transitions are quiet and only derived from verified timing; no sweeping pulse synced to guessed beats.

**Decision:** Accepted · **Implementation:** 8/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0146 - Lyric focus, Stage immersion and real audio-reactive visuals](adr-0146-lyrics-stage-and-musical-visualizer-choreography.md)

- Lyric line emphasis crossfades 120–200 ms with no automatic horizontal marquee; active word uses a still highlight in reduced motion.
- Auto-follow moves only between lines at a bounded pace (prefer ≤240 ms) and pauses when the user manually scrolls.
- Stage entry/exit ≤240 ms crossfade; browser fullscreen result determines actual UI state, not an optimistic assumption.
- Visualizer frame rate adapts to visibility and preferences; no strobe, large flash or rapid full-screen color inversion.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0147 - Up Next anticipation, transition readiness and audible handoff choreography](adr-0147-up-next-seam-countdown-and-musical-handoff.md)

- Next-card attention changes at confirmed transition preparation (≤180 ms surface color) without stealing focus.
- During a real handoff, song identity can dissolve over 160–240 ms after the engine reports its transition; never run independently on an assumed timer.
- Countdown is clock-derived and numerically stable with tabular digits; no beat pulse when precision unavailable.
- Fallback switches status immediately with icon/text and remains readable until the user moves on.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0148 - Song requests, live queue uncertainty and bridge-route consent](adr-0148-requests-bridges-and-consent-microinteractions.md)

- New pending request enters with ≤180 ms opacity/space reveal after immediate optimistic insertion; rollback uses an explicit error, not vanishing silently.
- Route steps draw only when an actual candidate exists; no fabricated moving path or percentage of musical fit.
- Approval button acknowledges press immediately, then shows preparing without visual implication of joining; joining animates only after atomic commit.
- Queued route preview is static; reduced motion replaces route drawing with numbered song order and status text.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0149 - My Mixes: draft identities, render-line motion and safe activation](adr-0149-draft-cards-render-line-and-safe-activation.md)

- Draft-card hover/focus ≤120 ms; expansion doesn't cause nearby action targets to jump.
- Render-line drag/move communicates placeholder position and settles ≤180 ms after confirmed change; no movement until the server's result is reconciled.
- Delete uses short ≤160 ms collapse only after confirmed deletion, with Undo remaining visible in Activity.
- Readiness counters change on authoritative job updates, no indeterminate pulse for a blocked job.

**Decision:** Accepted · **Implementation:** 8/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0150 - Arrangement timeline: tactile song movement, insertions, locks and focus](adr-0150-arrangement-timeline-tactility-and-safe-reorder.md)

- Picked-up row gains a non-color cue, small shadow/outline, no scale that obscures targets.
- Drop indicator follows nearest valid insertion slot; after server confirmation, rows settle within 120–180 ms.
- Invalid/rejected move returns to original position with explicit reason and no fake success.
- Locked status icon changes within 120 ms; never pulses indefinitely or implies all neighboring seams are locked.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0151 - Transition Inspector: audition-first detail, state truth and precision](adr-0151-transition-inspector-audition-and-truthful-state.md)

- Tab changes 100–160 ms focus-preserving reveal; no panel slide that hides an active preview control.
- Pending technique chip immediately acknowledges intent but uses a queued/working marker, not ready/glow.
- New seam render replaces old preview only after matching key, with short ≤160 ms textual state transition.
- Preview progress follows actual audio; no waveform animation if no clip was successfully rendered.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0152 - Stem Studio: physical grid feel, audible preview, precision and recovery](adr-0152-stem-studio-granular-control-and-audition.md)

- Cell toggles ≤100 ms on press; rows never ripple automatically in imitation of a beat.
- While auditioning, a thin time cursor tracks real preview time; it stops immediately on Stop, pause or audio failure.
- Selecting an AI arrangement shows an exact pending operation, not a made-up growing waveform; changed grid appears only from returned data.
- When switching Shape/Grid/List, preserve logical cell focus or announce target mapping; no animated transformation that loses controls.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0153 - Library browsing: instant search, contextual actions and large-collection calm](adr-0153-library-search-filter-and-collection-interactions.md)

- Search skeleton shifts to result with ≤160 ms opacity only after real query response; never rapidly pulse every keystroke.
- Filter chip selection updates immediately; result list does not visually show previous query after latest query commitment.
- Rows can use ≤100 ms hover/focus treatment; never animate in 20,000 items individually.
- Scroll restoration is immediate to saved position, not a theatrical slide.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0154 - Song details: metadata confidence, corrections, validation and safe recovery](adr-0154-song-details-corrections-and-trustful-forms.md)

- Correction field highlights pending on submit ≤120 ms; confirmed success becomes stable saved label ≤160 ms.
- Double/Half updates numeric value immediately without animated rolling digits; semantics always reflect current actual field value.
- Reset confirmation uses visible non-color cue, no shake or celebration.
- Re-render effect stays marked waiting until job reports ready; no premature green status.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0155 - Musical discovery: wordplay, harmonic auditions and earned delight](adr-0155-musical-discovery-audition-and-reveal.md)

- Harmonic stage advances with a quiet ≤160 ms progress highlight, only after playback actually advances.
- Chord-bar cursor tracks audition timing; in reduced motion use immediate current-bar outline and spoken stage label.
- Word phrase can receive ≤180 ms entrance emphasis when an authentic candidate loads; no auto-playing spoken lyrics.
- Approved/rejected feedback changes local status immediately, but only confirms save when server acknowledges.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0156 - Workspace calm: background progress, storage capacity and action-first status](adr-0156-workspace-operational-calm-and-honest-progress.md)

- Progress bars update when authoritative job counts change; use restrained width transitions ≤180 ms only for genuinely monotonic signals.
- A blocker appears with persistent orange/text icon, no repeated shaking or flashing; when resolved, transition to ready ≤160 ms.
- Disclosure of job details uses ≤180 ms reveal and retains scroll/focus; low-priority work does not animate continuously.
- Storage meter changes only from real values and has a text equivalent, including over-budget protected assets.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0157 - FLAC export: frozen revision, trustworthy progress and finished-artifact moment](adr-0157-flac-export-lifecycle-and-artifact-delight.md)

- Export start acknowledges immediately, then enters persistent preparation state without fabricated percentage.
- Stage marker moves only when the authoritative job state advances; no backwards animated regress unless state truly reverts.
- Ready file gets a single ≤220 ms emphasis of the download action; no confetti or sound.
- Error/expired remains static with recovery action; reduced motion has identical stage labels.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0158 - Blind listening studies: neutral feedback, fair comparison and no visual bias](adr-0158-blind-a-b-study-neutral-comparison-design.md)

- A/B transport feedback identical 100–140 ms and no accent differences between columns.
- Progress and played-state indicators reflect actual audible playback, not press alone.
- Submission acknowledges once with neutral 160 ms status change; advance only after exact answer confirmation.
- Reduced motion uses the same neutral labels and equal spatial geometry.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0159 - Dialogs, drawers, toasts, Activity and recoverable mistakes](adr-0159-overlays-toasts-activity-and-recovery-choreography.md)

- Dialog/drawer enter ≤220 ms using opacity/transform; no large backdrop scale or bouncy spring.
- Toasts enter ≤160 ms and exit ≤160 ms only after message is no longer actionable elsewhere; focus keeps toast alive.
- Undo confirms with a stable state marker and does not visually reverse before backend confirms scope.
- In reduced motion overlays appear immediately, focus behavior unchanged.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0160 - Responsive gestures: thumb reach, safe-area geometry, keyboard occlusion and zoom](adr-0160-responsive-touch-gestures-and-small-screen-music.md)

- Mobile sheet rises ≤200 ms without shifting document scroll unexpectedly; reduced motion appears instantly.
- Only drag handles capture touch movement; other touch moves scroll naturally.
- Keyboard insets change chrome immediately after viewport adjustment, no prolonged animation while typing.
- Pinned transport/mini-player may fade on state change but not slide over an active focus target.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0161 - Accessible sensory choice, cognitive comfort and non-motion equivalents](adr-0161-accessible-sensory-choice-and-cognitive-comfort.md)

- Reduced motion has zero spatial travel and no persistent pulses, but still indicates causality through instantaneous icon/text states.
- Focus indicators stay visible under motion and forced-colors; selection can use shape, outline and text.
- Announcements are event-based and throttled so lyric ticks, song-time ticks and progress counters do not flood assistive technology.
- No ambient flash faster than accepted comfort threshold; prefer slow, bounded color/brightness changes tied to genuine audio.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0162 - Animation performance budgets, audio continuity and long-session stability](adr-0162-motion-performance-and-audio-continuity-budgets.md)

- Default non-audio animation budget targets 60 fps on named reference hardware; record actual p95 frame time and dropped frames rather than claim success.
- If long tasks or repeated dropped frames occur, reduce or suspend visual decoration without delaying transport/control state.
- Avoid layout animation in paginated/contained rows; no repeated full-page reflow from numeric progress updates.
- All animation stops when page hidden unless required by actual playback state; audio scheduling remains independent.

**Decision:** Accepted · **Implementation:** 2/8 Implemented, 5/8 In progress · **Verified:** 0/8.

### [ADR-0163 - Musical microcopy, consent, explanations and the personality of a good DJ](adr-0163-musical-microcopy-trust-and-emotional-tone.md)

- Microcopy reveals with the status it explains; no typing animation, fake 'DJ thinking' dots or anthropomorphic idle behavior.
- Milestone copy appears once after verified event and remains readable without a timed disappearance if actionable.
- Error text stays still and specific; avoid shake effects or red flashes.
- Long-form technical explanations open on user request, with no automatic expanding under active listening.

**Decision:** Accepted · **Implementation:** 7/8 Implemented, 0/8 In progress · **Verified:** 0/8.

### [ADR-0164 - Visual and audible proof, interaction research, rollback and release governance](adr-0164-research-gates-visual-proof-and-release-governance.md)

- Acceptance compares recorded videos at full speed and frame-by-frame for causality, focus, occlusion and movement.
- No screenshot, generated animation or HTML-only audit can claim a transition sounded good.
- No motion-related P0 failure accepted even if automation otherwise passes; reduced-motion parity is mandatory.
- Performance traces must state actual machine, branch SHA and limitations; avoid fictional frame-rate passes.

**Decision:** Accepted · **Implementation:** 6/8 Implemented, 0/8 In progress · **Verified:** 0/8.

## Complete interactive state contract

| State | Required visible semantics | Focus/AT semantics | Recovery or boundary |
|---|---|---|---|
| Idle | stable named action | native button/link | no action needed |
| Hover | subtle optional emphasis | content never only hover | pointer leave |
| Focus | visible noncolor outline | name, role and logical order | Tab/Shift+Tab |
| Pressed | persistent selected or press cue | appropriate native/aria-pressed | reversible when valid |
| Busy | exact pending operation and preserved dimensions | aria-busy, restrained announcement | cancel/retry only if supported |
| Queued | waiting for dependency | static label, reason | background update |
| Ready | confirmed result with truthful scope | announce once | next real action |
| Warning | completed with caveat | icon and descriptive text | inspect consequence |
| Blocked | impossible until dependency fixed | not a spinner | named remediation |
| Failed | specific failure without false safe claim | alert where urgent | exact scoped retry |
| Stale | revision/order changed elsewhere | no false success | guarded refresh |
| Recovering | actual retry still in flight | avoid premature ready | reveal result |
| Disabled | explicit reason | native or guarded aria-disabled | satisfy prerequisite |
| Empty | contextual first step | not confused with failed/loading | valid next action |

## Required review

Normal/reduced motion, dark/light/system, high contrast; 320, 375, 430, 768, 1280, 1440 and 2560 CSS px; short-height landscape and 200/400% zoom; long/RTL/missing metadata; keyboard, touch, NVDA/Edge, low resources, server loss and actual audio where relevant. Captured videos must be reviewed at regular speed and frame-by-frame for audio causality, focus, layout shift and flashing. Recording a clip is not approving it.
