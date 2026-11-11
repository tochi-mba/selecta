# Selecta - immersive UI/UX, microinteraction and animation roadmap

**Planning baseline:** main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (2026-11-07, merged PR #30). **Current PR #31:** 30 Accepted ADRs; **213 source-level Implemented, 3 In progress, 24 Not started**, 0 independently Verified. This programme extends but does not silently supersede ADR-0114–0134 or older programmes.

## Product experience contract

Selecta is a locally running autonomous DJ with optional precision creation. The listening experience should communicate music, anticipation and agency rather than background-job noise. Every movement must have a real cause; motion never invents musical information, reports a seam ready before rendering, claims objectively great sound, or steals interaction. Playback, data safety, human consent, scope/revision correctness, privacy and accessibility take precedence over delight.

## ADR index and implementation states

| ADR | Decision scope | Phase | Priority | Decision | Implementation | Verified |
|---|---|---|---|---|---|---|
| [ADR-0135](adr-0135-experience-choreography-and-attention-budget.md) | Experience choreography, musical attention and the calm-to-creative ladder | Experience foundation | P0 | Accepted | 6/8 Implemented; 0/8 In progress; 2/8 Not started | No (0/8) |
| [ADR-0136](adr-0136-visual-language-and-music-materials.md) | Visual materials, typography, hierarchy and authentic musical identity | Visual foundation | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0137](adr-0137-motion-tokens-timing-and-reduced-motion.md) | Motion grammar: timings, easing, causality and reduced-motion equivalence | Motion foundation | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0138](adr-0138-tactile-controls-and-feedback-microstates.md) | Tactile microinteractions for buttons, menus, fields, chips and feedback | Shared interactions | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0139](adr-0139-navigation-scene-transitions-and-orientation.md) | Navigation choreography, breadcrumbs, page continuity and scene orientation | Shell | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0140](adr-0140-persistent-player-audio-focus-and-microtransport.md) | Persistent mini-player, audio-focus handoff and frictionless microtransport | Playback shell | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0141](adr-0141-onboarding-progress-and-first-musical-reward.md) | First run, library readiness and the first audible reward | Onboarding | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0142](adr-0142-mix-ideas-cards-and-discovery-delight.md) | Mix-idea cards, meaningful recommendation reveals and selection confidence | Make a Mix | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0143](adr-0143-mix-shaping-energy-arc-and-destination-gestures.md) | Mix-shaping controls, expressive energy arc and destination selection | Make a Mix | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0144](adr-0144-listen-hero-ambient-visuals-and-song-identity.md) | Listen as an immersive musical scene: song identity, ambient visuals and restraint | Listen | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0145](adr-0145-transport-scrubbing-and-timing-feedback.md) | Transport precision: play, pause, seeking, jump and honest progress | Listen | P0 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0146](adr-0146-lyrics-stage-and-musical-visualizer-choreography.md) | Lyric focus, Stage immersion and real audio-reactive visuals | Listen | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0147](adr-0147-up-next-seam-countdown-and-musical-handoff.md) | Up Next anticipation, transition readiness and audible handoff choreography | Listen | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0148](adr-0148-requests-bridges-and-consent-microinteractions.md) | Song requests, live queue uncertainty and bridge-route consent | Requests | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0149](adr-0149-draft-cards-render-line-and-safe-activation.md) | My Mixes: draft identities, render-line motion and safe activation | My Mixes | P1 | Accepted | 8/8 Implemented; 0/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0150](adr-0150-arrangement-timeline-tactility-and-safe-reorder.md) | Arrangement timeline: tactile song movement, insertions, locks and focus | Editor | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0151](adr-0151-transition-inspector-audition-and-truthful-state.md) | Transition Inspector: audition-first detail, state truth and precision | Editor | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0152](adr-0152-stem-studio-granular-control-and-audition.md) | Stem Studio: physical grid feel, audible preview, precision and recovery | Studio | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0153](adr-0153-library-search-filter-and-collection-interactions.md) | Library browsing: instant search, contextual actions and large-collection calm | Library | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0154](adr-0154-song-details-corrections-and-trustful-forms.md) | Song details: metadata confidence, corrections, validation and safe recovery | Library | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0155](adr-0155-musical-discovery-audition-and-reveal.md) | Musical discovery: wordplay, harmonic auditions and earned delight | Discovery | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0156](adr-0156-workspace-operational-calm-and-honest-progress.md) | Workspace calm: background progress, storage capacity and action-first status | Workspace | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0157](adr-0157-flac-export-lifecycle-and-artifact-delight.md) | FLAC export: frozen revision, trustworthy progress and finished-artifact moment | Export | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0158](adr-0158-blind-a-b-study-neutral-comparison-design.md) | Blind listening studies: neutral feedback, fair comparison and no visual bias | Listening research | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0159](adr-0159-overlays-toasts-activity-and-recovery-choreography.md) | Dialogs, drawers, toasts, Activity and recoverable mistakes | Shared feedback | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0160](adr-0160-responsive-touch-gestures-and-small-screen-music.md) | Responsive gestures: thumb reach, safe-area geometry, keyboard occlusion and zoom | Responsive | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0161](adr-0161-accessible-sensory-choice-and-cognitive-comfort.md) | Accessible sensory choice, cognitive comfort and non-motion equivalents | Accessibility | P0 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0162](adr-0162-motion-performance-and-audio-continuity-budgets.md) | Animation performance budgets, audio continuity and long-session stability | Performance | P0 | Accepted | 5/8 Implemented; 3/8 In progress; 0/8 Not started | No (0/8) |
| [ADR-0163](adr-0163-musical-microcopy-trust-and-emotional-tone.md) | Musical microcopy, consent, explanations and the personality of a good DJ | Product language | P1 | Accepted | 7/8 Implemented; 0/8 In progress; 1/8 Not started | No (0/8) |
| [ADR-0164](adr-0164-research-gates-visual-proof-and-release-governance.md) | Visual and audible proof, interaction research, rollback and release governance | Verification | P0 | Accepted | 6/8 Implemented; 0/8 In progress; 2/8 Not started | No (0/8) |
| **Total** | **30 independent new decisions** | | | **30 Accepted** | **213 Implemented; 3 In progress; 24 Not started** | **0/240 Verified** |

## Delivery sequence (dependencies, not a promised schedule)

1. **Foundations: ADR-0135–0138.** Define attention budget, visual materials, semantic motion and tactile microstates before creating isolated animations.
2. **Shell and first reward: ADR-0139–0143.** Protect navigation, persistent playback, first library readiness, recommendation clarity and user-controlled shaping.
3. **Immersive listening: ADR-0144–0147.** Song identity, transport, true lyrics/visualizer, Stage and the exact seam handoff.
4. **Requests and creation: ADR-0148–0152.** Fair pending requests, consented bridges, draft identity, reordering, audition-first seam inspection and stem editing.
5. **Library through recovery: ADR-0153–0159.** Scalable browsing, safe metadata correction, musical discovery, background work, FLAC, blind study and Activity/Undo.
6. **Evidence and constraints: ADR-0160–0164.** Responsive touch, motion-sensitive accessibility, performance, trustworthy product language and independent release proof.

## Decision / implementation / verification separation

- Decision: Accepted by the repository owner on 2026-11-07. Any future rejection or supersession requires a recorded rationale.
- Implementation: Not started → In progress → source-level Implemented on a linked PR head when behavior and appropriate automation are present. Merging and independent release verification are separate steps; checkboxes track code completion, not approved release.
- Independent verification: No → Yes with named real-world evidence-visual, uncoached usability, actual audio, keyboard/NVDA/touch, reduced motion, performance or privacy as applicable. Green CI, muted synthetic clips, proposed screenshots and docs-only merge cannot establish human enjoyment or verified accessibility.
- All new tasks have a unique `MI-0135-01`…`MI-0164-08` key, acceptance statement, verification demand, status and owner field in the [checklist](selecta-microinteraction-implementation-checklist.md) and [ledger](selecta-microinteraction-evidence.md).

## Non-negotiable parity and scope

No source music mutation; preserve local-only server and accurate LRCLIB metadata disclosure. No new click sounds or fabricated visualizer data. One audio owner; manual Pause not overridden. Current mix, drafts, seam keys and revisions must remain correct under stale/raced operations and Undo. Every bridge insertion consented and atomic. All Studio controls and list alternative preserved. All routes, Library query state, media keys, exports, blind-study masking and diagnostics survive. No native desktop packaging/bridges, accounts, SaaS, remote media upload or telemetry.

[Checklist](selecta-microinteraction-implementation-checklist.md) · [Machine-readable code status](selecta-microinteraction-code-status.json) · [Evidence](selecta-microinteraction-evidence.md) · [Motion matrix](selecta-microinteraction-motion-matrix.md) · [Parity](selecta-microinteraction-feature-parity.md) · [Verification](selecta-microinteraction-verification-matrix.md) · [Status reconciliation](selecta-microinteraction-status-reconciliation.md) · [NO-GO gates](selecta-microinteraction-release-gates.md).

**Method references, not Selecta results:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/), [web.dev INP](https://web.dev/articles/inp), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots/).
