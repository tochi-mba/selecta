# Selecta — LX overlap, ownership, parity and non-destructive scope

**Status:** 26 Proposed ADRs (0340–0365); 208 LX tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owner unassigned. Baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be` (2026-11-08). Documentation only.

This redesign is **additive visual/interaction acceptance** for two areas only, not a declaration that existing source features are absent. Current source may already meet some LX acceptance; future implementing PR must provide exact evidence before changing LX status. Earlier ADRs and their statuses are not edited.

| New ADR | Historical decisions owning related behaviour | Main source touchpoints |
|---|---|---|
| [ADR-340](adr-340-library-experience-charter-and-information-architecture.md) | ADR-0226, ADR-0177, ADR-0291, ADR-0251 | `web/src/views/Library.tsx`, `web/src/shell/manifest.ts`, `web/src/state/prefs.ts` |
| [ADR-341](adr-341-library-header-counts-and-collection-overview.md) | ADR-0226, ADR-0178, ADR-0180, ADR-0291 | `web/src/views/Library.tsx`, `web/src/styles/operations.css`, `web/src/state/readiness.ts` |
| [ADR-342](adr-342-library-search-and-exact-recording-retrieval.md) | ADR-0251, ADR-0291, ADR-0153, ADR-0314 | `web/src/views/Library.tsx`, `src/selecta/routes/library.py`, `src/selecta/library/relevance.py` |
| [ADR-343](adr-343-library-filters-sorting-and-musical-query-depth.md) | ADR-0291, ADR-0251, ADR-0226, ADR-0153 | `web/src/views/Library.tsx`, `src/selecta/routes/library.py`, `web/src/api.ts` |
| [ADR-344](adr-344-library-list-rows-and-dense-scanning.md) | ADR-0291, ADR-0275, ADR-0226, ADR-0245 | `web/src/views/Library.tsx`, `web/src/styles/operations.css`, `web/src/styles/music-objects.css` |
| [ADR-345](adr-345-library-collection-card-view-and-meaningful-artwork.md) | ADR-0226, ADR-0177, ADR-0245, ADR-0309 | `web/src/views/Library.tsx`, `web/src/styles/music-objects.css`, `web/src/ui/MusicObjects.tsx` |
| [ADR-346](adr-346-library-contextual-track-action-hierarchy.md) | ADR-0258, ADR-0267, ADR-0291, ADR-0226 | `web/src/views/Library.tsx`, `web/src/ui/controls.tsx`, `web/src/state/readiness.ts` |
| [ADR-347](adr-347-library-bulk-selection-scope-and-feedback.md) | ADR-0258, ADR-0267, ADR-0291, ADR-0314 | `web/src/views/Library.tsx`, `web/src/views/Library.test.tsx`, `src/selecta/routes/library.py` |
| [ADR-348](adr-348-library-song-inspector-and-metadata-provenance.md) | ADR-0227, ADR-0154, ADR-0291, ADR-0315 | `web/src/views/SongDetails.tsx`, `web/src/styles/operations.css`, `web/src/state/readiness.ts` |
| [ADR-349](adr-349-library-readiness-corrections-and-guarded-management.md) | ADR-0227, ADR-0252, ADR-0258, ADR-0291 | `web/src/views/SongDetails.tsx`, `web/src/state/readiness.ts`, `src/selecta/routes/library.py` |
| [ADR-350](adr-350-library-large-scale-paging-scroll-and-performance.md) | ADR-0017, ADR-0062, ADR-0105, ADR-0291 | `web/src/views/Library.tsx`, `web/src/views/Library.test.tsx`, `src/selecta/routes/library.py` |
| [ADR-351](adr-351-library-mobile-tablet-zoom-and-accessibility.md) | ADR-0233, ADR-0234, ADR-0298, ADR-0291 | `web/src/views/Library.tsx`, `web/src/styles/operations.css`, `web/src/ui/controls.tsx` |
| [ADR-352](adr-352-library-empty-loading-stale-and-error-experiences.md) | ADR-0232, ADR-0279, ADR-0297, ADR-0226 | `web/src/views/Library.tsx`, `web/src/ui/controls.tsx`, `web/src/styles/operations.css` |
| [ADR-353](adr-353-make-a-mix-quick-play-and-lucy-entry-architecture.md) | ADR-0216, ADR-0268, ADR-0283, ADR-0300, ADR-0301 | `web/src/views/Mixes.tsx`, `web/src/shell/manifest.ts`, `web/src/styles/creation.css` |
| [ADR-354](adr-354-make-a-mix-moods-discovery-and-creation-intent.md) | ADR-0216, ADR-0259, ADR-0283, ADR-0321 | `web/src/views/Mixes.tsx`, `web/src/views/MixSetup.tsx`, `web/src/lucy/words.ts` |
| [ADR-355](adr-355-lucy-desktop-proposal-conversation-workspace.md) | ADR-0301, ADR-0306, ADR-0307, ADR-0233 | `web/src/views/Lucy.tsx`, `web/src/styles/lucy.css`, `web/src/views/LucyHistory.tsx` |
| [ADR-356](adr-356-lucy-readable-transcript-and-conversational-control.md) | ADR-0302, ADR-0303, ADR-0308, ADR-0309 | `web/src/views/LucyTranscript.tsx`, `web/src/views/Lucy.tsx`, `web/src/styles/lucy.css` |
| [ADR-357](adr-357-lucy-composer-context-and-mobile-keyboard.md) | ADR-0307, ADR-0308, ADR-0329, ADR-0334 | `web/src/views/LucyComposer.tsx`, `web/src/views/Lucy.tsx`, `web/src/styles/lucy.css` |
| [ADR-358](adr-358-lucy-music-specific-activity-and-tool-cards.md) | ADR-0303, ADR-0304, ADR-0305, ADR-0332 | `web/src/views/LucyCards.tsx`, `web/src/views/LucyVisuals.tsx`, `web/src/styles/lucy.css` |
| [ADR-359](adr-359-lucy-proposal-status-constraints-and-readiness.md) | ADR-0317, ADR-0318, ADR-0319, ADR-0323, ADR-0328 | `web/src/views/LucyProposal.tsx`, `web/src/lucy/types.ts`, `web/src/views/LucyApprove.tsx` |
| [ADR-360](adr-360-lucy-song-seam-timeline-and-contextual-editing.md) | ADR-0320, ADR-0322, ADR-0324, ADR-0327, ADR-0306 | `web/src/views/LucySongs.tsx`, `web/src/views/LucyProposal.tsx`, `web/src/styles/lucy.css` |
| [ADR-361](adr-361-lucy-revision-comparison-critiques-and-undo.md) | ADR-0323, ADR-0324, ADR-0325, ADR-0306 | `web/src/views/LucyProposal.tsx`, `web/src/lucy/reducer.ts`, `web/src/views/LucySongs.tsx` |
| [ADR-362](adr-362-lucy-approval-commit-and-audio-focus-ux.md) | ADR-0326, ADR-0328, ADR-0300, ADR-0270 | `web/src/views/LucyApprove.tsx`, `web/src/views/Lucy.tsx`, `src/selecta/lucy/commit.py` |
| [ADR-363](adr-363-lucy-conversation-history-recovery-and-privacy-controls.md) | ADR-0302, ADR-0331, ADR-0334, ADR-0330 | `web/src/views/LucyHistory.tsx`, `web/src/views/LucyGate.tsx`, `web/src/views/LucySettings.tsx` |
| [ADR-364](adr-364-library-lucy-shared-visual-language-and-accessibility.md) | ADR-0200, ADR-0202, ADR-0233, ADR-0234, ADR-0275, ADR-0309, ADR-0336 | `web/src/styles/tokens.css`, `web/src/styles/operations.css`, `web/src/styles/lucy.css`, `web/src/ui/Icon.tsx` |
| [ADR-365](adr-365-library-lucy-evidence-parity-and-release-gates.md) | ADR-0239, ADR-0240, ADR-0271, ADR-0299, ADR-0336, ADR-0339 | `docs/adr/README.md`, `web/src/views/Library.test.tsx`, `web/src/views/Lucy.test.tsx`, `web/e2e/pages.e2e.ts` |

## Current capabilities not to reimplement by accident

- **Library:** URL query/filter/sort, debounced retrieval, exact recording ID and duplicate handling, list/card and density preferences, cursor paging/deep restore, page-aware refresh, server-backed readiness, action guards, selection of at most 200 **loaded** items, batch optimistic concurrency, metadata corrections and safe original files.
- **Make a Mix:** Quick Play, optional shaping, readiness gate, vibe cards, saving drafts, and explicit replacement behaviour.
- **Lucy:** optional provider path, conversation history, streaming typed tool activity, scoped exact-occurrence/seam questions, persistent unsent composer, immutable proposal/revision and critique, K−1 ready-only ledger, preflight approval, idempotent draft commit and explicit user-initiated playback.
- **Unaffected:** Now/Listen, My Mixes, precision editor/inspector, Studio, Requests, discovery, backup/export, existing single audio owner and server authoritative music data. Handoff links may be polished; those separate screens are **not** redesigned by LX.

## Mandatory implementation classification

Each LX task before source work is labelled **already met (needs independent LX proof)**, **measured redesign gap**, **specialist intentional exception**, **duplicate of older accepted owner**, or **rejected after study**. Source-present features do not automatically pass new UX outcomes; new requirements do not automatically declare old source missing. If existing ADR conflicts, owner reviews a dated decision rather than silently superseding it.

Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.
