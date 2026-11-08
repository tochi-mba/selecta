# Selecta — Unified Experience Finish ADR roadmap (0366–0389)

**Status:** 24 Accepted ADRs (0366–0389); 171 UF tasks Not started; 21 In progress; 0 Implemented; 0 independently Verified. Requester accepted all UF ADRs on 2026-11-08. PR #41 includes source changes and regression tests; implementing PR/SHA is recorded per task, and independent reviewers/device evidence remain outstanding. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08).

## Why a unified programme

Selecta's existing UI, Flow, micro-polish, Lucy and Library plans have overlapping decisions and different historical implementation baselines. This **accepted programme sequences design, integration and independent proof** rather than re-implementing already source-present features. Prior historical statuses remain intact. **LX-0340–0352 owns Library design and LU-0300–0339/LX-0355–0363 own Lucy**; UF-0376–0378 coordinate cross-screen acceptance, not a second feature implementation.

The product direction is three mutually consistent experiences: cinematic and calm **Listen**, inviting **Discover**, and exact tactile **Create**; practical Library and Workspace. Use real playback/audio data, meaningful artwork, semantic colours and a clear current/proposed/rendered/playing vocabulary.

## ADR register

| New ADR | Phase | Priority | Decision | New implementation | Independent verification |
|---|---|---|---|---|---|
| [ADR-0366](adr-0366-unified-finish-charter-and-parity.md) — Unified finish charter, current-source baseline and ADR parity | 01 Baseline | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0367](adr-0367-task-research-and-measurement.md) — Uncoached UX research, comprehension baselines and outcome metrics | 01 Baseline | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0368](adr-0368-design-tokens-and-css-ownership.md) — Semantic design tokens, theme contrast and CSS ownership | 02 Foundation | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0369](adr-0369-typography-music-artwork-and-density.md) — Typography, honest artwork, spatial rhythm and density | 02 Foundation | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0370](adr-0370-shared-controls-overlays-and-feedback.md) — Shared controls, overlays, action hierarchy and feedback | 02 Foundation | P0 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |
| [ADR-0371](adr-0371-truthful-loading-recovery-and-async-state.md) — Long-job progress, asynchronous truth and local recovery | 02 Foundation | P0 | Accepted | 0/8 Implemented (4 In progress) | 0/8 No |
| [ADR-0372](adr-0372-navigation-onboarding-and-returning-context.md) — Navigation, first-run readiness and returning-work continuity | 03 Navigation | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0373](adr-0373-persistent-player-and-audio-focus.md) — Persistent player, system media controls and audio focus | 03 Navigation | P0 | Accepted | 0/8 Implemented (3 In progress) | 0/8 No |
| [ADR-0374](adr-0374-listening-hierarchy-lyrics-and-handoffs.md) — Listen hierarchy, lyrics integrity, seek and transitions | 04 Listen | P1 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |
| [ADR-0375](adr-0375-visualizer-stage-and-sensory-motion.md) — Existing fifteen visualisers, Stage and sensory-safe motion | 04 Listen | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0376](adr-0376-make-a-mix-quick-play-and-intent.md) — Make a Mix quick paths, moods, shaping and Lucy handoff | 05 Creation entry | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0377](adr-0377-library-experience-integration-and-proof.md) — Library integration, LX ownership and exact-recording safety | 05 Creation entry | P0 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |
| [ADR-0378](adr-0378-lucy-creation-integration-and-proof.md) — Lucy integration, proposal lifecycle, consent and safe approval | 05 Creation entry | P0 | Accepted | 0/8 Implemented (2 In progress) | 0/8 No |
| [ADR-0379](adr-0379-my-mixes-drafts-render-line.md) — My Mixes, current/draft identity and render-line hierarchy | 05 Creation | P1 | Accepted | 0/8 Implemented (3 In progress) | 0/8 No |
| [ADR-0380](adr-0380-editor-arrangement-and-song-seam-identity.md) — Editor sequence, Story/Arrange parity and exact seam identity | 06 Advanced creation | P1 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |
| [ADR-0381](adr-0381-seam-inspector-audition-and-explanation.md) — Seam Inspector audition, technique truth and accessible editing | 06 Advanced creation | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0382](adr-0382-stem-studio-musical-canvas.md) — Eight-lane Stem Studio, shape/grid/list consistency and apply safety | 06 Advanced creation | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0383](adr-0383-requests-bridges-and-consent.md) — Song requests, bridge routes and explicit atomic consent | 07 Supporting | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0384](adr-0384-discovery-word-and-harmonic-gallery.md) — Word/harmonic connections, candidate truth and audition-first discovery | 07 Supporting | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0385](adr-0385-workspace-operations-storage-and-recovery.md) — Workspace hierarchy, diagnostics, sources, storage and local backups | 07 Supporting | P1 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0386](adr-0386-exports-frozen-revisions-and-listening-study.md) — Export progression, exact frozen revisions and blind-study integrity | 07 Supporting | P1 | Accepted | 0/8 Implemented (3 In progress) | 0/8 No |
| [ADR-0387](adr-0387-responsive-reflow-and-input-adaptation.md) — Responsive geometry, zoom, mobile keyboard and input parity | 08 Verification | P0 | Accepted | 0/8 Implemented (0 In progress) | 0/8 No |
| [ADR-0388](adr-0388-accessibility-language-and-motion-acceptance.md) — WCAG accessibility, plain-language status and sensory safety | 08 Verification | P0 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |
| [ADR-0389](adr-0389-independent-visual-usability-and-release-gates.md) — Independent visual, human, performance, real-audio and release GO/NO-GO | 08 Verification | P0 | Accepted | 0/8 Implemented (1 In progress) | 0/8 No |

## Ordered delivery and phase gates

1. **Baseline:** UF-0366–0367 — pin exact source, reconcile duplicate historical owners, classify true gaps versus verification-only and observe uncoached tasks before modifying code.
2. **Shared foundation:** UF-0368–0371 — semantic token/cascade ownership, typography, music imagery, reusable controls and truthful asynchronous states; no unreviewed rebranding.
3. **Navigation and safety:** UF-0372–0373 — first run, returning context and persistent playback continuity across every route.
4. **Listen:** UF-0374–0375 — music-first hierarchy, genuine lyrics/seam clock, Stage and curation of **fifteen existing** visualisers.
5. **Creation integration:** UF-0376–0382 — Make a Mix, Library/Lucy LX/LU parity, drafts/render line, exact editor and Inspector/Studio paths.
6. **Supporting journeys:** UF-0383–0386 — requests/bridges, word/harmonic candidates, operations/backups and frozen-revision exports/study.
7. **Cross-device verification:** UF-0387–0388 — 320px/400% reflow, keyboard and touch, assistive technology, plain-language copy and sensory safety.
8. **Independent release gate:** UF-0389 — approved paired screenshots, human completion, named-device performance, real-audio review, compatibility regression and rollback.

## Proposed measurable exit targets (not measured results)

- At least **90% uncoached critical-task completion** for separately reported novice/expert groups as a *candidate target requiring pre-study owner approval*, with sample sizes and uncertainty; do not misstate a small qualitative study as statistical proof.
- Unprompted comprehension of imported/analysed/mix-ready, proposal versus draft, queued/rendered/ready, playback and Save draft versus Save and play.
- Accessibility: applicable WCAG 2.2 AA, physical keyboard and representative NVDA/VoiceOver/TalkBack tasks, screen reflow through 200/400% zoom, forced colours and motion preference hierarchy.
- Layout: 320–3840px, short landscape, mobile keyboard safe area, matched Light/Dark/System and meaningful compact density.
- Performance: 20k-song Library, long Lucy transcript, 40+ song editor and active spectrum on named devices; LCP ≤2.5s/INP ≤200ms/CLS ≤0.1 where meaningful as *reference* benchmarks, not claimed field percentiles.
- Safety: zero known critical unrequested Pause/start/swap, wrong song ID, duplicate commit, unconsented bridge, false ready-only seam or invalid output.

## Preservation boundary

Keep local original audio unchanged; one audio-focus owner and deliberate Pause; exact recording/mix/draft/revision/occurrence/seam identity, scoped Undo; explicit consent and atomic ready-only bridge checks (K songs need K−1 valid cached directed seams); all eight Stem Studio lanes and 8–64-cell shapes; truthful analysis and lyric provenance; frozen-revision decodable FLAC; blinded human listening protocols. No SaaS, accounts, telemetry, remote media upload, native folder bridge or audio-engine rewrite is authorised.

## Status process

Each acceptance has its own **Proposed decision**, **Not started/In progress/Implemented source state**, and **No/Yes independent verification** with owner, PR, exact SHA and evidence fields. Source capabilities already present are **not called missing**. Count totals are for UF acceptance tasks, not unique global app features. Update the ADR, checklist, evidence ledger and JSON together only after genuine implementation and independent verification.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)
