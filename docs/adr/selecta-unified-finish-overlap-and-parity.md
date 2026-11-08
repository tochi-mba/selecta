# Selecta — Unified Finish prior-owner, current-source and overlap reconciliation

**Status:** 24 Accepted ADRs (0366–0389); 184 UF tasks Not started; 8 In progress; 0 Implemented; 0 independently Verified. Acceptance approved by requester on 2026-11-08; implementation owners and independent reviewers remain unassigned. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08); PR #41 now includes app source and regression tests.

## No fabricated missing work

UF documents *proposed acceptance deltas*, not a clean-slate rewrite. Earlier ADR design decisions and statuses remain authoritative until an owner explicitly accepts a change. For each task, pin implementing SHA and classify as **already satisfied / refinement / new requirement / verification only / duplicate or supersede / deferred**. Only then determine what code needs changing.

| Historical programme | Boundary |
|---|---|
| T/P/S3/S31/S4/EX/MI/CI | Original engine, screen, component and interaction implementations retain separate historical evidence |
| SF-0198–0247 | Accepted artistic UI/UX direction, music objects, Listen/Studio/player and integrity constraints |
| GP-0248–0263, FP-0264–0271, MP-0272–0299 | Broad gap, final and measured pixel polish; do not create duplicate CSS refactors |
| LU-0300–0339 | Lucy architecture, provider boundaries, conversations, proposals and ready-only/commit correctness |
| LX-0340–0365 | Proposed full Library, Make a Mix and Lucy visual redesign; detailed design owner for these surfaces |
| **UF-0366–0389** | Cross-app orchestration, specific integration gaps and independent final release evidence only |

## Current-source acceptance crosswalk

| UF ADR | Earlier owner ADRs | Source touchpoints | Exact new decision / integration boundary |
|---|---|---|---|
| [ADR-0366](adr-0366-unified-finish-charter-and-parity.md) | ADR-0199, ADR-0239, ADR-0272, ADR-0299, ADR-0365 | `docs/adr/README.md`, `web/src/App.tsx` | Establish one additive source-verifiable finishing backlog, without reinterpreting historical statuses or proposing duplicate missing features. |
| [ADR-0367](adr-0367-task-research-and-measurement.md) | ADR-0199, ADR-0239, ADR-0240, ADR-0299, ADR-0340, ADR-0365 | `docs/research/ui-ux.md`, `web/e2e/flows.e2e.ts` | Define before/after user evidence, not assumed usability or statistically unsupported product claims. |
| [ADR-0368](adr-0368-design-tokens-and-css-ownership.md) | ADR-0200, ADR-0201, ADR-0203, ADR-0236, ADR-0264, ADR-0273, ADR-0278 | `web/src/main.tsx`, `web/src/styles/tokens.css`, `web/src/style.css`, `web/src/styles/polish.css` | Make legacy and modern CSS cascade behaviour intentional while protecting existing warm-dark Selecta identity. |
| [ADR-0369](adr-0369-typography-music-artwork-and-density.md) | ADR-0202, ADR-0203, ADR-0206, ADR-0245, ADR-0248, ADR-0273, ADR-0275, ADR-0276 | `web/src/styles/tokens.css`, `web/src/ui/MusicObjects.tsx` | Balance expressive Listen and mix identity with precise readable library, timing and music editing UI. |
| [ADR-0370](adr-0370-shared-controls-overlays-and-feedback.md) | ADR-0204, ADR-0232, ADR-0244, ADR-0269, ADR-0279, ADR-0295 | `web/src/ui/controls.tsx`, `web/src/ui/primitives.tsx`, `web/src/ui/toasts.tsx` | Consolidate already implemented primitives into one predictable interaction and state contract. |
| [ADR-0371](adr-0371-truthful-loading-recovery-and-async-state.md) | ADR-0232, ADR-0252, ADR-0255, ADR-0297, ADR-0352, ADR-0358 | `web/src/state/async.ts`, `web/src/state/jobs.ts`, `web/src/ui/Skeleton.tsx` | Queued analysis, scanning and seam rendering need factual progress and safe recovery across routes. |
| [ADR-0372](adr-0372-navigation-onboarding-and-returning-context.md) | ADR-0208, ADR-0229, ADR-0256, ADR-0280, ADR-0282, ADR-0340, ADR-0353 | `web/src/shell/manifest.ts`, `web/src/router.ts`, `web/src/views/Start.tsx` | Build on the existing five-intent shell and first-run flow without breaking deep links or silently changing music. |
| [ADR-0373](adr-0373-persistent-player-and-audio-focus.md) | ADR-0209, ADR-0214, ADR-0270, ADR-0281, ADR-0296, ADR-0362 | `web/src/shell/Shell.tsx`, `web/src/player.ts`, `web/src/audio/focus.ts` | Polish fixed player and preview handoffs without altering single audio-owner guarantees. |
| [ADR-0374](adr-0374-listening-hierarchy-lyrics-and-handoffs.md) | ADR-0210, ADR-0211, ADR-0213, ADR-0214, ADR-0215, ADR-0249, ADR-0284 | `web/src/views/Now.tsx`, `web/src/styles/listening.css` | Make current music and real temporal cues visually dominant without losing the many existing options. |
| [ADR-0375](adr-0375-visualizer-stage-and-sensory-motion.md) | ADR-0205, ADR-0212, ADR-0213, ADR-0266, ADR-0285, ADR-0296 | `web/src/views/spectrumVisuals.ts`, `web/src/views/Now.tsx`, `web/src/ui/useReducedMotion.ts` | Curate existing visualisers and motion preferences rather than rebuilding modes or faking music visuals. |
| [ADR-0376](adr-0376-make-a-mix-quick-play-and-intent.md) | ADR-0216, ADR-0217, ADR-0259, ADR-0268, ADR-0283, ADR-0353, ADR-0354 | `web/src/views/Mixes.tsx`, `web/src/views/MixSetup.tsx` | LX-0353/0354 own Make a Mix presentation; UF owns the combined journey and guards. |
| [ADR-0377](adr-0377-library-experience-integration-and-proof.md) | ADR-0226, ADR-0227, ADR-0267, ADR-0291, ADR-0340, ADR-0342, ADR-0347, ADR-0350, ADR-0365 | `web/src/views/Library.tsx`, `web/src/views/SongDetails.tsx`, `src/selecta/routes/library.py` | LX-0340–0352 remain primary Library design owners; UF only closes cross-app data, scope and evidence gaps. |
| [ADR-0378](adr-0378-lucy-creation-integration-and-proof.md) | ADR-0300, ADR-0317, ADR-0319, ADR-0328, ADR-0334, ADR-0355, ADR-0359, ADR-0360, ADR-0362, ADR-0365 | `web/src/views/Lucy.tsx`, `web/src/views/LucyProposal.tsx`, `web/src/views/LucyApprove.tsx` | LU-0300–0339 and LX-0355–0363 own Lucy behaviour and design. UF closes end-to-end cross-app interaction and evidence gaps only. |
| [ADR-0379](adr-0379-my-mixes-drafts-render-line.md) | ADR-0228, ADR-0255, ADR-0269, ADR-0286 | `web/src/views/MyMixes.tsx`, `web/src/views/Drafts.tsx`, `web/src/views/CurrentMix.tsx` | Existing draft storage, current mix and priority rendering need easily distinguishable identity and consequence. |
| [ADR-0380](adr-0380-editor-arrangement-and-song-seam-identity.md) | ADR-0219, ADR-0220, ADR-0222, ADR-0250, ADR-0287 | `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx`, `web/src/views/EditorStory.tsx` | Song occurrences, directed seam edges and revision-safe editing must remain exact across different visual representations. |
| [ADR-0381](adr-0381-seam-inspector-audition-and-explanation.md) | ADR-0221, ADR-0250, ADR-0269, ADR-0288 | `web/src/views/SeamInspector.tsx`, `web/src/ui/AudioPreview.tsx`, `web/src/ui/seam.ts` | Inspector already offers options, quality checks, audition and Studio; make requested, rendered and heard transition layers unmistakable. |
| [ADR-0382](adr-0382-stem-studio-musical-canvas.md) | ADR-0223, ADR-0224, ADR-0261, ADR-0289 | `web/src/views/Studio.tsx`, `web/src/studio.ts`, `web/src/styles/creation.css` | Existing eight-lane and 8–64-cell Stem Studio work must remain accurate and legible through a visual finish. |
| [ADR-0383](adr-0383-requests-bridges-and-consent.md) | ADR-0225, ADR-0262, ADR-0270, ADR-0290 | `web/src/views/Requests.tsx`, `src/selecta/requests.py`, `src/selecta/request_planner.py` | Existing request and bridge states need a clear lifecycle and informed user choices without relaxing music safety. |
| [ADR-0384](adr-0384-discovery-word-and-harmonic-gallery.md) | ADR-0218, ADR-0251, ADR-0260, ADR-0292 | `web/src/views/Links.tsx`, `src/selecta/routes/discover.py`, `src/selecta/discovery/search.py` | Machine-found lyric and harmonic connections are potential matches, not automatically verified high-quality transitions. |
| [ADR-0385](adr-0385-workspace-operations-storage-and-recovery.md) | ADR-0230, ADR-0253, ADR-0263, ADR-0293 | `web/src/views/Workshop.tsx`, `web/src/views/WorkshopPanels.tsx`, `web/src/views/LocalBackup.tsx` | Existing local operations need action-first hierarchy, honest background work and safe data recovery. |
| [ADR-0386](adr-0386-exports-frozen-revisions-and-listening-study.md) | ADR-0231, ADR-0157, ADR-0158, ADR-0294 | `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx`, `web/src/views/Listening.tsx` | FLAC export and blinded comparisons already exist; output status and study validity must stay truthful. |
| [ADR-0387](adr-0387-responsive-reflow-and-input-adaptation.md) | ADR-0233, ADR-0234, ADR-0270, ADR-0298, ADR-0351, ADR-0357 | `web/src/styles/shell.css`, `web/src/styles/operations.css`, `web/e2e/micro-polish-geometry.e2e.ts` | Full-app polish must be verified across narrow phones, high zoom, short landscape and dynamic overlays, not only ideal desktop. |
| [ADR-0388](adr-0388-accessibility-language-and-motion-acceptance.md) | ADR-0202, ADR-0204, ADR-0205, ADR-0233, ADR-0234, ADR-0257, ADR-0298, ADR-0364 | `web/src/ui/primitives.tsx`, `web/src/ui/controls.tsx`, `web/src/ui/useReducedMotion.ts` | Automated ARIA and motion tests do not constitute independent WCAG 2.2 AA or assistive-technology acceptance. |
| [ADR-0389](adr-0389-independent-visual-usability-and-release-gates.md) | ADR-0239, ADR-0240, ADR-0247, ADR-0271, ADR-0299, ADR-0336, ADR-0365 | `web/e2e/paired-theme.e2e.ts`, `web/e2e/visual.e2e.ts`, `web/bench/scale.bench.ts` | Existing synthetic visual captures are review candidates and muted E2E cannot prove musical quality or user comprehension. |

## Explicitly existing capabilities not to reimplement

- Local-first app, deep-link router, theme preferences and persistent audio player; one audio-focus system.
- Fifteen existing Listen spectrum visualisations, Stage, lyrics and current/upcoming handoff.
- Make a Mix Quick Play/mood cards/Lucy entry, saved/draft mix workflow and render priorities.
- Library ID-scoped search, filters, sort, list/card, density, batch selection and metadata corrections.
- Lucy conversation/history, scoped composer, exact proposals/revisions, consent and protected approval.
- Story/Arrange editor, directed seam inspector, eight-lane Stem Studio, Requests/bridge logic and song discoveries.
- Workspace sources/analysis/storage/diagnostics, local backup, FLAC export and blinded listening infrastructure.

Source presence does not equal independently verified visual polish or real-audio acceptance. The separate task statuses in all existing programmes retain their historical meaning; **do not add all their denominators together as missing product features**.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)
