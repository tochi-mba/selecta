# Selecta — immersive microinteraction verification and negative-case matrix

**All status: Not started / Not independently Verified.** Each future result needs exact implementation SHA, device/OS/browser, fixture type, reviewer and limitations; synthetic E2E or visual snapshots alone are not actual-audio or human-quality evidence.

| Case | Setup and action | Required observable outcome | Evidence mode | Status |
|---|---|---|---|---|
| Input causality | Hover/press/focus/keyboard action | No moving target; immediate truthful state; keyboard parity | E2E + manual | Pending |
| Async uncertainty | Delay/fail create, request, export, transition | Correct pending/blocked/failed label; scoped retry without duplicate | API race E2E | Pending |
| Rapid user changes | Change seam twice; change filter during response | Stale result cannot supersede newest intent | Controlled race test | Pending |
| Real playback | Preview and manually Pause during main audio | One audio owner, no surprise resume, no audible overlap | Captured real audio | Pending |
| Route continuity | Listen→Edit→Stage→Back with deep links | Audio and current/draft identity survive, focus restored | E2E + manual | Pending |
| Honest musical movement | Observe transition countdown and seam fallback | Visual handoff agrees with actual rendered sound | Real audio + screen recording | Pending |
| Stage/lyrics | Missing timed lyrics and denied fullscreen | Honest unsynced lyrics, focus, exit and fallback | Browser + AT | Pending |
| Reduced motion live | Toggle OS setting during visualizer and overlay | Animation ceases; essential context remains in text | Browser + manual | Pending |
| Themes | Dark/light/system and forced colors | Contrast, focus, state without color only | Computed CSS + review | Pending |
| Mobile and zoom | 320/375/430, landscape, on-screen keyboard, 200/400% zoom | No obscured active targets; usable controls and scroll | Device + manual | Pending |
| RTL/long metadata | Long duplicate song titles, missing fields | Readable names, no collision, stable identity | Screenshot + AT | Pending |
| Large browse | 20k songs; search and scroll under scan load | No stale results or severe input delay | Hardware trace + E2E | Pending |
| Editor and Studio | 100 songs; 64 cells, reorder, AI assist, restart | No data loss, revision confusion or pointer-only operation | E2E + AT | Pending |
| Request bridge | Consent and cancel while rendering | No unapproved or partial route | API atomicity test | Pending |
| FLAC snapshot | Export during edit; download | Correct frozen revision, complete decodable audio | Decode and audition | Pending |
| Blind study | Play only A; attempt submit; compare B | No biased difference, cannot judge allowed, one answer | DOM review + study pilot | Pending |
| Operation recovery | Source disconnected; disk full; server restart | Accurate consequence, original files safe, scoped next action | Integration + privacy | Pending |
| Motion budget | Low resources, hidden tab, background audio render | Decorative frames stop; audio gap-free | CPU/long-task and audio trace | Pending |

## ADR-specific acceptance proof

| ADR | First critical test | Final human/performance test | Status | Evidence owner |
|---|---|---|---|---|
| [0135](adr-0135-experience-choreography-and-attention-budget.md) | Storyboard review with listener/creator and source inventory | Decision record with exact SHA and accessibility/audio reviewer | Not started / No | Unassigned |
| [0136](adr-0136-visual-language-and-music-materials.md) | Token diff and dark/light/system contrast review | Before/after parity and owner review | Not started / No | Unassigned |
| [0137](adr-0137-motion-tokens-timing-and-reduced-motion.md) | Computed styles, visual spec and ADR review | Performance traces with hardware and long task log | Not started / No | Unassigned |
| [0138](adr-0138-tactile-controls-and-feedback-microstates.md) | Control gallery and semantic audit | Timed interaction tests and 1–5 task confidence | Not started / No | Unassigned |
| [0139](adr-0139-navigation-scene-transitions-and-orientation.md) | Route manifest and direct-link fixtures | E2E route regression matrix | Not started / No | Unassigned |
| [0140](adr-0140-persistent-player-audio-focus-and-microtransport.md) | Viewport and touch screenshots | Long-session trace and captured audio | Not started / No | Unassigned |
| [0141](adr-0141-onboarding-progress-and-first-musical-reward.md) | Windows/macOS/Linux source review and first-use testing | Observed first-run trial with real music and hardware | Not started / No | Unassigned |
| [0142](adr-0142-mix-ideas-cards-and-discovery-delight.md) | Uncoached choice confidence and screenshot study | Counterbalanced task study with raw counts | Not started / No | Unassigned |
| [0143](adr-0143-mix-shaping-energy-arc-and-destination-gestures.md) | Comprehension trial and settings state test | Observed task and actual resulting mix listening | Not started / No | Unassigned |
| [0144](adr-0144-listen-hero-ambient-visuals-and-song-identity.md) | Real-metadata visual study | Observed listening session and perceived calm rating | Not started / No | Unassigned |
| [0145](adr-0145-transport-scrubbing-and-timing-feedback.md) | Web Audio fixtures and screen-reader names | Cross-tab/browser and real audio test | Not started / No | Unassigned |
| [0146](adr-0146-lyrics-stage-and-musical-visualizer-choreography.md) | Missing/late/RTL lyrics fixtures | Real listening session with recorded feedback | Not started / No | Unassigned |
| [0147](adr-0147-up-next-seam-countdown-and-musical-handoff.md) | Seam-state fixture matrix | Task survey with time-stamped observations | Not started / No | Unassigned |
| [0148](adr-0148-requests-bridges-and-consent-microinteractions.md) | Request status unit and UI fixture review | Observed party-like local session and interview | Not started / No | Unassigned |
| [0149](adr-0149-draft-cards-render-line-and-safe-activation.md) | Current/draft comprehension tests | RTL/zoom/forced-color screenshots | Not started / No | Unassigned |
| [0150](adr-0150-arrangement-timeline-tactility-and-safe-reorder.md) | 100-song fixture and selection tests | Task success/error and measured effort | Not started / No | Unassigned |
| [0151](adr-0151-transition-inspector-audition-and-truthful-state.md) | Transition-edit comprehension test | Human A/B audition with exact SHA | Not started / No | Unassigned |
| [0152](adr-0152-stem-studio-granular-control-and-audition.md) | 64-cell accessibility and visual fixture | Before/after listening and task study | Not started / No | Unassigned |
| [0153](adr-0153-library-search-filter-and-collection-interactions.md) | Delayed query and offline simulations | Search-and-act study with raw counts | Not started / No | Unassigned |
| [0154](adr-0154-song-details-corrections-and-trustful-forms.md) | Example songs and comprehension review | Observed correction task and questions | Not started / No | Unassigned |
| [0155](adr-0155-musical-discovery-audition-and-reveal.md) | Pair comprehension and false-positive fixtures | Counterbalanced real audio quality notes | Not started / No | Unassigned |
| [0156](adr-0156-workspace-operational-calm-and-honest-progress.md) | User triage comprehension test | Injected error study with success denominator | Not started / No | Unassigned |
| [0157](adr-0157-flac-export-lifecycle-and-artifact-delight.md) | Export snapshot/API test | Uncoached export and re-export task | Not started / No | Unassigned |
| [0158](adr-0158-blind-a-b-study-neutral-comparison-design.md) | Rendered HTML and screenshot comparison | Counterbalanced research report | Not started / No | Unassigned |
| [0159](adr-0159-overlays-toasts-activity-and-recovery-choreography.md) | Keyboard, NVDA and portal tests | Injected fault study and raw counts | Not started / No | Unassigned |
| [0160](adr-0160-responsive-touch-gestures-and-small-screen-music.md) | Automated and physical screenshots | Uncoached mobile study | Not started / No | Unassigned |
| [0161](adr-0161-accessible-sensory-choice-and-cognitive-comfort.md) | A11y component inventory | Independent evidence ledger | Not started / No | Unassigned |
| [0162](adr-0162-motion-performance-and-audio-continuity-budgets.md) | Benchmark protocol review | Independent quality ledger | Not started / No | Unassigned |
| [0163](adr-0163-musical-microcopy-trust-and-emotional-tone.md) | Content inventory review | Uncoached comprehension and preference review | Not started / No | Unassigned |
| [0164](adr-0164-research-gates-visual-proof-and-release-governance.md) | Ledger schema validation | Signed release gate with SHA | Not started / No | Unassigned |

## Evidence discipline

Capture raw visual and audible evidence with both real and synthetic fixture labels. Include widths 320–2560, themes, reduced motion, 200/400% zoom, keyboard/touch/NVDA, long/RTL metadata, offline/retry/async races. A generated visual regression candidate is not an approved golden screenshot. A recorded clip is not proof that a song transition is musically good unless evaluated by listeners. [Ledger](selecta-microinteraction-evidence.md) · [Release gates](selecta-microinteraction-release-gates.md).
