# Selecta — measured micro-polish roadmap, ADR-0272–0299

**Status:** 28 Proposed ADRs (0272–0299); 224 acceptance tasks Not started; 0 In progress; 0 Implemented; 0 Independently Verified. Owner unassigned. Planning baseline main `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4` (2026-11-08). Docs only.

## Scope and reasoning

This programme applies the existing design language to all details from 1px alignment to full workflow hierarchy. It is additive to existing SF/GP/FP and prior decisions. Do not treat a new task as proof that the existing implementation lacks a feature; reconcile the precise acceptance first.

| ADR | Priority | Earlier owner ADRs | Decision | Implemented | Independently Verified |
|---|---|---|---|---|---|
| [ADR-272 — Selector-level pixel baseline and defect register](adr-0272-selector-visual-baseline.md) | P0 | 0199,0239,0271 | Proposed | 0/8 | 0/8 |
| [ADR-273 — Spacing, margins, padding and visual rhythm](adr-0273-spacing-and-vertical-rhythm.md) | P0 | 0203,0245 | Proposed | 0/8 | 0/8 |
| [ADR-274 — Optical alignment, grid guides and one-pixel details](adr-0274-optical-alignment-and-pixel-edges.md) | P0 | 0203,0204,0245 | Proposed | 0/8 | 0/8 |
| [ADR-275 — Typography scale, text wrapping and numeric metadata](adr-0275-typography-and-long-song-names.md) | P0 | 0202,0248,0257 | Proposed | 0/8 | 0/8 |
| [ADR-276 — Surface depth, borders, shadows and accent hierarchy](adr-0276-colour-surface-depth-and-borders.md) | P1 | 0200,0201,0264,0266 | Proposed | 0/8 | 0/8 |
| [ADR-277 — Icon sizes, badge baselines and button microgeometry](adr-0277-iconography-badges-and-button-geometry.md) | P1 | 0204,0245 | Proposed | 0/8 | 0/8 |
| [ADR-278 — CSS cascade collisions and visual ownership cleanup](adr-0278-css-ownership-and-cascade-cleanup.md) | P0 | 0130,0236,0245 | Proposed | 0/8 | 0/8 |
| [ADR-279 — Shared component state gallery and visual acceptance](adr-0279-shared-component-visual-specimens.md) | P0 | 0204,0232,0269 | Proposed | 0/8 | 0/8 |
| [ADR-280 — Navigation rail, breadcrumbs and mobile bar polish](adr-0280-navigation-shell-and-breadcrumbs.md) | P0 | 0208,0139,0270 | Proposed | 0/8 | 0/8 |
| [ADR-281 — Persistent mini-player and fixed chrome micro-polish](adr-0281-persistent-mini-player.md) | P0 | 0140,0209,0270 | Proposed | 0/8 | 0/8 |
| [ADR-282 — First run, folder setup and readiness hierarchy](adr-0282-onboarding-and-readiness.md) | P1 | 0141,0229,0256 | Proposed | 0/8 | 0/8 |
| [ADR-283 — Make a Mix hero, idea cards and filters polish](adr-0283-explore-hero-and-idea-cards.md) | P0 | 0216,0268,0259 | Proposed | 0/8 | 0/8 |
| [ADR-284 — Listen hero, lyrics, music spectrum and handoff polish](adr-0284-listen-hero-and-spectrum.md) | P0 | 0210,0211,0249,0266 | Proposed | 0/8 | 0/8 |
| [ADR-285 — Stage fullscreen lyric theatre and immersive balance](adr-0285-stage-immersive-lyrics.md) | P1 | 0213,0214,0249 | Proposed | 0/8 | 0/8 |
| [ADR-286 — My Mixes, draft cards and render queue finishing](adr-0286-my-mixes-and-render-line.md) | P1 | 0228,0255,0269 | Proposed | 0/8 | 0/8 |
| [ADR-287 — Editor timeline row grid, grips, seams and selection](adr-0287-editor-song-seam-geometry.md) | P0 | 0219,0220,0250 | Proposed | 0/8 | 0/8 |
| [ADR-288 — Seam inspector selected pair, audition and parameter hierarchy](adr-0288-seam-inspector-audition-and-forms.md) | P1 | 0221,0250,0269 | Proposed | 0/8 | 0/8 |
| [ADR-289 — Stem Studio eight-lane grid, ruler and unapplied changes](adr-0289-stem-studio-grid-and-controls.md) | P1 | 0223,0224,0261 | Proposed | 0/8 | 0/8 |
| [ADR-290 — Requests drawer, pending status and bridge consent polish](adr-0290-requests-bridge-proposal-and-status.md) | P1 | 0225,0262,0270 | Proposed | 0/8 | 0/8 |
| [ADR-291 — Library search, column alignment, density and selection rail](adr-0291-library-search-rows-and-batch-actions.md) | P1 | 0226,0227,0251,0258,0267 | Proposed | 0/8 | 0/8 |
| [ADR-292 — Word connections and harmonic discovery cards/audition finishing](adr-0292-harmonic-and-word-discovery.md) | P1 | 0218,0251,0260 | Proposed | 0/8 | 0/8 |
| [ADR-293 — Workspace operations, storage, analysis and local backup layout](adr-0293-workspace-operations-and-backups.md) | P1 | 0230,0253,0263 | Proposed | 0/8 | 0/8 |
| [ADR-294 — Export job progression and blind listening-study precision](adr-0294-export-and-blind-listening-study.md) | P1 | 0231,0157,0158 | Proposed | 0/8 | 0/8 |
| [ADR-295 — Global overlays, command palette, Activity and toast geometry](adr-0295-overlays-toasts-and-command-palette.md) | P0 | 0204,0232,0244,0270 | Proposed | 0/8 | 0/8 |
| [ADR-296 — Motion tokens, interruptions and truthful musical animation](adr-0296-motion-and-music-clock.md) | P1 | 0137,0205,0211,0266 | Proposed | 0/8 | 0/8 |
| [ADR-297 — Skeletons, async feedback, errors and local recovery](adr-0297-loading-recovery-and-layout-stability.md) | P0 | 0232,0255,0270 | Proposed | 0/8 | 0/8 |
| [ADR-298 — Responsive geometry, accessibility and real-device performance acceptance](adr-0298-responsive-accessibility-and-budgets.md) | P0 | 0233,0234,0235,0257,0270,0271 | Proposed | 0/8 | 0/8 |
| [ADR-299 — Human pixel review, task validation and independent release gate](adr-0299-human-acceptance-and-go-no-go.md) | P0 | 0239,0240,0247,0271 | Proposed | 0/8 | 0/8 |

## Incremental phase gates

1. **Baseline ADR-0272:** Record exact route/state/selector/viewport geometry and candidate images.
2. **Foundations ADR-0273–0278:** Normalize margins, typography, optical alignments, colour, icons and CSS ownership.
3. **Components ADR-0279:** Confirm every applicable shared component visual and accessibility state.
4. **Shell ADR-0280–0281:** Align rail, context header, mini-player and bottom navigation.
5. **Listener ADR-0282–0285:** Refine onboarding, Explore, Listen and fullscreen Stage.
6. **Creator ADR-0286–0289:** Refine drafts, timeline, inspector and Stem Studio.
7. **Supporting ADR-0290–0294:** Refine Requests, Library, Discovery, Workspace, Export and blind study.
8. **Interaction ADR-0295–0297:** Perfect overlays, animations and async state continuity.
9. **Acceptance ADR-0298–0299:** Human visual, device, keyboard/AT, actual audio and performance acceptance and GO/NO-GO.

## Implementation boundaries

Every task requires a current source/older-ADR crosswalk; before/after same-state evidence; a small reversible source change if needed; a test-linked implementing PR and SHA; and separate named independent verification. A docs-only proposal can merge with all tasks unimplemented.

**Preserve:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

[Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Status](selecta-measured-micro-polish-code-status.json) · [Overlap](selecta-measured-micro-polish-overlap-and-parity.md) · [Geometry](selecta-measured-micro-polish-geometry-contract.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
