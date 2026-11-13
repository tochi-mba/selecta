# Selecta - MP historical ADR overlap, scope and feature parity

**Status:** 28 Proposed ADRs (0272–0299); 1 acceptance tasks Not started; 29 In progress; 194 Implemented; 0 Independently Verified (recounted from the checklist task lines 2026-11-12). Owner unassigned. Planning baseline main `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4` (2026-11-08). Implementation candidate; independently unverified.

Prior owner links describe related acceptance authority, not missing code, implementation status or automatic signoff.

| New ADR | Prior owners | Source touchpoints |
|---|---|---|
| [ADR-272](adr-0272-selector-visual-baseline.md) | ADR-0199, ADR-0239, ADR-0271 | `web/e2e/paired-theme.e2e.ts`; `docs/adr/completion/route-state-register.md` |
| [ADR-273](adr-0273-spacing-and-vertical-rhythm.md) | ADR-0203, ADR-0245 | `web/src/styles/tokens.css`; `web/src/style.css`; `web/src/styles/polish.css` |
| [ADR-274](adr-0274-optical-alignment-and-pixel-edges.md) | ADR-0203, ADR-0204, ADR-0245 | `web/src/styles/shell.css`; `web/src/styles/operations.css`; `web/src/styles/creation.css` |
| [ADR-275](adr-0275-typography-and-long-song-names.md) | ADR-0202, ADR-0248, ADR-0257 | `web/src/styles/tokens.css`; `web/src/views/Now.tsx`; `web/src/views/Library.tsx` |
| [ADR-276](adr-0276-colour-surface-depth-and-borders.md) | ADR-0200, ADR-0201, ADR-0264, ADR-0266 | `web/src/styles/tokens.css`; `web/src/styles/foundation.css` |
| [ADR-277](adr-0277-iconography-badges-and-button-geometry.md) | ADR-0204, ADR-0245 | `web/src/ui/Icon.tsx`; `web/src/ui/primitives.tsx` |
| [ADR-278](adr-0278-css-ownership-and-cascade-cleanup.md) | ADR-0130, ADR-0236, ADR-0245 | `web/src/style.css`; `web/src/styles/polish.css`; `docs/adr/completion/css-ownership.md` |
| [ADR-279](adr-0279-shared-component-visual-specimens.md) | ADR-0204, ADR-0232, ADR-0269 | `web/src/ui/ControlGallery.tsx`; `web/src/ui/controls.tsx`; `web/src/ui/primitives.tsx` |
| [ADR-280](adr-0280-navigation-shell-and-breadcrumbs.md) | ADR-0208, ADR-0139, ADR-0270 | `web/src/shell/Shell.tsx`; `web/src/shell/manifest.ts`; `web/src/styles/shell.css` |
| [ADR-281](adr-0281-persistent-mini-player.md) | ADR-0140, ADR-0209, ADR-0270 | `web/src/shell/Shell.tsx`; `web/src/styles/shell.css` |
| [ADR-282](adr-0282-onboarding-and-readiness.md) | ADR-0141, ADR-0229, ADR-0256 | `web/src/views/Start.tsx`; `web/src/views/Setup.tsx` |
| [ADR-283](adr-0283-explore-hero-and-idea-cards.md) | ADR-0216, ADR-0268, ADR-0259 | `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`; `web/src/styles/listening.css` |
| [ADR-284](adr-0284-listen-hero-and-spectrum.md) | ADR-0210, ADR-0211, ADR-0249, ADR-0266 | `web/src/views/Now.tsx`; `web/src/views/spectrumVisuals.ts`; `web/src/styles/listening.css` |
| [ADR-285](adr-0285-stage-immersive-lyrics.md) | ADR-0213, ADR-0214, ADR-0249 | `web/src/views/Now.tsx`; `web/src/styles/listening.css` |
| [ADR-286](adr-0286-my-mixes-and-render-line.md) | ADR-0228, ADR-0255, ADR-0269 | `web/src/views/MyMixes.tsx`; `web/src/views/Drafts.tsx` |
| [ADR-287](adr-0287-editor-song-seam-geometry.md) | ADR-0219, ADR-0220, ADR-0250 | `web/src/views/Mix.tsx`; `web/src/views/EditorRows.tsx`; `web/src/styles/creation.css` |
| [ADR-288](adr-0288-seam-inspector-audition-and-forms.md) | ADR-0221, ADR-0250, ADR-0269 | `web/src/views/SeamInspector.tsx`; `web/src/styles/creation.css` |
| [ADR-289](adr-0289-stem-studio-grid-and-controls.md) | ADR-0223, ADR-0224, ADR-0261 | `web/src/views/Studio.tsx`; `web/src/styles/creation.css` |
| [ADR-290](adr-0290-requests-bridge-proposal-and-status.md) | ADR-0225, ADR-0262, ADR-0270 | `web/src/views/Requests.tsx`; `web/src/styles/operations.css` |
| [ADR-291](adr-0291-library-search-rows-and-batch-actions.md) | ADR-0226, ADR-0227, ADR-0251, ADR-0258, ADR-0267 | `web/src/views/Library.tsx`; `web/src/views/SongDetails.tsx`; `web/src/styles/operations.css` |
| [ADR-292](adr-0292-harmonic-and-word-discovery.md) | ADR-0218, ADR-0251, ADR-0260 | `web/src/views/Links.tsx`; `web/src/ui/MusicObjects.tsx` |
| [ADR-293](adr-0293-workspace-operations-and-backups.md) | ADR-0230, ADR-0253, ADR-0263 | `web/src/views/Workshop.tsx`; `web/src/views/WorkshopPanels.tsx`; `web/src/views/LocalBackup.tsx` |
| [ADR-294](adr-0294-export-and-blind-listening-study.md) | ADR-0231, ADR-0157, ADR-0158 | `web/src/views/ExportPanel.tsx`; `web/src/views/ExportJobs.tsx`; `web/src/views/Listening.tsx` |
| [ADR-295](adr-0295-overlays-toasts-and-command-palette.md) | ADR-0204, ADR-0232, ADR-0244, ADR-0270 | `web/src/ui/controls.tsx`; `web/src/ui/CommandPalette.tsx`; `web/src/ui/toasts.tsx` |
| [ADR-296](adr-0296-motion-and-music-clock.md) | ADR-0137, ADR-0205, ADR-0211, ADR-0266 | `web/src/styles/tokens.css`; `web/src/styles/polish.css`; `web/src/views/Now.tsx` |
| [ADR-297](adr-0297-loading-recovery-and-layout-stability.md) | ADR-0232, ADR-0255, ADR-0270 | `web/src/state/async.ts`; `web/src/ui/Skeleton.tsx`; `web/src/ui/controls.tsx` |
| [ADR-298](adr-0298-responsive-accessibility-and-budgets.md) | ADR-0233, ADR-0234, ADR-0235, ADR-0257, ADR-0270, ADR-0271 | `web/e2e/pages.e2e.ts`; `web/e2e/overlay-arbitration.e2e.ts`; `docs/adr/completion/performance.md` |
| [ADR-299](adr-0299-human-acceptance-and-go-no-go.md) | ADR-0239, ADR-0240, ADR-0247, ADR-0271 | `docs/adr/completion/visual-evidence.md`; `docs/acceptance.md`; `web/e2e/paired-theme.e2e.ts` |

## Preservation requirements

Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

For each MP acceptance, classify **already satisfied from source**, **measured new gap**, **intentional specialist exception**, **redundant to old owner**, or **rejected after actual study**. Do not bulk-mark previous or new tasks implemented based on document existence, prior merges or screenshot candidates.
