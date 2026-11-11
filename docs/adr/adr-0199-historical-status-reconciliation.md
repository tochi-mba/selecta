# ADR-0199 - Head baseline and historical ADR implementation reconciliation

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 1/8 In progress, 1/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0184/0164/0113; no historical status is changed.
- **Existing source touchpoints:** docs/adr/README.md; docs/acceptance.md; web/e2e/visual.e2e.ts.

## Context and evidence boundary

Previous programme implementation counts are historic snapshots at different SHAs. New tasks must represent genuinely new acceptance deltas; existing code remains a reuse candidate, not automatically completed or missing. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Previous programme implementation counts are historic snapshots at different SHAs. New tasks must represent genuinely new acceptance deltas; existing code remains a reuse candidate, not automatically completed or missing. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Do not erase prior evidence, confuse screenshot candidates with approval, or claim docs merge equals implementation. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0199-01 - Pin baseline commit and tree.** **Acceptance:** All new tasks reference exact parent SHA. **Required verification:** GitHub tree comparison. **Implementation:** Implemented; baseline c3715b14a70a0a9005e9fbc08d44576f3eac3c15 resolves to a commit and is an ancestor of feat/finish-checklists; the checklist header and every ADR-0198 to ADR-0214 cite it; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `git cat-file -t c3715b14` = commit and `git merge-base --is-ancestor c3715b14 HEAD` true on 2026-11-10; recorded in `docs/adr/adr-0199-historical-status-reconciliation.md` Reconciliation record.
2. **SF-0199-02 - Inventory visual and interactive states.** **Acceptance:** Every core scene including errors captured. **Required verification:** Screenshot and state matrix. **Implementation:** In progress; the state matrix exists and is machine-checked (`web/src/shell/mpSurfaceInventory.test.ts`, passed 2026-11-10); a full screenshot capture run (`web/e2e/mp-baseline.mp.ts`, `web/e2e/paired-theme.e2e.ts`) was not done in this session; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** -; **Evidence:** -.
3. **SF-0199-03 - Map CI/MI and historic overlap.** **Acceptance:** Existing features distinguished from new design outcomes. **Required verification:** Cross-programme audit. **Implementation:** Implemented; ADR-0199 Reconciliation record maps each Flow ADR 0198-0214 to the earlier programme work it credits, the deltas built for Flow and what stays open; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/adr-0199-historical-status-reconciliation.md` (Existing features versus new design outcomes, 2026-11-10); `docs/adr/selecta-flow-status-reconciliation.md`.
4. **SF-0199-04 - Record source test catalogue.** **Acceptance:** Automated checks separated from independent acceptance. **Required verification:** Test-file inspection. **Implementation:** Implemented; the catalogue separates automated checks (Vitest, Playwright, pytest) from independent acceptance (the Verified field); **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/adr-0199-historical-status-reconciliation.md` Source test catalogue (2026-11-10).
5. **SF-0199-05 - Define screen review protocol.** **Acceptance:** Candidates versus approved visuals have separate status. **Required verification:** Reviewer and SHA record. **Implementation:** Implemented; screens from visual.e2e.ts and paired-theme.e2e.ts are candidates; only a named reviewer with date, device and SHA in visual-evidence.md approves one, and only the Verified field changes; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/adr-0199-historical-status-reconciliation.md` Screen review protocol (2026-11-10); `docs/adr/completion/visual-evidence.md`.
6. **SF-0199-06 - Record real hardware baseline.** **Acceptance:** OS, browser, CPU/GPU and loads documented. **Required verification:** Reproducible benchmark protocol. **Implementation:** Not started; Needs a person: a real-hardware baseline (OS, browser, CPU/GPU, background load) recorded with a reproducible benchmark on the owner's machine; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0199-07 - List known existing limitations.** **Acceptance:** Baseline issues not misattributed to changes. **Required verification:** Evidence issue register. **Implementation:** Implemented; known limitations recorded so they are not blamed on Flow changes (no cover art read, MixSignature on current mix only, CSS-only route reveal, muted synthetic automation, an unrelated MP-0277 test failure seen on 2026-11-10); **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/adr-0199-historical-status-reconciliation.md` Known existing limitations (2026-11-10).
8. **SF-0199-08 - Enforce truthful status promotion.** **Acceptance:** Every task needs implementation and independent proof separately. **Required verification:** Evidence ledger audit. **Implementation:** Implemented; a ticked task must carry an Evidence field (enforced by src/selecta/audit/checklist_evidence.py); Implementation and Verified are separate fields and no tick here sets Verified; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `python src/selecta/audit/checklist_evidence.py` passed 2026-11-10; `tests/test_checklist_evidence.py` (6 passed).

## Reconciliation record (2026-11-10, ADR-0198 to ADR-0214)

Done on branch `feat/finish-checklists`. The baseline `c3715b14a70a0a9005e9fbc08d44576f3eac3c15` resolves to a commit (`git cat-file -t`) and is an ancestor of the branch (`git merge-base --is-ancestor`); every ADR in this range and the checklist header cite it.

### Existing features versus new design outcomes (SF-0199-03)

A Flow task is credited to older work only when the older code meets the Flow acceptance as written and a named test proved it in this session; the task line then names that test. Otherwise the delta was built here or is left open with its reason.

| Flow ADR | Credited to earlier programmes (proving tests) | Built for Flow on 2026-11-10 | Left open |
|---|---|---|---|
| 0198 charter | MP-0272 surface inventory, completion journeys and parity map; Undo/scope (`controls.test.tsx`), routes (`router.test.tsx`, `pages.e2e.ts`) | - | scene modes, budgets, expertise, metrics (people) |
| 0199 baseline | `checklist_evidence.py` | this record | screenshot run, hardware baseline |
| 0200 art direction | - | - | all eight need design review or study |
| 0201 colour | tokens (`theme-and-edges.md`), axe contrast in both themes, theme-while-playing E2E | `flow-forced-colors.e2e.ts` | specimens, gallery sign-off |
| 0202 type | MP-0275 `typography.test.ts`, long/RTL E2E, zoom/overflow E2E | `flow-fonts.test.ts` | truncation AT check, reading study, sign-off |
| 0203 space | MP-0273 spacing, FP-0270 layers, ADR-278 CSS ownership, keyboard and loading E2E | `flow-narrow.e2e.ts` | nested-card critique |
| 0204 primitives | `controls.test.tsx`, component register, error and race E2E | `flow-forced-colors.e2e.ts` | button hierarchy, NVDA icon audit, visual QA |
| 0205 motion | ADR-296 motion inventory and tokens, motion preference E2E, reduced-motion tests | - | power profile, comfort study |
| 0206 artwork | `MusicObjects.test.tsx`, local-only network E2E | - | cover media (none is read today), cross-surface Mix Sleeve, art families, legibility over art |
| 0207 Thread | `MusicObjects.test.tsx`, duplicate-occurrence tests | - | NVDA, 320-2560 visual fixtures, cross-route test, comprehension study |
| 0208 navigation | router and history tests, mini-player E2E, scope selection test | - | findability, NVDA, View Transitions prototype |
| 0209 player | `player.test.ts`, `focus.test.tsx`, `mediaSession.test.ts`, `listen.e2e.ts` | - | visual review of transport |
| 0210 Listen | `Now.test.tsx`, phone E2E, fullscreen E2E | - | first-glance review, comfort study |
| 0211 handoff | `player.test.ts`, `MusicObjects.test.tsx`, `listen.e2e.ts` | - | DJ audio review, NVDA, listener study |
| 0212 visualizers | `spectrumVisuals.test.ts`, `creative-visualizers.e2e.ts` | - | gallery, grouping, profiles, NVDA, default |
| 0213 lyrics | `Now.test.tsx`, fullscreen-refused E2E, screen-reader flood E2E | shared-words line at a proven word hand-off (`listen.handoff_phrase`, `NowFlow.test.tsx`) | listening and reading studies, 400% Unicode snapshots |
| 0214 time and seek | `Now.test.tsx`, `player.test.ts`, `mediaSession.test.ts` | time left in the seek slider's spoken value; marker and peak provenance tests (`NowFlow.test.tsx`, `tests/test_flow_waveform_peaks.py`) | hardware trace, seek study |

### Source test catalogue (SF-0199-04)

- **Automated checks** (prove an Implementation tick): Vitest files under `web/src/**/*.test.ts(x)`, Playwright specs under `web/e2e/*.e2e.ts` run in Edge against `tests/e2e_server.py`'s synthetic library, and pytest under `tests/`. Each ticked task line names the files and test titles it relies on.
- **Independent acceptance** (the separate **Verified** field, never set by automation): owner approvals, named design reviews, five-second and comprehension studies, NVDA and Windows High Contrast sessions on a real device, real-audio listening and audio/video sync checks, and hardware profiles. Those tasks say `Needs a person` and stay unticked when the acceptance itself is a human judgement; when only the verification is human, the implementation can be ticked and Verified stays No.

### Screen review protocol (SF-0199-05)

Screens captured by `web/e2e/visual.e2e.ts` and `web/e2e/paired-theme.e2e.ts` are **candidates**. A screen becomes **approved** only when a named reviewer records name, date, device and the exact SHA beside it in `docs/adr/completion/visual-evidence.md`. A candidate never changes a task's Verified field; an approval changes only the Verified field of the tasks it names.

### Known existing limitations (SF-0199-07)

So that they are not blamed on Flow changes:

- Selecta reads no embedded or remote cover art. Every song and mix picture is a decorative motif from its library ID or song order.
- The mix picture (`MixSignature`) appears on the current mix only; the drafts list has no song order to draw one from.
- Route changes animate with a CSS reveal; there is no View Transitions API path.
- Browser automation is muted and synthetic: it proves clocks, scheduling and DOM state, not how a hand-off sounds, audible dropouts or a screen-reader user's success.
- On 2026-11-10 `web/src/styles/icon-geometry.test.ts` (MP-0277, another checklist's work in progress) failed one import-order assertion after `styles/depth.css` was added; it is not caused by Flow changes.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0184/0164/0113 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
