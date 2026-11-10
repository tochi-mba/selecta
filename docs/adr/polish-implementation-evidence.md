# Selecta UI/UX polish - implementation evidence

- **Programme implementation status:** PR #23 merged (`84b8b5cbadf7204bf526e8932124b5c4890e2c44`); original per-task evidence remains unreconciled and independently unverified.
- **Date:** 2026-11-06
- **Tasks completed:** 43 / 143
- **Runtime verification:** none claimed by this planning PR.

## Evidence boundary

The planning review inspected frontend sources, relevant backend routes, existing research and ADR/checklist/evidence documents at `fe785ec`. Online references were consulted for loading, progressive disclosure, accessibility, human–AI interaction and performance guidance. Browser preview attachment failed; no rendered-screen, screen-reader, performance or audible review was completed in that planning review.

Documentation/link/file-length checks on this PR validate the plan's structure only. They do not complete any P task.

## Workstream status

| ADR | Task range | Implementation | Evidence |
|---|---|---|---|
| [ADR-0033](adr-0033-polish-baseline-and-governance.md) | P0001–P0010 | In progress (5/10) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0034](adr-0034-polish-visual-system.md) | P0011–P0020 | In progress (9/10) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0035](adr-0035-polish-components-and-feedback.md) | P0021–P0031 | In progress (8/11) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0036](adr-0036-polish-loading-and-skeletons.md) | P0032–P0043 | In progress (3/12) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0037](adr-0037-polish-onboarding-and-readiness.md) | P0044–P0051 | Not started | No implementation or runtime verification |
| [ADR-0038](adr-0038-polish-mixes-and-drafts.md) | P0052–P0060 | Not started | No implementation or runtime verification |
| [ADR-0039](adr-0039-polish-listen-and-shell.md) | P0061–P0069 | Not started | No implementation or runtime verification |
| [ADR-0040](adr-0040-polish-editor-and-inspector.md) | P0070–P0079 | Not started | No implementation or runtime verification |
| [ADR-0041](adr-0041-polish-stem-studio.md) | P0080–P0088 | Not started | No implementation or runtime verification |
| [ADR-0042](adr-0042-polish-requests-and-discovery.md) | P0089–P0099 | Not started | No implementation or runtime verification |
| [ADR-0043](adr-0043-polish-library-and-workshop.md) | P0100–P0111 | Not started | No implementation or runtime verification |
| [ADR-0044](adr-0044-polish-language-and-motion.md) | P0112–P0120 | Implemented (9/9) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0045](adr-0045-polish-responsive-accessibility.md) | P0121–P0131 | Not started | No implementation or runtime verification |
| [ADR-0046](adr-0046-polish-verification-and-release.md) | P0132–P0143 | Not started | No implementation or runtime verification |

## Required per-task evidence when implementation begins

Add an entry keyed by the existing P ID with:

- Status: Not started, In progress, Implemented or Verified; explicitly describe partial work.
- Related inherited T task IDs and feature-parity rows, if applicable.
- Implementing PR and exact commit; merge state.
- Acceptance criterion and actual result, including failed cases.
- Automated checks and actual command/result or CI link.
- Reviewed screenshots with theme, viewport, fixture and state.
- Manual keyboard, assistive technology, task or audible evidence where required.
- Remaining checks, limitations, owner and next action.

Do not populate hypothetical successes. Keep [the canonical checklist](polish-implementation-checklist.md) consistent with these entries. Human checks remain pending until actually performed.

## ADR-0035 task evidence (reconciled 2026-11-10, branch `feat/finish-checklists`, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus later programmes (Microinteraction, Final polish, Measured micro-polish, completion pass #37). Inherited T tasks: none mapped (P0005 still open). Screenshots: none reviewed by a person.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0021 | Implemented | Dev-only gallery `web/src/ui/ControlGallery.tsx` holds every listed family; links, chips, badges, rows and cards added in this pass | `pnpm exec vitest run src/ui/polish-components.test.tsx`: 8/8 passed | Named visual review |
| P0023 | Implemented | `Action` reserves both labels, `aria-busy`/`aria-disabled`, one run per press | `polish-components.test.tsx` P0023; `controls.test.tsx` (passed in an 11-file run) | - |
| P0024 | Implemented | `Field` label/help/error wiring; form table in `completion/copy-audit.md` | `polish-components.test.tsx` P0024 | Screen-reader listen-through |
| P0025 | Implemented | `Tabs` ARIA pattern with roving focus; route subpages are `LinkTabs` links | `polish-components.test.tsx` P0025 (2); `ufSeamInspector.test.tsx` arrow keys | Screen-reader listen-through |
| P0026 | Implemented | Focus entry/trap/Escape/restore/nested inert; `overscroll-behavior: contain`; Studio working copy survives close/reopen | `controls.test.tsx`; `ex0122StudioParity.test.tsx`, `StudioSafety.test.tsx`: 168/169 passed in an 11-file vitest run (only failure: unrelated `Drafts.test.tsx` "large draft collections") | - |
| P0027 | Open (Needs a person) | Pointer and keyboard pass | `controls.test.tsx` menu/tooltip; `Glossary.test.tsx` | Real touch device |
| P0028 | Implemented | 5 Undo toasts: 3 shown, 5 undoable in Activity, the evicted one still runs | `polish-components.test.tsx` P0028 | - |
| P0030 | Implemented | Destructive actions separated (trash icon + word), confirmation kept on deletion failure, Undo preserved | `destructiveIcons.test.ts`, `actionTierRegister.test.ts`, `Drafts.test.tsx` delete confirmation | - |
| P0031 | Open (Needs a person) | Automated keyboard/visual checks only | as above | NVDA/Narrator pass, named visual reviewer |

## ADR-0044 task evidence (reconciled 2026-11-10, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0112 | Implemented | Glossary distinguishes current mix, draft, request order and render line | `Glossary.test.tsx` 5/5 | - |
| P0113 | Implemented | Copy audit in `completion/copy-audit.md`; action terms state their effect | `Glossary.test.tsx`, `actionTierRegister.test.ts` | - |
| P0114 | Implemented | Case, plurals, times, waits, keys and units conventions with helpers | `lib.test.ts`, `shortcuts.test.ts` | - |
| P0115 | Implemented | Errors say what happened, what is safe, and offer Retry | `feedbackTaxonomy.test.tsx`, `controls.test.tsx` | - |
| P0116 | Implemented | Steering effect and requested/planned/rendered/heard explained | `Glossary.test.tsx` GP-0256-05 | - |
| P0117 | Implemented | Explanations on demand; automated checks never claim musical judgement | `polish-components.test.tsx` P0117 (9/9 file run) | - |
| P0118 | Implemented | Motion token roles and inventory | `motion-tokens.test.ts` 3/3 | - |
| P0119 | Implemented | Live OS preference change and Still preference; canvas honours it | `polish-components.test.tsx` P0119, `useReducedMotion.test.tsx` | - |
| P0120 | Implemented | Announcements de-duplicated; truncation, mixed-direction and missing names rules | `gp-0257-comfort.test.tsx`, `typography.test.ts` | Screen-reader listen-through (not claimed) |

## ADR-0034 task evidence (reconciled 2026-11-10, uncommitted working tree)

All checks below are vitest files run on 2026-11-10 (`pnpm exec vitest run <files>`); the first 20-file run had 159/162 passing, with `css-ownership.test.ts` (2, a register mid-edit by another agent) and a `Glossary.test.tsx` timeout failing; both files passed on the rerun.

| Task | Status | Acceptance and result | Automated check | Remaining |
|---|---|---|---|---|
| P0011 | Implemented | Type roles, display reserved for focal titles, generic fallbacks | `typography.test.ts`, `flow-fonts.test.ts` | Named typography review |
| P0012 | Implemented | Tabular numerals, reserved clock, number/time formats | `typography.test.ts`, `optical-alignment.test.ts`, `lib.test.ts` | - |
| P0013 | Implemented | Spacing scale map with exceptions | `spacing-tokens.test.ts` | - |
| P0014 | Implemented | Reading/browse/work widths, density opt-in, breakpoint owners | `optical-alignment.test.ts`, `css-ownership.test.ts` | - |
| P0015 | Implemented | Semantic surfaces and edges in both themes | `surface-depth.test.ts` | Paired screenshot review |
| P0016 | Implemented | One local vector icon family; no emoji UI icons in the local app | `icon-geometry.test.ts`, `destructiveIcons.test.ts`, source scan | - |
| P0017 | Implemented | Radii, separators, overlay depth, stacking order | `surface-depth.test.ts`, `layer-precedence.test.ts` | - |
| P0018 | Implemented | Wrapping/truncation/RTL/missing-artwork rules | `typography.test.ts` | - |
| P0019 | Open (Needs a person) | Automated contrast spec exists only | - | Independent contrast and font audit with screenshots |
| P0020 | Implemented | Ownership register, selector collisions, no unexplained one-offs | `css-ownership.test.ts`, `spacing-tokens.test.ts` | - |

## ADR-0037 task evidence (reconciled 2026-11-10, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0044 | Implemented | One primary Start; folder help now also names the read formats (`SUPPORTED_AUDIO`) | `vitest run polishPhase03Start.test.tsx` 9/9; `App.test.tsx` in a 5-file run, 30/30 | - |
| P0045 | Implemented | New `invalid` and `empty` folder kinds; every kind and scan state has its own words | `pytest tests/test_polish_phase03.py tests/test_s4_folder_input.py tests/test_ci_creative_interface.py` 30 passed | - |
| P0046 | Implemented | Found, analysed, timed lyrics and ready counted apart from `/status` | `Setup.test.tsx`, `readinessCounts.test.tsx` | - |
| P0047 | Implemented | `ready / 6 needed` and an actionable reason once analysis is done | `Setup.test.tsx` | - |
| P0048 | Implemented | Library, progress and sources stay reachable while preparing | `polishPhase03Start.test.tsx` P0048 | - |
| P0049 | Implemented | Lookup sends only artist, title, album, duration; starts on folder add, new songs in added folders and `selecta lyrics`; nothing when `lyrics.lookup` is off; README reconciled | `tests/test_polish_phase03.py` (5), `localPrivacyCopy.test.ts` | - |
| P0050 | Superseded | ADR-0126: native picker declined by the owner | - | - |

## ADR-0040 task evidence (reconciled 2026-11-10, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus later programmes (Unified finish UF-0381, Measured micro-polish MP-0287/MP-0288). Site build `vite build --outDir dist-saas-p3`; Playwright on port 9050 under the slot lock (59 tests across 8 specs: 31 passed, 28 failed, many during concurrent edits by other sections). Vitest: 16-file run 238/240 passed (the 2 failures, `gp-0261-studio` and `LibraryLx` LX-0346-07, passed on rerun: 8 files 107/107). Screenshots: none reviewed by a person.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0070 | Implemented | Draft is named and scoped on Edit | `Mix.test.tsx` "a draft on the Edit page" passed | MP-0287-07 pinned-bar check failed; rerun after layout work settles |
| P0071 | Implemented | Row and connector columns align | MP-0287-01, MP-0287-02 passed | MP-0287-04 state marks failed |
| P0072 | Verified (automated) | Play and Move up/down stay on each row; Lock and Remove sit in one keyboard-opened More menu; every insertion target names where the song lands | new `web/src/views/polishEditorActions.test.tsx` 1/1 (`vitest run --pool=threads`); Playwright MP-0287-01, MP-0287-06 passed | - |
| P0073 | Implemented | Selection follows the song through moves | MP-0287-05; `Mix.test.tsx` "the same stays selected when others move" passed | MP-0287-03 (320px keyboard/drag) and integration Undo test failed |
| P0074 | Implemented | Pair named in every tab, legible narrow | MP-0288-01; `ufSeamInspector.test.tsx` 5/5 passed | MP-0288-06 (sheet covers CTA/focus) failed |
| P0075 | Verified (automated) | Requested move, rendering, fallback and what really plays are separate words and states | `pnpm exec vitest run src/views/Mix.test.tsx src/views/editorMode.test.tsx` passed (Mix "keeps the move you asked for pressed...", "says nothing about a fallback...", "highlights the plan until something has landed", "says what you chose and what will really play", "does not present remembered failures as ongoing renders"; editorMode "keeping asked and played apart") | - |
| P0076 | Verified (automated) | Invalid cues marked with reason and server choice kept; unavailable moves disabled with reasons; field errors tied to fields | `Mix.test.tsx` "an exact cue that cannot be used"; `ufSeamInspector.test.tsx` greyed-out moves; Playwright MP-0288-05 (both) passed | - |
| P0077 | Verified (automated) | Late answers never switch the inspected pair; failed options loading shows an alert with Try again that reloads the same pair | new `web/src/views/polishInspectorLoad.test.tsx` 1/1; `Mix.test.tsx` "keeps the latest choice visible when an older server response refreshes the inspector"; Playwright MP-0288-07 passed | - |
| P0078 | Implemented | Scope switching, stale order and deleted draft handled | `Mix.test.tsx` "keeps each mix scope's exact selection separate", "stop and catch up if the mix has moved on"; `App.test.tsx` "says so if the draft has gone" passed | integration.e2e "Undo knows which is which" timed out |
| P0079 | Open (Needs a person) | - | MP-0287-08 failed | Human review of a 100-song timeline during playback and rendering |

## ADR-0033 task evidence (reconciled 2026-11-10, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0001 | Implemented | Baseline commit, support boundary, kinds of evidence in `completion/baseline.md` | `.venv\Scripts\python -m pytest tests/test_polish_governance.py -q -p no:cacheprovider`: 5 passed | - |
| P0002 | Implemented | Route/overlay/special-state inventory and `mp-0272-surface-inventory.json` | `test_polish_governance.py` P0002; `mpSurfaceInventory.test.ts` passed | - |
| P0003 | Implemented | Every surface x state cell filled or explained; three reasons added this pass | `test_polish_governance.py` P0003 | Named reviewer read-through |
| P0004 | Open (Needs a person) | Candidate paired captures only | - | Capture review by a named reviewer |
| P0005 | Open | No T-to-P mapping | - | Cross-programme mapping |
| P0006 | Implemented | Three role scripts with errors, recovery and walking tests | `test_polish_governance.py` P0006 | Dry run with people |
| P0007 | Open | No severity register for all findings | - | Findings register |
| P0008 | Implemented | Decision vs implementation status separated in all 14 ADRs | `test_polish_governance.py` P0008 | - |
| P0009 | Open (in progress) | Entries for this section exist | - | Other sections' entries |
| P0010 | Open (Needs a person) | Automated invariant suites exist | - | Owner release disposition |

Addendum to ADR-0035 (2026-11-10): P0022 stays open (MP-0279-02/03/04/06/07 failed in a shared-machine Playwright run of `web/e2e/mp-0279-component-gallery.e2e.ts` against `dist-saas-p1`, port 9042; MP-0279-01 and -05 passed). P0029 Implemented: `toastsCoalesce.test.tsx`, `gp-0257-comfort.test.tsx`, `toastPriority.test.tsx`, `polish-loading.test.tsx` passed.

## ADR-0036 task evidence (reconciled 2026-11-10, uncommitted working tree)

Playwright: `slot.py browser -- pnpm exec playwright test e2e/mp-0279-component-gallery.e2e.ts e2e/mp-0297-loading-and-recovery.e2e.ts --output test-results-saas-p1` with `SELECTA_E2E_DIST=dist-saas-p1`, `SELECTA_E2E_PORT=9042`: 3 passed, 9 failed (MP-0297-04 passed; MP-0297-01/02/03/05 failed while other agents were changing Library and the gallery spec). Failed measurements are not counted as evidence.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0032-P0034, P0036 | Open (built, not proven) | Content-shaped variants exist and are used | MP-0297-01 failed | Green geometry measurement |
| P0035 | Open (partly built) | Inspector skeleton only; no Edit timeline consumer | - | Timeline skeleton in Edit |
| P0037 | Open (partly proven) | Request identity and refresh rules | `async.test.tsx` passed; MP-0297-03 failed | Green end-to-end refresh check |
| P0038 | Open | 120ms reveal delay chosen | - | Measured flicker study |
| P0039 | Implemented | Theme-aware, bounded, reduced-motion-still, hidden bars, one announcement | `skeletonHonesty.test.tsx` 2/2 | - |
| P0040 | Implemented | Real stages and honest wait words, no fabricated percentages | `workState.test.ts`, `jobs.test.ts`, `lib.test.ts` | - |
| P0041 | Implemented | Slow and failed retrieval are honest with Retry, incl. Listen details and inspector checks | `pnpm exec vitest run src/views/polish-loading.test.tsx`: 3/3 | - |
| P0042 | Open (partly proven) | Stale/out-of-order/failed refresh and de-duplicated announcements | `async.test.tsx`, `gp-0257-comfort.test.tsx` | Delayed/partial/retried flash tests |
| P0043 | Open | Layout stability not measured green | MP-0297-01/03 failed | Green measurement |

## ADR-0038 task evidence (reconciled 2026-11-10, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0052 | Implemented | Featured pick, durations and Customize hierarchy | `vitest run Mixes.test.tsx` 23/23 | - |
| P0053 | Implemented | Card metadata, action order, unavailable reasons | `Mixes.test.tsx` | - |
| P0054 | Implemented | Play now / Edit / Save as draft with the playback effect stated | `Mixes.test.tsx` | - |
| P0055 | Implemented | Current mix vs drafts and their states | `Drafts.test.tsx`, `MyMixes.test.tsx`, `CurrentMix.test.tsx` 31 passed (`--pool threads --maxWorkers 1`) | - |
| P0056 | Implemented | Defaults are for new mixes | `Mixes.test.tsx` | - |
| P0057 | Implemented | Measured energy normalised to the mix's own range, labelled as not comparable | `polishPhase03Mixes.test.tsx` 4/4, `MixSetup.test.tsx` 3/3 | - |
| P0058 | Implemented | No ready match vs failed search with Retry | `polishPhase03Mixes.test.tsx` | - |
| P0059 | Implemented | Draft feedback; render line vs playback order | `Drafts.test.tsx` | - |

## ADR-0041 task evidence (reconciled 2026-11-10, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus later Stem Studio work (S3-0059, GP-0261, FP-0266, Measured micro-polish MP-0289). Vitest: `Studio.test.tsx`, `StudioSafety.test.tsx`, `gp-0261-studio.test.tsx` and `src/audio/focus.test.tsx` passed in the 16-file run and reruns; new `web/src/views/polishStudioRecovery.test.tsx` 2/2 with `controls.test.tsx` (39/39 across both, `--pool=threads`). Playwright `mp-0289-stem-studio.e2e.ts`: only MP-0289-08 passed; MP-0289-01 to -07 failed because `.studio-cell` did not appear within 60 s on the loaded shared machine (spec also being edited by the micro-polish section). Screenshots: none reviewed by a person.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0080 | Implemented | Every cell named for a screen reader | `Studio.test.tsx` "shows a square for every part of both songs" | MP-0289-01/-03/-06 rerun on a quiet machine |
| P0081 | Implemented | Played square marked | `Studio.test.tsx` "marks the square being played" | MP-0289-02 measured state check |
| P0082 | Verified (automated) | Preparing shows an estimate and keeps polling; failure named with Try again that reloads the same pair; missing stems marked unavailable | `polishStudioRecovery.test.tsx` P0082; `Studio.test.tsx` estimate, polling, failure words, missing stem; `StudioSafety.test.tsx` stem could not load | - |
| P0083 | Verified (automated) | Studio says previewing pauses the main mix; play pauses it, Stop leaves it paused (the hint tells the person to resume from the main player); close and hidden tab release audio; failure gives the sound back | `polishStudioRecovery.test.tsx` P0083; `Studio.test.tsx` play/stop, close, hidden tab; `focus.test.tsx` 12 tests | Audible confirmation is P0088 |
| P0084 | Implemented | Verbal separation of preview, arrange, fine-tune, restore, reset and Apply | `Studio.test.tsx` shapes, Start again, Put it back, fine tune, "nothing it does is final" | MP-0289-05 visual check |
| P0085 | Verified (automated) | Working copy vs applied state said plainly; numbered pair named; save, failure and restore states shown | `StudioSafety.test.tsx` 8/8; `Studio.test.tsx` numbered pair, Apply, recovery | - |
| P0086 | Verified (automated) | Failed Apply keeps local work; recovery rejects wrong-size or corrupt copies; storage-blocked warning | `StudioSafety.test.tsx`; `Studio.test.tsx`; Playwright MP-0289-08 passed | - |
| P0087 | Open (Needs a person) | Keyboard reaches all 512 cells | `gp-0261-studio.test.tsx` 2/2 | Real touch device at narrow width; MP-0289-06 |
| P0088 | Open (Needs a person) | Automated pair-keeping path passes | MP-0289-08 | Audible real-stem audition evidence |

## ADR-0046 task evidence (reconciled 2026-11-10, uncommitted working tree)

No task in this ADR is ticked: each needs a full candidate run, recorded hardware, real audio, participants or owner disposition. Automated facts gathered on 2026-11-10:

| Task | Status | Result | Check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0132 | Open | `e2e/visual.e2e.ts` captures review candidates only; no committed pixel baselines | `grep toHaveScreenshot web/e2e`: 0 | Deterministic baselines per surface, state, theme and width |
| P0133 | Open (Needs a person) | - | - | Named reviewer compares differences |
| P0134 | Open | Focused runs only (agents may not run full suites); focused Playwright 31/59 passed | 8-spec Playwright run, port 9050 | Full CI on the candidate SHA |
| P0135 | Open (Needs a person) | - | - | Traces on recorded hardware |
| P0136 | Open | Lab spec MP-0298-06 failed | `mp-0298-responsive-and-a11y.e2e.ts` | Fix and report labelled lab results |
| P0137 | Open (Needs a person) | - | - | Actual audio evidence |
| P0138 | Open | `integration.e2e.ts` 5/7 passed (two draft/current tests timed out) | Playwright | All recovery scenarios green together |
| P0139 | Open (Needs a person) | - | - | Unguided participant tasks |
| P0140 | Open (Needs a person) | - | - | Owner blocker review |
| P0141 | Implemented | Rollback from this tree to `main` (`405cf7f`) and forward again: "identical across all three" for songs, settings, mix, seam settings, drafts, corrected tempo, export record and requests | `.venv\Scripts\python tests/rollback_check.py <git archive main src>` under the slot lock | Ratings are not yet in the harness |
| P0142 | Open | Section entries updated 2026-11-10 | - | PR and verification links at final reconciliation |
| P0143 | Open (Needs a person) | - | - | Release-candidate review and owner disposition |

## ADR-0042 task evidence (reconciled 2026-11-10, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0089 | Implemented | One request vocabulary; `RequestTag` shared by Listen and Edit | `polishPhase03Listen.test.tsx` 7/7; `Requests.test.tsx` 51/51 | - |
| P0090 | Implemented | Planned place named; waiting, unplaceable and failed apart | `Requests.test.tsx`; `RequestsJoining.test.tsx` (with `Links.test.tsx` 73 passed) | - |
| P0091 | Implemented | Extra songs named and counted before approval; all-or-nothing join | `Requests.test.tsx`, `RequestsJoining.test.tsx`; pytest atomic insertion + bridge consent, 3 passed | - |
| P0092 | Implemented | Search, duplicates, cancel, retry, stale bridge, no match | `Requests.test.tsx`, `RequestsJoining.test.tsx` | - |
| P0093 | Implemented | Word-pair cards, rating, failed-render retry | `Links.test.tsx`, `LinksRating.test.tsx` 1/1, `polishPhase03Listen.test.tsx` P0093 | - |
| P0094 | Implemented | Loading vs no candidates vs failed; audition stage only after playback starts | `Links.test.tsx` | - |
| P0095 | Implemented | Refused play is said, owner released, stage retryable | `polishPhase03Listen.test.tsx` P0095, `Links.test.tsx` | - |
| P0096 | Implemented | Candidate/reviewed/prepared apart; Yes/No/Skip and revisiting | `Links.test.tsx` | - |
| P0097 | Implemented | Current mix vs named draft destination; atomic `/mix/pair` | `Links.test.tsx` | - |
| P0098 | Implemented | Competing requests, bridge rejection, playhead, stale cancel, duplicates | `Requests.test.tsx` | - |
| P0099 | Implemented | New: pair being heard stays put through a background refresh | `polishPhase03Listen.test.tsx` P0099, `Links.test.tsx`, `LinksRating.test.tsx` | - |

## ADR-0043 task evidence (reconciled 2026-11-10, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus Library/Lucy (LX), Selecta 3.0 Library and Measured micro-polish (MP-0291, MP-0293, MP-0294). Vitest: `Library.test.tsx`, `LibraryLx.test.tsx` (47/47 on rerun), `Workshop.test.tsx`, `ExportJobs.test.tsx`, `Listening.test.tsx`, `ListeningStudyFlow.test.tsx`, `controls.test.tsx` passed; new `polishWorkshopShowcase.test.tsx` 5/5 and `polishReadinessDistinct.test.ts` 3/3. Playwright: MP-0291-01/02/04/05, MP-0293-01/02/05/07/08, MP-0294-01/07/08 passed; MP-0291-03/06/07, MP-0293-03/04/06, MP-0294-02/03/04, -05, -06 failed.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0100 | Verified (automated) | Title, artist, readiness and the relevant action lead; secondary actions sit in a keyboard menu | `LibraryLx.test.tsx` readiness decides actions; `Library.test.tsx` layouts keep actions; `controls.test.tsx` menu; MP-0291-02 | MP-0291-03 target check failing |
| P0101 | Verified (automated) | One search/filter/sort/count bar; empty library, empty filter and no-match differ; Clear search keeps the filter | `LibraryLx.test.tsx`; MP-0291-01 | - |
| P0102 | Verified (automated) | Analysed vs mix-ready, measured vs corrected, Never play vs Set aside, priority vs readiness stay distinct | new `web/src/state/polishReadinessDistinct.test.ts`; `Library.test.tsx`; `LibraryLx.test.tsx`; MP-0291-04 | - |
| P0103 | Implemented | Query, page depth, typed values and search focus survive | `Library.test.tsx`; `LibraryLx.test.tsx` | MP-0291-06 (the way back) failed |
| P0104 | Implemented | 20,000-song library renders one page as a real list | `LibraryLx.test.tsx` LX-0345-07 | MP-0291-07 failed; hardware timing is P0135 |
| P0105 | Verified (automated) | Overview leads with repairs; sections share one rhythm; keyboard repair path | `Workshop.test.tsx`; MP-0293-01/02/05/07/08 | MP-0293-03/04/06 layout checks failing |
| P0106 | Verified (automated) | Control gallery only in development (or VITE_SELECTA_GALLERY=1) builds, folded under Diagnostics | new `web/src/views/polishWorkshopShowcase.test.tsx` P0106 (2); production bundle `dist-saas-p3/assets/*.js` has 0 `control-gallery` | - |
| P0107 | Verified (automated) | Budget, cache, free disk and untouched music named apart; refused save shows the confirmed limit and Retry; older save never overrides a newer choice | `polishWorkshopShowcase.test.tsx` P0107/P0111 (3); `Workshop.test.tsx` protected stems, really-saved value | MP-0293-04 geometry failing |
