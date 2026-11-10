# Selecta - experience-first implementation checklist (105 EX tasks)

**Historical baseline:** Created 2026-11-07 at `6638ec2313ce53843adfaf363306f8e79c4c8c7e` as a docs-only proposal. Implementation PR #30 later merged as `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7`; the 105 task-specific acceptance and independent-verification states remain unreconciled/open in this ledger. A checked box means independently **Verified**, never only coded.

**Lifecycle:** Not started → In progress (named PR) → Implemented (merged code/tests); Verified No → Yes after applicable human, visual, keyboard/AT, real audio, performance and data/revision evidence.

## [ADR-114 - Experience-first product charter and measurable quality](adr-0114-experience-charter-and-measurable-quality.md)

**Phase:** Baseline · **Priority:** P0 · **Decision:** Accepted · **Implementation:** In progress (2026-11-10: 2 Implemented, 1 In progress, 2 Not started) · **Verified:** 0/5.

- [ ] **EX-0114-01 - Inventory end-to-end user journeys.** **Implementation: Implemented (2026-11-10); Verified: No; PR/SHA: -; evidence: listener, creator, expert and operator journeys with first action, completion, error and recovery in `docs/adr/selecta-experience-acceptance.md` (Journeys and recovery), backed by route/control inspection in `docs/adr/mp-0272-surface-inventory.json` (guarded by `web/src/shell/mpSurfaceInventory.test.ts`, passed 2026-11-10); owner: Unassigned; Needs a person: uncoached baseline task sessions with named participants, numerator/denominator and exact SHA** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0114-02 - Reconcile current main against prior programmes.** **Implementation: In progress (2026-11-10); Verified: No; PR/SHA: -; evidence: programme-level separation in `docs/adr/selecta-experience-status-reconciliation.md` and `docs/adr/implementation-checklist-audit.md`; the per-task S4 crosswalk is being written task by task in `docs/adr/selecta-4-implementation-checklist.md`; owner: Unassigned; Needs a person: owner review of the finished S4/EX crosswalk against one exact SHA** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0114-03 - Set measurable quality criteria.** **Implementation: Implemented (2026-11-10); Verified: No; PR/SHA: -; evidence: success, confidence, error and recovery metrics with explicit denominators and targets in `docs/adr/selecta-experience-acceptance.md` (Measurable quality protocol) and `docs/adr/selecta-experience-release-gates.md`; owner: Unassigned; Needs a person: research protocol review and sign-off by the owner or a named researcher** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0114-04 - Define every feature's preservation owner.** **Implementation: In progress (2026-11-10); Verified: No; PR/SHA: -; evidence: capability-to-owner map in `docs/adr/selecta-experience-feature-parity.md` and `docs/adr/selecta-experience-acceptance.md` (Preserved capability ownership); every route, tab, overlay and flagged surface inventoried in `docs/adr/mp-0272-surface-inventory.json` (`web/src/shell/mpSurfaceInventory.test.ts` passed 2026-11-10); persisted preferences and API side effects are not yet in one old/new map; owner: Unassigned; Needs a person: owner sign-off of the completed old/new feature map** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0114-05 - Gate small reversible implementation slices.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned; Needs a person: each implementing PR must name an owner, its verification and rollback, and the owner makes the final release decision; this is release-process evidence no agent can supply** Acceptance and required verification are specified in the linked ADR.

## [ADR-115 - Intent-led navigation, route continuity and entry context](adr-0115-intent-led-navigation-and-route-continuity.md)

**Phase:** Structure · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0115-01 - Evaluate navigation terminology.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0115-02 - Map every route and alias.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0115-03 - Specify contextual entry states.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0115-04 - Design narrow and keyboard navigation.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0115-05 - Verify shared audio across navigation.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-116 - Listening-first player, Up Next and optional DJ controls](adr-0116-listening-first-player-and-optional-controls.md)

**Phase:** Listener · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0116-01 - Prototype default Listen hierarchy.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0116-02 - Provide optional DJ-controls parity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0116-03 - Design truthful transition cues.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0116-04 - Validate Lyrics and Stage behavior.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0116-05 - Prove single-owner transport.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-117 - Three-stage mix creation: choose, shape and commit](adr-0117-three-stage-mix-creation-journey.md)

**Phase:** Make a Mix · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0117-01 - Prototype fast Play vs optional shape.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0117-02 - Map all existing configuration.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0117-03 - Specify accurate curve display.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0117-04 - Unify Play/Edit/Save consequences.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0117-05 - Harden pending/failed generation.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-118 - Recommendations: clear music-first cards and authentic previews](adr-0118-recommendation-cards-and-authentic-preview.md)

**Phase:** Make a Mix · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0118-01 - Create feature and category card variants.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0118-02 - Check secondary action parity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0118-03 - Handle partial/unknown metadata.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0118-04 - Document preview feasibility gate.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0118-05 - Measure choice confidence.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-119 - My Mixes: distinct current, draft and render scopes](adr-0119-my-mixes-drafts-and-render-line.md)

**Phase:** Creator · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0119-01 - Design current/draft/render hierarchy.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0119-02 - Retain complete draft control set.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0119-03 - Preserve scope on risky actions.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0119-04 - Clarify render readiness and storage.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0119-05 - Validate navigation and recovery.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-120 - Arrangement editor: distinct song and transition objects](adr-0120-song-transition-editor-workstation.md)

**Phase:** Creator · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0120-01 - Prototype distinct song/seam selection.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0120-02 - Specify responsive inspector behavior.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0120-03 - Maintain all existing editor commands.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0120-04 - Guard identity and concurrency.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0120-05 - Verify scale and non-drag alternatives.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-121 - Transition Inspector: intent, rendered reality and audition](adr-0121-transition-inspector-audition-and-truth.md)

**Phase:** Creator · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Implemented (5/5) · **Verified:** 3/5.

- [ ] **EX-0121-01 - Design human-first status summary.** **Implementation: Implemented; Verified: No; PR/SHA: uncommitted on feat/finish-checklists; evidence: 2026-11-10 `web/src/ui/seam.ts` `seamLayers` and the Listen tab `SeamLayersView` in `web/src/views/SeamInspector.tsx` keep You chose / In progress / Made so far / You'd hear apart; `web/src/views/ex0121SeamInspector.test.tsx` "EX-0121-01" cases (`pnpm exec vitest run src/views/ex0121SeamInspector.test.tsx`, 15/15 passed); owner: Unassigned.** Needs a person: real-audio listening and loading-state comprehension check that listeners read requested vs rendered vs heard correctly.
- [x] **EX-0121-02 - Map all detailed controls.** **Implementation: Implemented; Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: `web/src/views/ex0121SeamInspector.test.tsx` "EX-0121-02" (every server move shown, unavailable ones disabled with their reasons, tempo/key help, bar chips, every exit/entry cue option, all choices reached by Tab in reading order) plus `web/src/views/ufSeamInspector.test.tsx` tab arrow/Home/End keys; `pnpm exec vitest run src/views/ex0121SeamInspector.test.tsx src/views/ufSeamInspector.test.tsx` passed 2026-11-10; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0121-03 - Specify failure and fallback behaviors.** **Implementation: Implemented; Verified: No; PR/SHA: uncommitted on feat/finish-checklists; evidence: 2026-11-10 `web/src/views/ex0121SeamInspector.test.tsx` "EX-0121-03" injects none/queued/rendering/failed states: no audio element, no rating, only `none` offers Render it, Details reports nothing; only a ready seam gets `/api/seams/<key>/preview` (15/15 passed); owner: Unassigned.** Browser fault-injection E2E still to run.
- [x] **EX-0121-04 - Feasibility-check previous/new audition.** **Implementation: Implemented (decision); Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: decision recorded in `docs/adr/adr-0121-transition-inspector-audition-and-truth.md` (before/after A/B declined: the mix only carries the current render key, `GET /api/seams/{key}/preview` in `src/selecta/routes/edit.py` serves one key, no previous-key history exists without a new API); single audition is bound to `state.key`; focus collisions `web/src/audio/focus.test.tsx` (12 cases) and `ex0121SeamInspector.test.tsx` preview-key case passed 2026-11-10; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.
- [x] **EX-0121-05 - Guard ratings and mutation scope.** **Implementation: Implemented; Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: `web/src/views/ex0121SeamInspector.test.tsx` "EX-0121-05" (a rating still in flight when the seam re-renders posts only to the heard key and is not shown on the new render, whose preview switches key; an edit carries `x-mix-order` and a 409 after a reorder renders nothing and restores the server choice) plus `web/src/views/Mix.test.tsx` "rating a transition" and "transition edit intent"; `pnpm exec vitest run src/views/ex0121SeamInspector.test.tsx src/views/Mix.test.tsx` passed 2026-11-10; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.

## [ADR-122 - Stem Studio: approachable Shape controls and lossless Detailed mode](adr-0122-studio-shape-and-detailed-editing.md)

**Phase:** Expert · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Implemented (5/5) · **Verified:** 3/5.

- [x] **EX-0122-01 - Prove Shape-to-grid mapping.** **Implementation: Implemented; Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: Shape is a lossless view (fill or clear one whole lane) over the exact grid in `web/src/views/Studio.tsx` `StudioShapeEditor`; `web/src/views/ex0122StudioParity.test.tsx` round-trips grid, list and Shape at 8, 32 and 64 cells with an irregular pattern and no cell changed, and a guided lane edit changes only that lane; `pnpm exec vitest run src/views/ex0122StudioParity.test.tsx` 12/12 passed; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0122-02 - Prototype guided arrangement controls.** **Implementation: Implemented; Verified: No; PR/SHA: uncommitted on feat/finish-checklists; evidence: guided Shape controls (Use throughout / Leave out per voice, drums, bass, melody) in `web/src/views/Studio.tsx`, covered by `web/src/views/Studio.test.tsx` and `ex0122StudioParity.test.tsx` (2026-11-10); owner: Unassigned.** Needs a person: uncoached creative task showing beginners understand the vocals/drums/bass/melody choices.
- [x] **EX-0122-03 - Preserve Detailed function set.** **Implementation: Implemented; Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: 8/32/64-cell parity suite `web/src/views/ex0122StudioParity.test.tsx` (all 8 lanes and every cell, every lane solo, ready-made shapes, Start again, recovery) with AI assist and fine-tune in `web/src/views/Studio.test.tsx` ("lets Selecta arrange it", "fine tunes your own grid"); `pnpm exec vitest run src/views/ex0122StudioParity.test.tsx src/views/Studio.test.tsx` passed 2026-11-10; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.
- [x] **EX-0122-04 - Specify unsaved and revision behavior.** **Implementation: Implemented; Verified: Yes (automated, 2026-11-10); PR/SHA: uncommitted on feat/finish-checklists; evidence: `web/src/views/ex0122StudioParity.test.tsx` "unsaved work survives every mode switch and a reopen, and nothing is applied" (8/32/64); stale server: `web/src/views/Studio.test.tsx` "a mix that moved on refuses the shape" and `web/src/views/StudioSafety.test.tsx` "an Apply into a pair that changed sends nothing"; Undo: `Studio.test.tsx` "what was there can be put back" and "lets the user restore the previous shape"; passed 2026-11-10; owner: Claude agent.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0122-05 - Verify keyboard, AT and audible outcome.** **Implementation: Implemented; Verified: No; PR/SHA: uncommitted on feat/finish-checklists; evidence: keyboard grid editing `web/src/views/Studio.test.tsx` "is one tab stop, moves with the arrow keys, and Space turns a square on or off" passed 2026-11-10; owner: Unassigned.** Needs a person: NVDA session, touch device check and real-audio listening that the edited arrangement sounds as shown.

## [ADR-123 - Library: music-first browsing and contextual actions](adr-0123-music-library-browse-and-contextual-actions.md)

**Phase:** Collection · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0123-01 - Design song row information hierarchy.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0123-02 - Crosswalk all existing row actions.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0123-03 - Preserve URL and deep paging.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0123-04 - Polish song details and corrections.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0123-05 - Measure 20k responsiveness.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-124 - Requests: truthful lifecycle and explicit bridge consent](adr-0124-requests-lifecycle-and-bridge-consent.md)

**Phase:** Collection · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0124-01 - Define canonical user-facing lifecycle.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0124-02 - Redesign pending requests panel.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0124-03 - Specify bridge consent presentation.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0124-04 - Verify atomic/duplicate safeguards.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0124-05 - Test audible handover and preview focus.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-125 - Musical discovery as clear word and harmonic audition flows](adr-0125-musical-discovery-audition-workflows.md)

**Phase:** Collection · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0125-01 - Redesign word pair context.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0125-02 - Design four-stage harmonic audition.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0125-03 - Maintain preview focus.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0125-04 - Guard feedback binding.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0125-05 - Verify safe add-to-mix flow.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-126 - Browser-first onboarding and readiness, without desktop packaging](adr-0126-browser-first-onboarding-and-readiness.md)

**Phase:** Listener · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0126-01 - Improve local path guidance.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0126-02 - Clarify readiness and first mix.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0126-03 - Specify failure/recovery states.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0126-04 - Audit current network/privacy copy.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0126-05 - Enforce excluded platform scope.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-127 - Export: truthful frozen revision, job lifecycle and file delivery](adr-0127-export-job-and-frozen-revision.md)

**Phase:** Operations · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0127-01 - Specify export source identity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0127-02 - Design durable job lifecycle.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0127-03 - Handle blocked/failed/stale jobs.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0127-04 - Verify final FLAC identity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0127-05 - Keep accessible export parity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-128 - Workspace as a calm, actionable operations center](adr-0128-calm-workspace-and-operations.md)

**Phase:** Operations · **Priority:** P2 · **Decision:** Accepted · **Implementation:** 5/5 Implemented (2026-11-10) · **Verified:** 1/5.

- [ ] **EX-0128-01 - Prototype issue-first overview.** **Implementation: Implemented (2026-11-10); Verified: No; PR/SHA: -; evidence: `NeedsYou` in `web/src/views/WorkshopPanels.tsx` puts storage, failed transitions, failed songs and paused analysis first, each with its fix link; `web/src/views/Workshop.test.tsx` and `web/src/views/ex-0128-job-truth.test.tsx` pass (2026-11-10); owner: Unassigned.** Needs a person: an uncoached recovery session where a user finds one operational blocker and its fix.
- [ ] **EX-0128-02 - Preserve all job/source/storage operations.** **Implementation: Implemented; Verified: No; PR/SHA: -; evidence: watch/stop-watching, the storage budget slider and diagnostics are exercised in `web/src/views/Workshop.test.tsx` (12 passed 2026-11-10); owner: Unassigned.** Open: no single action-parity/API-contract test yet proves scan and pause/resume alongside the others.
- [x] **EX-0128-03 - Audit truth of job state labels.** **Implementation: Implemented; Verified: Yes (automated fixtures, 2026-11-10); PR/SHA: -; evidence: `web/src/views/ex-0128-job-truth.test.tsx` (queued, paused and failed have distinct words and status kinds; the storage block now reads 'Blocked', never 'Paused'; a malformed or 503 refresh keeps the last answer and says it may be out of date) and `web/src/views/Workshop.test.tsx`, 15 passed with `pnpm exec vitest run` on 2026-11-10; source `web/src/views/WorkshopPanels.tsx`, `web/src/state/jobs.ts`; owner: Unassigned.**
- [ ] **EX-0128-04 - Specify privacy-safe diagnostics.** **Implementation: Implemented; Verified: No; PR/SHA: -; evidence: `web/src/views/Workshop.test.tsx` 'show diagnostics with nothing personal in them, ready to copy' passes (2026-11-10); owner: Unassigned.** Needs a person: the manual privacy and network review the ADR names (no local path leaves the machine).
- [ ] **EX-0128-05 - Verify accessible layout.** **Implementation: Implemented; Verified: No; PR/SHA: -; evidence: `web/e2e/mp-0293-workspace-operations.e2e.ts` covers widths and keyboard repair (several of its tests failed on a loaded shared machine on 2026-11-10, not rerun); owner: Unassigned.** Needs a person: both themes at 400% zoom with NVDA.

## [ADR-129 - Neutral blind A/B listening study with protocol integrity](adr-0129-blind-study-neutral-audio.md)

**Phase:** Operations · **Priority:** P1 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0129-01 - Audit all method leakage.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0129-02 - Design balanced A/B interface.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0129-03 - Separate listening, grading and save.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0129-04 - Preserve once-only identity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0129-05 - Verify with real blind sessions.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-130 - Warm editorial design language, independent themes and CSS ownership](adr-0130-brand-tokens-and-css-ownership.md)

**Phase:** Foundation · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0130-01 - Approve semantic color and type contracts.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0130-02 - Design song-focused compositions.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0130-03 - Audit and assign CSS ownership.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0130-04 - Specify all interactive component states.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0130-05 - Test real-content resilience.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-131 - Shared component contracts, honest async states and scoped recovery](adr-0131-component-states-and-scoped-recovery.md)

**Phase:** Foundation · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0131-01 - Write interaction state matrix.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0131-02 - Validate overlay and focus behavior.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0131-03 - Protect async consistency.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0131-04 - Improve loading/empty/error feedback.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0131-05 - Preserve scoped Undo and recovery.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-132 - Responsive compositions, WCAG 2.2 AA and purposeful motion](adr-0132-responsive-accessibility-and-purposeful-motion.md)

**Phase:** Quality · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0132-01 - Review mobile/zoom layouts.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0132-02 - Ensure non-drag equivalents.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0132-03 - Audit composite ARIA behavior.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0132-04 - Specify reduced-motion fidelity.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0132-05 - Conduct named human AT acceptance.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-133 - Uncoached user research, real performance and release evidence](adr-0133-user-research-performance-and-release-evidence.md)

**Phase:** Quality · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0133-01 - Define and run baseline UX tasks.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0133-02 - Establish approved visual baselines.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0133-03 - Benchmark meaningful scale.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0133-04 - Verify real audio and assistive access.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0133-05 - Conduct exact-head release and rollback.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## [ADR-134 - Web-first product boundary for a possible future SaaS](adr-0134-web-first-future-saas-boundary.md)

**Phase:** Scope · **Priority:** P0 · **Decision:** Accepted · **Implementation:** Not started (0/5) · **Verified:** 0/5.

- [ ] **EX-0134-01 - Record current platform truth.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0134-02 - Review proposed UX for desktop coupling.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0134-03 - Preserve folder setup until separate decision.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0134-04 - Audit excluded implementation scope.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.
- [ ] **EX-0134-05 - Define future SaaS decision gate.** **Implementation: Not started; Verified: No; PR/SHA: -; evidence: -; owner: Unassigned.** Acceptance and required verification are specified in the linked ADR.

## Maintenance and release discipline

Update each ADR, checklist, [per-task evidence](selecta-experience-evidence.md) and [roadmap](selecta-experience-roadmap.md) together when code, tests and human acceptance actually establish a new state. Never mass-check tasks after merging this documentation PR. Preserve older [S4 tracker](selecta-4-implementation-checklist.md), [S31](selecta-3-1-implementation-checklist.md), [S3](selecta-3-implementation-checklist.md), T and P task identities as distinct historical records.
