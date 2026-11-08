# ADR-0357 — Lucy prompt composer, scoped questions and mobile keyboard safety

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy conversation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0307, ADR-0308, ADR-0329, ADR-0334; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyComposer.tsx`; `web/src/views/Lucy.tsx`; `web/src/styles/lucy.css`.

## Context and source/evidence boundary

Lucy already has a sticky autosizing composer, per-conversation unsent text, stop action and optional voice dictation that only fills the box. Mobile keyboard and player occlusion need actual device validation. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Make the composer the reliable command point: readable multiline text, safe scoped song/seam context, explicit Send/Stop, correct IME behaviour and zero overlap with audio chrome.

## User outcome and interaction contract

Users can refine an exact musical object, interrupt work or keep an unsent thought without accidental send, playback or lost text.

**Required negative cases:** iOS/Android keyboard, landscape, hardware Enter, composition IME, PWA sleep, active player, tab switch, offline and stale proposal.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0357-01 — Make composer clearly primary.** **Acceptance:** Input affords musical requests and context with minimal instructions. **Required verification:** First-message usability test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0357-02 — Keep exact scope visible.** **Acceptance:** Selected occurrence or seam is labelled and removable without silently switching target. **Required verification:** Duplicate song/scoped prompt E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0357-03 — Protect Send semantics.** **Acceptance:** Enter/Shift+Enter/IME behaviour is predictable and does not accidentally submit composition. **Required verification:** Keyboard and CJK composition tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0357-04 — Retain unsent drafts per thread.** **Acceptance:** Input survives reload and conversation switching with no cross-thread leakage. **Required verification:** PWA resume and multi-thread fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0357-05 — Expose running and Stop safely.** **Acceptance:** Stop is visible only when relevant; sending replacement intent is explained. **Required verification:** Live run and cancel test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0357-06 — Arbitrate keyboard and player.** **Acceptance:** Composer and buttons stay reachable above software keyboard and persistent audio controls. **Required verification:** Physical iOS/Android viewport occlusion test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0357-07 — Keep voice optional and inert.** **Acceptance:** Dictation fills text for edit, never auto-sends or starts audio. **Required verification:** Voice availability and playback focus fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0357-08 — Validate touch and AT parity.** **Acceptance:** Complete Ask → Edit → Send → Stop task works at 320px and with screen readers. **Required verification:** One-handed + TalkBack/VoiceOver study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
