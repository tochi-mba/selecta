# Selecta — Library + Lucy experience redesign roadmap, ADR-0340–0365

**Status:** 26 Proposed ADRs (0340–0365); 208 LX tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owner unassigned. Baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be` (2026-11-08). Documentation only.

## Scope / non-scope

A deliberate **full-UI/UX redesign proposal** exclusively for Library, Song Details inside Library, Make a Mix entry, and the optional Lucy creation workspace. User has authorised wholesale visual redesign inside these areas. This does **not** authorise a new audio engine, editor/Studio redesign, global navigation rewrite, SaaS, data upload or unconsented assistant actions. Scope is visual design, user interaction, source-safe filtering where separately approved, comprehension, responsiveness, accessibility and release proof.

The current app already ships Library search/sort/filter, list/card, stable-ID batching, readiness and corrections; Make a Mix Quick Play and vibe cards; Lucy chat, durable history, scoped questions, streaming steps, exact proposals, ready-only checks and safe commits. New tasks must reconcile against actual source and decide whether they require a source change, a measured polish, or no change. All 208 LX tasks start unimplemented and unverified **as new acceptance tasks**, not as claims that corresponding old capabilities are missing.

## Phases and numbered ADRs

### Library foundation

- [ADR-340](adr-340-library-experience-charter-and-information-architecture.md) — **P0**: Library experience charter, collection-first information architecture and task hierarchy. 8 LX items; all Not started.

### Library hierarchy

- [ADR-341](adr-341-library-header-counts-and-collection-overview.md) — **P0**: Library header, truthful collection overview and readiness-oriented summary. 8 LX items; all Not started.

### Library retrieval

- [ADR-342](adr-342-library-search-and-exact-recording-retrieval.md) — **P0**: Library search field, result explanation and exact-recording retrieval. 8 LX items; all Not started.
- [ADR-343](adr-343-library-filters-sorting-and-musical-query-depth.md) — **P0**: Library filters, sorting and optional musical-query depth. 8 LX items; all Not started.

### Library presentation

- [ADR-344](adr-344-library-list-rows-and-dense-scanning.md) — **P0**: Library list-row geometry, metadata hierarchy and dense scanning. 8 LX items; all Not started.
- [ADR-345](adr-345-library-collection-card-view-and-meaningful-artwork.md) — **P1**: Library collection cards, meaningful artwork and browsing mode. 8 LX items; all Not started.

### Library interaction

- [ADR-346](adr-346-library-contextual-track-action-hierarchy.md) — **P0**: Library per-recording action hierarchy and contextual disclosure. 8 LX items; all Not started.
- [ADR-347](adr-347-library-bulk-selection-scope-and-feedback.md) — **P0**: Library explicit selection mode, exact scope and batch feedback. 8 LX items; all Not started.

### Library detail

- [ADR-348](adr-348-library-song-inspector-and-metadata-provenance.md) — **P1**: Library song inspector, musical metadata and measurement provenance. 8 LX items; all Not started.
- [ADR-349](adr-349-library-readiness-corrections-and-guarded-management.md) — **P0**: Library readiness explanations, correction safety and recording management. 8 LX items; all Not started.

### Library robustness

- [ADR-350](adr-350-library-large-scale-paging-scroll-and-performance.md) — **P0**: Library 20,000-song paging, scroll restoration and input performance. 8 LX items; all Not started.
- [ADR-352](adr-352-library-empty-loading-stale-and-error-experiences.md) — **P1**: Library empty, loading, stale, offline and recovery state system. 8 LX items; all Not started.

### Library responsive

- [ADR-351](adr-351-library-mobile-tablet-zoom-and-accessibility.md) — **P0**: Library mobile/tablet presentation, high zoom and accessible retrieval. 8 LX items; all Not started.

### Make a Mix entry

- [ADR-353](adr-353-make-a-mix-quick-play-and-lucy-entry-architecture.md) — **P0**: Make a Mix front door: Quick Play and Create with Lucy as clear choices. 8 LX items; all Not started.
- [ADR-354](adr-354-make-a-mix-moods-discovery-and-creation-intent.md) — **P1**: Make a Mix mood discovery, preset choices and natural-language handoff. 8 LX items; all Not started.

### Lucy workspace

- [ADR-355](adr-355-lucy-desktop-proposal-conversation-workspace.md) — **P0**: Lucy desktop workspace: conversation, current proposal and optional history. 8 LX items; all Not started.

### Lucy conversation

- [ADR-356](adr-356-lucy-readable-transcript-and-conversational-control.md) — **P0**: Lucy conversation readability, assistant explanations and direct user control. 8 LX items; all Not started.
- [ADR-357](adr-357-lucy-composer-context-and-mobile-keyboard.md) — **P0**: Lucy prompt composer, scoped questions and mobile keyboard safety. 8 LX items; all Not started.

### Lucy activity

- [ADR-358](adr-358-lucy-music-specific-activity-and-tool-cards.md) — **P0**: Lucy visible activity, genuine progress and music-specific tool details. 8 LX items; all Not started.

### Lucy proposal

- [ADR-359](adr-359-lucy-proposal-status-constraints-and-readiness.md) — **P0**: Lucy current proposal summary, constraints and verified readiness. 8 LX items; all Not started.
- [ADR-360](adr-360-lucy-song-seam-timeline-and-contextual-editing.md) — **P0**: Lucy exact song and transition timeline with contextual editing. 8 LX items; all Not started.
- [ADR-361](adr-361-lucy-revision-comparison-critiques-and-undo.md) — **P1**: Lucy proposal revisions, musical diff, critique and safe restoration. 8 LX items; all Not started.

### Lucy approval

- [ADR-362](adr-362-lucy-approval-commit-and-audio-focus-ux.md) — **P0**: Lucy approval, draft commit, save-and-play confirmation and audio ownership. 8 LX items; all Not started.

### Lucy recovery

- [ADR-363](adr-363-lucy-conversation-history-recovery-and-privacy-controls.md) — **P1**: Lucy history, recovery, optional provider notices and conversation continuity. 8 LX items; all Not started.

### Shared design

- [ADR-364](adr-364-library-lucy-shared-visual-language-and-accessibility.md) — **P0**: Library + Lucy shared art direction, theme, motion and accessibility contract. 8 LX items; all Not started.

### Verification

- [ADR-365](adr-365-library-lucy-evidence-parity-and-release-gates.md) — **P0**: Library + Lucy redesign governance, evidence parity and independent GO/NO-GO. 8 LX items; all Not started.

## Implementation sequence and dependencies

1. **P0 research and parity:** Capture Library/Make a Mix/Lucy actual screenshots and task baselines, reconcile source and historical owners (ADR-0340, ADR-0365). Prototype before modifying production UI.
2. **Library first:** Header, search and filters → list geometry and contextual actions → selection and metadata safety → 20k, mobile and failure states; collection cards can iterate after core retrieval passes.
3. **Creation entry:** Preserve Quick Play while presenting Create with Lucy as a first-class optional path. Mood cards and prefill preserve exact intent; no auto-send.
4. **Lucy workstation:** Conversation/layout → composer and tool activity → exact proposal/seam/ready-only → revision and exact approval → history/recovery and mobile/AT parity.
5. **Independent GO/NO-GO:** Run matched-state visual, 20k data, keyboard/AT, real-player, ready-only audio and user comprehension gates. Record actual implementing SHAs and evidence before advancing statuses.

## Target acceptance (proposed, not measured)

- At least **90% uncoached task success** in separately reported novice and expert Library/Make a Mix/Lucy critical journeys; record sample sizes, failures and confidence caveats. Targets must be agreed before research.
- Understandability: participants distinguish **analysed song**, **mix-ready song**, **proposed mix**, **saved draft**, **fully ready transitions** and **playing**, and predict Save draft versus Save and play correctly.
- Responsive: 320px to 3840px, short landscape, 200/400% zoom, keyboard, mouse, touch, NVDA/VoiceOver/TalkBack, Light/Dark/System, forced colours, Still/reduced motion.
- Performance: representative 20k-song fixtures and named-device budgets; use relevant Core Web Vitals (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) as **reference lab targets**, not claims of measured field percentiles.
- Audio and data: no unintended Pause/play/replacement; no false ready-only guarantee or cache-historical confusion; exact occurrence/revision and original audio preserved.

## Research and established precedents

Specialist research already inventoried in [Selecta's UI/UX polish notes](../research/ui-ux-polish.md). Relevant external standards: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [ARIA tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [Microsoft human-AI interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/), [Mixxx user interface manual](https://manual.mixxx.org/2.5/en/chapters/user_interface.html) and [web.dev Web Vitals](https://web.dev/articles/vitals). Spotify, Mixxx and rekordbox are inspirational interface precedents, not Selecta-specific experimental proof or mandates to copy their UI. No unobserved user preference is presented as established research.

## Status governance

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)

Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.
