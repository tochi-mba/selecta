# Selecta / Flow - comprehensive artistic UI/UX ADR roadmap

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-flow-implementation-checklist.md)):** 50 Accepted ADRs; 400 SF tasks: 263 Implemented, 17 In progress, 70 Not started, 46 Needs a person, 4 Superseded; **0 independently Verified**.

**Historical baseline - owner-accepted plan, 2026-11-08 (originally submitted as documentation only).** **50 Accepted ADRs (ADR-0198–0247), 400 new SF tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Source baseline: main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`. This is a fresh acceptance programme overlaying an already implemented application; these counters do not measure its current functionality. No SaaS now.

## Product direction

**Music is art.** Make Selecta feel like an expressive, premium local-first music instrument: Listen cinematic and calm, Explore editorial and imaginative, Create tactile and exact, Workspace operational and unobtrusive. Let real song, seam, stem, energy, requests and render facts drive every presentation. A decorative system called **The Thread** can connect these scenes but must always distinguish planned from confirmed and rendered from playing. Every aspect of older visual designs may change; no currently functioning musical safety or workflow is waived.

## All 50 ADRs and explicit statuses

| ADR / proposed design decision | Phase | Priority | Decision | New implementation | Independently Verified |
|---|---|---|---|---|---|
| [ADR-0198 - Artistic product charter and music-first experience](adr-0198-artistic-product-charter.md) | Foundation | P0 | Accepted | Implemented (4/8), 4 Not started | No (0/8) |
| [ADR-0199 - Head baseline and historical ADR implementation reconciliation](adr-0199-historical-status-reconciliation.md) | Foundation | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0200 - Distinctive editorial and cinematic art direction](adr-0200-art-direction.md) | Visual system | P0 | Accepted | Implemented (0/8), 8 Not started | No (0/8) |
| [ADR-0201 - Semantic palette, dark/light themes and contrast](adr-0201-semantic-colour-themes.md) | Visual system | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0202 - Editorial display type and precision numeric typography](adr-0202-typography.md) | Visual system | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0203 - Spacing, surfaces, density and flexible compositions](adr-0203-spatial-composition.md) | Visual system | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0204 - Polished controls, icons, inputs and feedback primitives](adr-0204-primitives.md) | Components | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0205 - Causal motion and Still/Subtle/Expressive intensity](adr-0205-sensory-motion.md) | Motion | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0206 - Honest cover art, song motifs and Mix Sleeves](adr-0206-music-artwork.md) | Visual identity | P1 | Accepted | Implemented (5/8), 2 Not started, 1 Superseded | No (0/8) |
| [ADR-0207 - The Thread: truthful music-object continuity grammar](adr-0207-the-thread.md) | Visual identity | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0208 - Intent navigation and contextual scene continuity](adr-0208-navigation.md) | Shell | P0 | Accepted | Implemented (6/8), 2 Not started | No (0/8) |
| [ADR-0209 - Transport hierarchy, persistent audio focus and media session](adr-0209-persistent-player.md) | Shell | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0210 - Listening Theatre: cinematic song-first listening](adr-0210-listening-theatre.md) | Listen | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0211 - Audio-clock Handoff Scene and truthful transition choreography](adr-0211-real-handoff.md) | Listen | P0 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0212 - Curation and visual refinement of fifteen existing spectrum styles](adr-0212-visualizer-curation.md) | Listen | P1 | Accepted | Implemented (4/8), 4 Not started | No (0/8) |
| [ADR-0213 - Editorial lyrics, verified wordplay and fullscreen Stage](adr-0213-lyric-stage.md) | Listen | P1 | Accepted | Implemented (5/8), 3 Not started | No (0/8) |
| [ADR-0214 - Truthful playback time, waveform and seek interactions](adr-0214-time-seek.md) | Listen | P0 | Accepted | Implemented (6/8), 2 Not started | No (0/8) |
| [ADR-0215 - Up Next as musical anticipation with safe steering](adr-0215-up-next.md) | Listen | P1 | Accepted | Implemented (4/8), 4 Needs a person | No (0/8) |
| [ADR-0216 - Editorial Explore gallery and genuine mix reveal](adr-0216-explore-gallery.md) | Explore | P0 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0217 - Listening Compass and scoped, supported musical shaping](adr-0217-listening-compass.md) | Explore | P1 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0218 - Wordplay and harmonic Connection Gallery grounded in actual evidence](adr-0218-connection-gallery.md) | Explore | P1 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0219 - Create workspace in Story, Arrangement and Detail modes](adr-0219-create-workspace.md) | Create | P0 | Accepted | Implemented (4/8), 4 Needs a person | No (0/8) |
| [ADR-0220 - Tactile song reorder and selectable seam objects with revision safety](adr-0220-arrangement-gestures.md) | Create | P0 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0221 - Hear-first Transition Inspector with technique truth and conditional A/B](adr-0221-transition-inspector.md) | Create | P0 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0222 - Intended versus achieved Energy Horizon composition](adr-0222-energy-composition.md) | Create | P1 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0223 - Stem Studio as a truthful two-song musical canvas](adr-0223-studio-canvas.md) | Studio | P0 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0224 - Explainable Studio arrangement proposals and safe local recovery](adr-0224-studio-ai-diff.md) | Studio | P0 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0225 - Requests as visible musical intentions and consented bridge routes](adr-0225-requests-route.md) | Requests | P0 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0226 - Library as both personal record collection and fast professional index](adr-0226-library-experience.md) | Library | P0 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0227 - Song Details: trusted analysis, metadata corrections and availability](adr-0227-song-identity.md) | Library | P1 | Accepted | Implemented (6/8), 2 Needs a person | No (0/8) |
| [ADR-0228 - My Mixes: collectible sleeves, explicit current performance and render line](adr-0228-my-mixes.md) | My Mixes | P0 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0229 - First-run library awakening with honest local filesystem and first play](adr-0229-first-run.md) | Onboarding | P0 | Accepted | Implemented (4/8), 4 Needs a person | No (0/8) |
| [ADR-0230 - Workspace for truthful analysis, source health, storage and diagnostics](adr-0230-workspace.md) | Workspace | P1 | Accepted | Implemented (5/8), 3 Needs a person | No (0/8) |
| [ADR-0231 - Export Studio: frozen revision, honest render progress and finished artifact](adr-0231-export-experience.md) | Export | P0 | Accepted | Implemented (7/8), 1 Needs a person | No (0/8) |
| [ADR-0232 - System-wide feedback, Undo, intentional interruptions and resilient recovery](adr-0232-feedback-recovery.md) | Cross-cutting | P0 | Accepted | Implemented (6/8), 1 In progress, 1 Not started | No (0/8) |
| [ADR-0233 - Responsive cinematic-to-precision layouts from 320px to wide screens](adr-0233-responsive-scenes.md) | Cross-cutting | P0 | Accepted | Implemented (6/8), 1 In progress, 1 Not started | No (0/8) |
| [ADR-0234 - Accessibility as an artistic constraint, WCAG 2.2 AA and semantic parity](adr-0234-accessible-art.md) | Quality | P0 | Accepted | Implemented (5/8), 1 In progress, 2 Not started | No (0/8) |
| [ADR-0235 - Audio-first performance and power-aware artistic rendering](adr-0235-performance.md) | Quality | P0 | Accepted | Implemented (3/8), 4 In progress, 1 Not started | No (0/8) |
| [ADR-0236 - Modular frontend visual architecture and safe migration seams](adr-0236-frontend-architecture.md) | Architecture | P0 | Accepted | Implemented (7/8), 1 Superseded | No (0/8) |
| [ADR-0237 - Shared data provenance and authoritative music-state truth](adr-0237-truth-provenance.md) | Architecture | P0 | Accepted | Implemented (6/8), 1 In progress, 1 Not started | No (0/8) |
| [ADR-0238 - Local-first privacy and future SaaS-ready boundaries without SaaS](adr-0238-privacy-future.md) | Architecture | P0 | Accepted | Implemented (6/8), 2 Superseded | No (0/8) |
| [ADR-0239 - Automated regression strategy and visual-evidence governance](adr-0239-test-architecture.md) | Verification | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0240 - Independent listening research and artistic quality acceptance](adr-0240-human-research.md) | Verification | P0 | Accepted | Implemented (6/8), 2 Not started | No (0/8) |
| [ADR-0241 - Incremental scene migration, compatibility and reversible release slices](adr-0241-migration-rollback.md) | Delivery | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |
| [ADR-0242 - Music-native microcopy, state language and non-patronizing feedback](adr-0242-musical-microcopy.md) | Content | P1 | Accepted | Implemented (6/8), 1 In progress, 1 Not started | No (0/8) |
| [ADR-0243 - Tactile gestures, pointer feedback and equal keyboard control](adr-0243-creative-gestures.md) | Interaction | P1 | Accepted | Implemented (5/8), 2 In progress, 1 Not started | No (0/8) |
| [ADR-0244 - Search-first navigation and expert command palette continuity](adr-0244-command-palette.md) | Shell | P1 | Accepted | Implemented (5/8), 2 In progress, 1 Not started | No (0/8) |
| [ADR-0245 - Final visual-detail audit and art-direction coherence](adr-0245-final-pixel-polish.md) | Polish | P1 | Accepted | Implemented (2/8), 3 In progress, 3 Not started | No (0/8) |
| [ADR-0246 - Complete listening-to-creation journey and musical delight milestones](adr-0246-end-to-end-journey.md) | Experience | P0 | Accepted | Implemented (1/8), 1 In progress, 6 Not started | No (0/8) |
| [ADR-0247 - Implementation-status integrity and independent GO/NO-GO governance](adr-0247-release-governance.md) | Delivery | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) |

## Delivery phases, scope and acceptance gates

### Phase 0 - Evidence and safety baseline

**Linked ADRs:** [ADR-0198](adr-0198-artistic-product-charter.md), [ADR-0199](adr-0199-historical-status-reconciliation.md), [ADR-0237](adr-0237-truth-provenance.md), [ADR-0238](adr-0238-privacy-future.md)

**Work:** Inventory current source, distinguish earlier implementation from new acceptance, record source SHA/devices and pin what cannot regress.

**Exit gate:** Baseline manifests, approved test plan, provenance and scope contracts.

### Phase 1 - Artistic alternatives and design selection

**Linked ADRs:** [ADR-0200](adr-0200-art-direction.md), [ADR-0201](adr-0201-semantic-colour-themes.md), [ADR-0202](adr-0202-typography.md), [ADR-0203](adr-0203-spatial-composition.md), [ADR-0206](adr-0206-music-artwork.md), [ADR-0207](adr-0207-the-thread.md)

**Work:** Compare three distinct art directions and a truthful Thread/Mix Sleeve visual grammar in both themes.

**Exit gate:** Owner-approved art direction, signed legibility and source-data truth review.

### Phase 2 - Components and interaction foundation

**Linked ADRs:** [ADR-0204](adr-0204-primitives.md), [ADR-0205](adr-0205-sensory-motion.md), [ADR-0232](adr-0232-feedback-recovery.md), [ADR-0242](adr-0242-musical-microcopy.md), [ADR-0243](adr-0243-creative-gestures.md)

**Work:** Normalize control state/semantics, motion, input gestures, copy, error and Undo outcomes.

**Exit gate:** Component specimens pass state, keyboard, touch, forced-colors and reduce-motion inspection.

### Phase 3 - Scene navigation and persistent player

**Linked ADRs:** [ADR-0208](adr-0208-navigation.md), [ADR-0209](adr-0209-persistent-player.md), [ADR-0244](adr-0244-command-palette.md)

**Work:** Recompose Listen, Explore, Create, Library and Workspace while preserving deep links, scope and single owner.

**Exit gate:** Audio and route/focus E2E prove no restart or surprise resume.

### Phase 4 - Signature Listening Theatre

**Linked ADRs:** [ADR-0210](adr-0210-listening-theatre.md), [ADR-0211](adr-0211-real-handoff.md), [ADR-0212](adr-0212-visualizer-curation.md), [ADR-0213](adr-0213-lyric-stage.md), [ADR-0214](adr-0214-time-seek.md), [ADR-0215](adr-0215-up-next.md)

**Work:** Ship song-first hero, handoff choreography, polished spectrum, lyrics/Stage, true seek and Up Next.

**Exit gate:** Real tracks, measured audio timing, silence, reduced motion and human listening review.

### Phase 5 - Explore and intention

**Linked ADRs:** [ADR-0216](adr-0216-explore-gallery.md), [ADR-0217](adr-0217-listening-compass.md), [ADR-0218](adr-0218-connection-gallery.md)

**Work:** Build editorial gallery, optional Compass and real relationship discoveries.

**Exit gate:** No invented plan/connection; scope and eligibility tests; participant comprehension.

### Phase 6 - Create, arrangement and inspector

**Linked ADRs:** [ADR-0219](adr-0219-create-workspace.md), [ADR-0220](adr-0220-arrangement-gestures.md), [ADR-0221](adr-0221-transition-inspector.md), [ADR-0222](adr-0222-energy-composition.md)

**Work:** Coordinate Story/Arrangement/Detail, tactile reorder, audition-first inspector and accurate energy horizon.

**Exit gate:** 100-song edit stress, exact pair/revision, preview ownership, Undo and DJ audition.

### Phase 7 - Stem Studio

**Linked ADRs:** [ADR-0223](adr-0223-studio-canvas.md), [ADR-0224](adr-0224-studio-ai-diff.md)

**Work:** Refresh eight-lane/8–64-cell workspace and returned AI diff with recovery.

**Exit gate:** Audio-focus test, exact cell diff, recovered work and keyboard list parity.

### Phase 8 - Local collection and song details

**Linked ADRs:** [ADR-0226](adr-0226-library-experience.md), [ADR-0227](adr-0227-song-identity.md)

**Work:** Implement expressive collection and precision table, metadata provenance and corrections.

**Exit gate:** 20k-song stress, readiness, untouched source media and search focus.

### Phase 9 - Requests and My Mixes

**Linked ADRs:** [ADR-0225](adr-0225-requests-route.md), [ADR-0228](adr-0228-my-mixes.md)

**Work:** Make request routes/consent and current-versus-draft project identity explicit.

**Exit gate:** Atomic bridge, current/draft guard, priority/export queue distinction.

### Phase 10 - Setup, operations and finishing

**Linked ADRs:** [ADR-0229](adr-0229-first-run.md), [ADR-0230](adr-0230-workspace.md), [ADR-0231](adr-0231-export-experience.md)

**Work:** Make local onboarding, real job health, frozen FLAC rendering and completion coherent.

**Exit gate:** Six-ready tracks, path/privacy disclosure, real job evidence, decodable FLAC.

### Phase 11 - Cross-screen responsive and high craft

**Linked ADRs:** [ADR-0233](adr-0233-responsive-scenes.md), [ADR-0234](adr-0234-accessible-art.md), [ADR-0235](adr-0235-performance.md), [ADR-0236](adr-0236-frontend-architecture.md), [ADR-0245](adr-0245-final-pixel-polish.md)

**Work:** Audit spatial reflow, human access, performance, CSS/module architecture and final pixel coherence.

**Exit gate:** 320px/400%/AT and named-hardware playback-load evidence.

### Phase 12 - Independent release acceptance

**Linked ADRs:** [ADR-0239](adr-0239-test-architecture.md), [ADR-0240](adr-0240-human-research.md), [ADR-0241](adr-0241-migration-rollback.md), [ADR-0246](adr-0246-end-to-end-journey.md), [ADR-0247](adr-0247-release-governance.md)

**Work:** Complete automated coverage and uncoached human/music research, verify rollback and commit-scoped gates.

**Exit gate:** Independent exact-SHA sign-off and P0/P1 dispositions; no premature GO.

## Critical implementation order and dependencies

1. Lock the source baseline, behavior/feature preservation inventory, data provenance and human verification protocol before visual changes.
2. Choose art direction and shared tokens/typographic system before rewriting screens. Complete trustworthy component statuses and motion settings before introducing choreography.
3. Protect the single player, current/draft scopes and routes before first immersive Listen redesign.
4. Build every new screen with empty, slow, failed, offline and replay/rollback states at the same time as the happy path.
5. For auditory significance, use real audio fixtures, hardware and human listening. Muted synthetic Edge E2E and screenshot candidates never substitute for those gates.
6. Deliver incremental PRs under repository maintainability limits. No original song rewrite, automatic cloud/SaaS, account or telemetry is proposed.

**Start packages:** baseline/safety → art direction/Thread → shared controls/shell → Listening Theatre/real handoff → Explore/Create → Studio/Library/Requests/operations → device/AT/audio evidence. Each package has an owner, implementing PR/SHA, explicitly independent reviewer and rollback plan.

[Complete 400-task checklist](selecta-flow-implementation-checklist.md) · [Individual evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Verification](selecta-flow-verification-matrix.md) · [Release NO-GO](selecta-flow-release-gates.md) · [Status reconciliation](selecta-flow-status-reconciliation.md).
