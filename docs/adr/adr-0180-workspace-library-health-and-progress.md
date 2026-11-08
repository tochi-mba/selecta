# ADR-0180 — Workspace: library health, truthful processing and operational calm

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Operate.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0156, ADR-0128, ADR-0107; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Workshop.tsx; web/src/views/WorkshopPanels.tsx; web/src/views/ExportJobs.tsx.

## Context and evidence boundary

Workspace already reports processing, sources, storage and diagnostics. It should remain calmer than Listen or Studio, answering whether the library is usable and which genuine issue needs intervention, rather than becoming a visual music performance or an intimidating job console.

This is a **new, not-yet-implemented design and acceptance delta**, not proof that prior accepted code or source-level MI requirements are missing. No independent verification is claimed.

## Proposed decision

- Lead with real readiness and the next useful action; keep secondary counts readable.
- Separate folder scan, audio analysis, timed lyrics, seam preparation and export as different stages.
- Explain when background analysis yields to current mix rendering without declaring it broken.
- Distinguish cache budget from original music files in every storage treatment.
- Make Diagnostics optional and specific failure recovery clear.
- Never add invented progress percentages, meaningless visualizers or unsolicited modal alerts.

## Visual, animation and microinteraction contract

- Counts update on real events; no fake smooth progress while an operation is opaque.
- Background jobs may quietly change state without stealing listening attention.
- Error emphasis remains stable until action or resolution, not repeated pulsing.

## Alternatives and trade-offs

Preserve the existing restrained experience if an expressive version cannot prove comprehension, tactile confidence, accessibility and real playback performance. Diagrams do not claim unverified musical precision or quality. Never fabricate beat, lyric, wave, cover, render status, progress or success. Supply static/keyboard alternatives and respect intentional silence/Pause.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0180-01 — Reframe overview around library health.** **Acceptance:** User sees usable/blocked state and one most relevant next action. **Required verification:** Glance review and actual counts audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0180-02 — Distinguish pipeline status ownership.** **Acceptance:** Scan, lyrics, analysis, seams and export cannot be confused. **Required verification:** Mixed job and readiness fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0180-03 — Explain resource priority and ETA.** **Acceptance:** Deferred analysis during mix render is not shown as stuck. **Required verification:** Priority queue and estimate scenarios. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0180-04 — Design storage safety hierarchy.** **Acceptance:** Cache and original music distinct in labels and graphics. **Required verification:** Storage limit, cleanup and source-file tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0180-05 — Improve source and diagnostic recovery.** **Acceptance:** Every major failure has context-specific safe action. **Required verification:** Missing drive, no permission and offline tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0180-06 — Enforce calm motion and focused alerts.** **Acceptance:** No background task interrupts current playback or active control. **Required verification:** Many-job/reduced-motion listening review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0180-07 — Validate stale and uncertain status.** **Acceptance:** Out-of-date values marked and refreshed without false success. **Required verification:** Server disconnect and retry tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0156, ADR-0128, ADR-0107; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Proposed; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
