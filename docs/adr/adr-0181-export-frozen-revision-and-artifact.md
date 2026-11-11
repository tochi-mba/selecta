# ADR-0181 - Export: frozen mix revision, real preparation and finished artifact

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 7/7 Implemented, 0/7 In progress, 0/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Operate.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0157, ADR-0127, ADR-0108; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/ExportPanel.tsx; web/src/views/ExportJobs.tsx; web/src/views/Mix.tsx.

## Context and evidence boundary

The existing FLAC export model has frozen order, job state and completion handling. A creative export surface can meaningfully acknowledge finishing a set, but must not imply the file exists or the mix order is unchanged when it is not.

This is a **new, not-yet-implemented design and acceptance delta**, not proof that prior accepted code or source-level MI requirements are missing. No independent verification is claimed.

## Accepted decision

- Present a read-only snapshot of the exact frozen revision, separate from later editor changes.
- Visualize only actual prerequisite seam preparation and export stages.
- Distinguish pending, preparing, finished, failed, canceled and missing-file states.
- Make the real downloaded FLAC file the primary completion object when authoritative output exists.
- Keep export jobs discoverable in Activity/Workspace after drawer close or reload.
- Use subtle earned completion feedback without autoplay or fake percent progress.

## Visual, animation and microinteraction contract

- The completed artifact becomes visible only on confirmed available file.
- State graphics move on real status events and settle promptly.
- Reopening a job restores frozen sequence identity without replaying a fake generation.

## Alternatives and trade-offs

Preserve the existing restrained experience if an expressive version cannot prove comprehension, tactile confidence, accessibility and real playback performance. Diagrams do not claim unverified musical precision or quality. Never fabricate beat, lyric, wave, cover, render status, progress or success. Supply static/keyboard alternatives and respect intentional silence/Pause.

## Implementation checklist - 7/7 Implemented, 0/7 Verified

1. **CI-0181-01 - Design frozen revision visual object.** **Acceptance:** Export identity remains distinct from current mutable mix. **Required verification:** Concurrent edit and export fixture. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "does not carry an in-flight export across a change of editing scope", "shows the exact ordered source songs before creating a file" (vitest, passed 2026-11-10); web/e2e/integration.e2e.ts "editing a draft during export keeps the job pinned to its original revision" (Playwright, passed 2026-11-10).
2. **CI-0181-02 - Show prerequisite transition states.** **Acceptance:** Progress derived from real seam readiness and job stages only. **Required verification:** Queued/ready/failed render tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "says exactly which mix, and what it’s waiting on", "blocks export until the invalid transition is fixed", "says so if what’s left can’t be made" (vitest, passed 2026-11-10).
3. **CI-0181-03 - Specify full export failure taxonomy.** **Acceptance:** Canceled, expired and unavailable file distinguished. **Required verification:** Server error and missing file fixtures. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "tells cancelled, expired, failed and interrupted apart, and each can be made again" (vitest, passed 2026-11-10).
4. **CI-0181-04 - Confirm actual completed FLAC presentation.** **Acceptance:** Filename/duration/download appear only after true completion. **Required verification:** Decoding and revision/track-order comparison. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "shows the file name, length and download only once the file really exists"; web/src/views/Mix.test.tsx "only offers the file once it really exists" (vitest, passed 2026-11-10); web/e2e/finishing.e2e.ts "a saved file has the songs of the mix at the moment it was saved, in that order, whatever happens next" (Playwright, passed 2026-11-10).
5. **CI-0181-05 - Preserve job discovery and reload.** **Acceptance:** Closing UI never erases or restarts existing job. **Required verification:** Activity/Workspace and navigation tests. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "finds the same job again after it is closed and reopened, without asking for a new one" (vitest, passed 2026-11-10).
6. **CI-0181-06 - Design accessible completion feedback.** **Acceptance:** No flashing or fake quality claims; immediate keyboard download. **Required verification:** Reduced-motion/AT review. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx the download is a plain keyboard-reachable link with the file name, no quality claim (vitest, passed 2026-11-10); web/e2e/finishing.e2e.ts reduced motion (Playwright, passed 2026-11-10); AT review still needs a person.
7. **CI-0181-07 - Verify original media and exact output.** **Acceptance:** No original file mutation and artifact matches frozen revision. **Required verification:** Real audio gap/overlap and disk-integrity audit. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/finishing.e2e.ts "a saved file has the songs of the mix at the moment it was saved, in that order, whatever happens next" (Playwright, passed 2026-11-10); real-audio gap and disk-integrity audit still needs a person.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0157, ADR-0127, ADR-0108; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Accepted; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
