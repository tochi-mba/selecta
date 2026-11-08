# ADR-356 — Lucy conversation readability, assistant explanations and direct user control

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy conversation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0302, ADR-0303, ADR-0308, ADR-0309; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyTranscript.tsx`; `web/src/views/Lucy.tsx`; `web/src/styles/lucy.css`.

## Context and source/evidence boundary

The transcript already supports safe rich text, message state, tool grouping and throttled assistive announcements. A redesign can improve rhythm and comprehension while retaining event truth. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Use a calm conversation style that clearly distinguishes user intent, Lucy's explanation, active analysis and actionable permissions. Avoid a wall of tool cards or decorative AI animation.

## User outcome and interaction contract

People can find the last real proposal change, tell who said what and recover interrupted requests without reading raw tool logs.

**Required negative cases:** Fast streaming, user scrolled up, 100+ messages, interrupted, cancelled, failed, mixed scripts, markdown-looking text and screen-reader announcements.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-356-01 — Define typographic rhythm.** **Acceptance:** Readable line length, paragraph spacing and clear author identification. **Required verification:** Long/short transcript screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-356-02 — Preserve safe rendering.** **Acceptance:** Text and emphasis never execute links, scripts or injected HTML. **Required verification:** Adversarial content and HTML-escape tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-356-03 — Separate conversation from events.** **Acceptance:** Plans and tool results are grouped under pertinent turn, not mistaken for dialogue. **Required verification:** Transcript sequence and reading-order fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-356-04 — Clarify message states.** **Acceptance:** Sending, sent, failed, cancelled, superseded and interrupted are visibly truthful. **Required verification:** State-specific DOM and aria fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-356-05 — Protect user scroll intent.** **Acceptance:** New messages count replaces forced autoscroll when reviewing older discussion. **Required verification:** Stream while scrolled-up E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-356-06 — Offer concise corrections.** **Acceptance:** Retry, branch and stop controls expose their consequences and avoid duplicate execution. **Required verification:** Retry/branch/stop interaction test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-356-07 — Control announcements.** **Acceptance:** Live regions announce meaningful milestones, not every stream token. **Required verification:** NVDA/VoiceOver cadence review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-356-08 — Validate response comprehension.** **Acceptance:** People can summarise what Lucy did and what remains unbuilt. **Required verification:** Uncoached explanation comprehension study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
