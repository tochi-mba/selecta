# Selecta UI/UX polish - implementation evidence

- **Programme implementation status:** PR #23 merged (`84b8b5cbadf7204bf526e8932124b5c4890e2c44`); original per-task evidence remains unreconciled and independently unverified.
- **Date:** 2026-11-06
- **Tasks completed (2026-11-12):** 114 / 143 ticked. The entries below record 118 Implemented (24 of them "Verified (automated)", which is not independent verification), 24 Open and 1 Superseded.
- **Runtime verification:** none claimed by this planning PR.
- **Implementing PR and commits:** PR #23 (`84b8b5c`) for the original work; the 2026-11-10/11 reconciliation and new work merged as PR [#55](https://github.com/tochi-mba/selecta/pull/55) (`fcf745f`, all-green CI run [43123598913](https://github.com/tochi-mba/selecta/actions/runs/43123598913)); the 2026-11-12 work is on branch `feat/finish-checklists-2`, PR [#56](https://github.com/tochi-mba/selecta/pull/56). Each section below names its own tests and runs. Inherited T work: [completion/t-to-p-map.md](completion/t-to-p-map.md) (P0005).

## Evidence boundary

The planning review inspected frontend sources, relevant backend routes, existing research and ADR/checklist/evidence documents at `fe785ec`. Online references were consulted for loading, progressive disclosure, accessibility, human–AI interaction and performance guidance. Browser preview attachment failed; no rendered-screen, screen-reader, performance or audible review was completed in that planning review.

Documentation/link/file-length checks on this PR validate the plan's structure only. They do not complete any P task.

## Workstream status

| ADR | Task range | Implementation | Evidence |
|---|---|---|---|
| [ADR-0033](adr-0033-polish-baseline-and-governance.md) | P0001–P0010 | In progress: 8/10 ticked (P0004, P0010 need a person) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0034](adr-0034-polish-visual-system.md) | P0011–P0020 | In progress: 9/10 ticked (P0019 needs a person) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0035](adr-0035-polish-components-and-feedback.md) | P0021–P0031 | In progress: 9/11 ticked (open: P0027, P0031) | Per-task entries below, checks run 2026-11-10/12; independent verification pending |
| [ADR-0036](adr-0036-polish-loading-and-skeletons.md) | P0032–P0043 | Implemented (12/12) | Per-task entries below, checks run 2026-11-10/12; independent verification pending |
| [ADR-0037](adr-0037-polish-onboarding-and-readiness.md) | P0044–P0051 | Implemented: 7/8 ticked (P0050 superseded) | Per-task entries below (2026-11-10/12); independent verification pending |
| [ADR-0038](adr-0038-polish-mixes-and-drafts.md) | P0052–P0060 | Implemented (9/9) | Per-task entries below (2026-11-10/12); independent verification pending |
| [ADR-0039](adr-0039-polish-listen-and-shell.md) | P0061–P0069 | In progress: 8/9 ticked (P0069 needs a person) | Per-task entries below (2026-11-10/12); independent verification pending |
| [ADR-0040](adr-0040-polish-editor-and-inspector.md) | P0070–P0079 | In progress: 7/10 ticked (open: P0071, P0078, P0079) | Per-task entries below (2026-11-10/12) |
| [ADR-0041](adr-0041-polish-stem-studio.md) | P0080–P0088 | In progress: 7/9 ticked (P0087, P0088 need a person) | Per-task entries below (2026-11-10/11) |
| [ADR-0042](adr-0042-polish-requests-and-discovery.md) | P0089–P0099 | Implemented (11/11) | Per-task entries below (2026-11-10/12); independent verification pending |
| [ADR-0043](adr-0043-polish-library-and-workshop.md) | P0100–P0111 | Implemented (12/12) | Per-task entries below (2026-11-10/11) |
| [ADR-0044](adr-0044-polish-language-and-motion.md) | P0112–P0120 | Implemented (9/9) | Per-task entries below, checks run 2026-11-10; independent verification pending |
| [ADR-0045](adr-0045-polish-responsive-accessibility.md) | P0121–P0131 | In progress: 3/11 ticked (open: P0121-P0123, P0126, P0128-P0131) | Per-task entries below (2026-11-10/11) |
| [ADR-0046](adr-0046-polish-verification-and-release.md) | P0132–P0143 | In progress: 2/12 ticked (open: P0132, P0133, P0135-P0140, P0142, P0143) | Per-task entries below (2026-11-10/11) |

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
| P0022 | Implemented | Every state reads differently without moving, in light and dark, and long labels fit at 320px; light-theme primary hover added (`foundation.css`) | `polish-p0022-state-themes.e2e.ts` 4/4 and MP-0279-01..07 7/7 passed in Edge 2026-11-12 | Independent review |
| P0023 | Implemented | `Action` reserves both labels, `aria-busy`/`aria-disabled`, one run per press | `polish-components.test.tsx` P0023; `controls.test.tsx` (passed in an 11-file run) | - |
| P0024 | Implemented | `Field` label/help/error wiring; form table in `completion/copy-audit.md` | `polish-components.test.tsx` P0024 | Screen-reader listen-through |
| P0025 | Implemented | `Tabs` ARIA pattern with roving focus; route subpages are `LinkTabs` links | `polish-components.test.tsx` P0025 (2); `ufSeamInspector.test.tsx` arrow keys | Screen-reader listen-through |
| P0026 | Implemented | Focus entry/trap/Escape/restore/nested inert; `overscroll-behavior: contain`; Studio working copy survives close/reopen | `controls.test.tsx`; `ex0122StudioParity.test.tsx`, `StudioSafety.test.tsx`: 168/169 passed in an 11-file vitest run (only failure: unrelated `Drafts.test.tsx` "large draft collections") | - |
| P0027 | Open (Needs a person) | Pointer and keyboard pass | `controls.test.tsx` menu/tooltip; `Glossary.test.tsx` | Real touch device |
| P0028 | Implemented | 5 Undo toasts: 3 shown, 5 undoable in Activity, the evicted one still runs | `polish-components.test.tsx` P0028 | - |
| P0029 | Implemented | Failures actionable near their source; repeated connectivity notices de-duplicated; no notification storms | `toastsCoalesce.test.tsx`, `gp-0257-comfort.test.tsx`, `toastPriority.test.tsx`, `polish-loading.test.tsx` passed (addendum below) | - |
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
| P0051 | Implemented | Retry, copied-in, removed, Unicode, restart and return visit keep setup progress | `pytest tests/test_scan.py` 27 passed; Playwright 2026-11-11, 25/26 passed (finishing first-run folder, MP-0282-06/08) | - |

## ADR-0040 task evidence (reconciled 2026-11-10, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus later programmes (Unified finish UF-0381, Measured micro-polish MP-0287/MP-0288). Site build `vite build --outDir dist-saas-p3`; Playwright on port 9050 under the slot lock (59 tests across 8 specs: 31 passed, 28 failed, many during concurrent edits by other sections). Vitest: 16-file run 238/240 passed (the 2 failures, `gp-0261-studio` and `LibraryLx` LX-0346-07, passed on rerun: 8 files 107/107). Screenshots: none reviewed by a person.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0070 | Implemented | Draft is named and scoped on Edit; scope bar pinned for the whole editor (`.editor-head { display: contents; }`, `6f395ea`) | MP-0287-07 passed in Edge 2026-11-12 and CI run 43119473767; `Mix.test.tsx` "a draft on the Edit page" 2026-11-11 | Independent review |
| P0071 | Implemented | Row and connector columns align | MP-0287-01, MP-0287-02 passed | MP-0287-04 state marks failed |
| P0072 | Verified (automated) | Play and Move up/down stay on each row; Lock and Remove sit in one keyboard-opened More menu; every insertion target names where the song lands | new `web/src/views/polishEditorActions.test.tsx` 1/1 (`vitest run --pool=threads`); Playwright MP-0287-01, MP-0287-06 passed | - |
| P0073 | Implemented | Keyboard move buttons beside the grip; selection follows the song through moves and Undo | MP-0287-03 passed in Edge 2026-11-12 and CI run 43119473767; integration "Undo knows which is which" passed in CI run 43119473767; `Mix.test.tsx` 2026-11-11 | Independent review |
| P0074 | Implemented | Pair named in every tab, legible narrow; focus scrolls clear of the pinned identity (`web/src/ui/useStickyClearance.ts`, scroll-padding in `creation.css`) | MP-0288-01..07 passed in Edge 2026-11-12 and CI run 43119473767; `useStickyClearance.test.tsx` 5/5, `ufSeamInspector.test.tsx` 2026-11-11 | Independent review |
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
| P0005 | Implemented | 42 open T tasks and 18 parity rows mapped to P tasks with a no-double-counting rule in `completion/t-to-p-map.md` | `pytest tests/test_polish_governance.py -q -p no:cacheprovider` 8 passed 2026-11-11 (P0005 test) | Owner read-through |
| P0006 | Implemented | Three role scripts with errors, recovery and walking tests | `test_polish_governance.py` P0006 | Dry run with people |
| P0007 | Implemented | P0007 findings register below: PF-01 to PF-20, each P0/P1/P2 with location, impact, acceptance check and status | `test_polish_governance.py` P0007 test, passed 2026-11-11 | Owner severity review (P0140) |
| P0008 | Implemented | Decision vs implementation status separated in all 14 ADRs | `test_polish_governance.py` P0008 | - |
| P0009 | Implemented | Every P0001-P0143 has an entry row; header names PR #23 and the branch commits; ticks agree with entries | `test_polish_governance.py` P0009 test, passed 2026-11-11 | Final PR link (P0142) |
| P0010 | Open (Needs a person) | Automated invariant suites exist | - | Owner release disposition |

Addendum to ADR-0035 (2026-11-10): P0022 stays open (MP-0279-02/03/04/06/07 failed in a shared-machine Playwright run of `web/e2e/mp-0279-component-gallery.e2e.ts` against `dist-saas-p1`, port 9042; MP-0279-01 and -05 passed). P0029 Implemented: `toastsCoalesce.test.tsx`, `gp-0257-comfort.test.tsx`, `toastPriority.test.tsx`, `polish-loading.test.tsx` passed.

## ADR-0036 task evidence (reconciled 2026-11-10, uncommitted working tree)

Playwright: `slot.py browser -- pnpm exec playwright test e2e/mp-0279-component-gallery.e2e.ts e2e/mp-0297-loading-and-recovery.e2e.ts --output test-results-saas-p1` with `SELECTA_E2E_DIST=dist-saas-p1`, `SELECTA_E2E_PORT=9042`: 3 passed, 9 failed (MP-0297-04 passed; MP-0297-01/02/03/05 failed while other agents were changing Library and the gallery spec). Failed measurements are not counted as evidence.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0032 | Implemented | Mix feeling placeholder: motif, name, summary, facts, disclosure and two-up actions at the foot, on the loaded 3/2/1 tracks, gap, padding and height; real hint words and filter names kept while loading (`Skeleton.tsx`, `polish.css`, `Mixes.tsx`) | `polish-p0032-p0036-skeleton-geometry.e2e.ts` P0032 (375/768/1440px) passed in Edge 2026-11-12 (`dist-r7a`, port 9500); `polishSkeletonShapes.test.tsx` 3/3 | Independent review |
| P0034 | Implemented | Listen: real title; waveform place held by one flat, childless, aria-hidden block at the strip's height, margins and phone order; lyric placeholder at `.lyrics`' box with no audio shape (`Now.tsx`, `Skeleton.tsx`, `polish.css`) | `polish-p0032-p0036-skeleton-geometry.e2e.ts` P0034 (375/1440px) passed in Edge 2026-11-12; `polishSkeletonShapes.test.tsx` 3/3 | Independent review |
| P0036 | Implemented | Discover: word cards on `.link-grid`'s tracks; chord-match heading and explanation real around a one-pair placeholder. Workshop: panels and headings real, `rows` placeholders at `.job-list`'s tracks (`Links.tsx`, `WorkshopPanels.tsx`, `Workshop.tsx`, `Skeleton.tsx`, `polish.css`) | `polish-p0032-p0036-skeleton-geometry.e2e.ts` both P0036 tests (375/1440px) passed in Edge 2026-11-12; MP-0297-01..05 and P0033 3/3 in the same build | Independent review |
| P0033 | Implemented | Library placeholder matches loaded columns, row height and card columns in list comfortable, list compact and cards at 320/768/1440px (`polish.css`, `operations.css`) | `polish-p0033-library-skeleton-modes.e2e.ts` 3/3, MP-0297-01, MP-0291-01..07 passed in Edge 2026-11-12; vitest 75/75 | Independent review |
| P0035 | Implemented | Timeline placeholder is song rows with transitions between them at the timeline's 84px/96px heights; inspector keeps its panel | `polish-p0035-timeline-skeleton.e2e.ts` passed in Edge 2026-11-12 and CI run 43119473767; `polishTimelineSkeleton.test.tsx` 4/4 2026-11-11 | Independent review |
| P0037 | Implemented | First load vs background refresh: refresh keeps list, selection, focus, scroll and the music; failed refresh keeps the last good answer | MP-0297-03 passed in Edge 2026-11-12 and CI run 43119473767; `async.test.tsx` 2026-11-10 | Independent review |
| P0038 | Implemented | Bars revealed only after 120ms (`REVEAL_AFTER_MS`, `--motion-fast`) in every motion setting, space reserved at once, content never held back; fake-clock table: 0-120ms answers show no placeholder, 200/500/2000ms show it for 80/380/1880ms | `polish-p0038-reveal.e2e.ts` both motion settings passed in Edge 2026-11-12 and CI run 43119473767; `polishReveal.test.tsx` 2/2 2026-11-11 | Independent review |
| P0039 | Implemented | Theme-aware, bounded, reduced-motion-still, hidden bars, one announcement | `skeletonHonesty.test.tsx` 2/2 | - |
| P0040 | Implemented | Real stages and honest wait words, no fabricated percentages | `workState.test.ts`, `jobs.test.ts`, `lib.test.ts` | - |
| P0041 | Implemented | Slow and failed retrieval are honest with Retry, incl. Listen details and inspector checks | `pnpm exec vitest run src/views/polish-loading.test.tsx`: 3/3 | - |
| P0042 | Implemented | Immediate, delayed, partial, failed/retried, stale and out-of-order answers recorded frame by frame: no placeholder after content, no older answer shown, one placeholder per wait, one announcement | `pnpm exec vitest run src/ui/polishReveal.test.tsx src/ui/polishTimelineSkeleton.test.tsx src/ui/skeletonHonesty.test.tsx` (slot lock, 1 worker): 15/15 passed 2026-11-11; `async.test.tsx`, `gp-0257-comfort.test.tsx` 2026-11-10 | - |
| P0043 | Implemented | Controls above the list never move and the placeholder holds the list's place; focus, scroll and selection survive refresh; busy labels keep button width | `polish-p0033-library-skeleton-modes.e2e.ts` 3/3 and MP-0297-01..05 passed in Edge 2026-11-12; MP-0297 in CI run 43119473767 | Independent review |

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
| P0060 | Implemented | Building/switching while playing, failures, stale answers, Undo, long names | `Mixes.test.tsx`, `Drafts.test.tsx`; Playwright 2026-11-11, 25/26 passed (MP-0283-07, MP-0286-01/07, MP-0280-04) | - |

## ADR-0041 task evidence (reconciled 2026-11-10, uncommitted working tree)

Implementing history: PR #23 (`84b8b5c`) plus later Stem Studio work (S3-0059, GP-0261, FP-0266, Measured micro-polish MP-0289). Vitest: `Studio.test.tsx`, `StudioSafety.test.tsx`, `gp-0261-studio.test.tsx` and `src/audio/focus.test.tsx` passed in the 16-file run and reruns; new `web/src/views/polishStudioRecovery.test.tsx` 2/2 with `controls.test.tsx` (39/39 across both, `--pool=threads`). Playwright `mp-0289-stem-studio.e2e.ts`: only MP-0289-08 passed; MP-0289-01 to -07 failed because `.studio-cell` did not appear within 60 s on the loaded shared machine (spec also being edited by the micro-polish section). Screenshots: none reviewed by a person.

| Task | Status | Acceptance and result | Automated check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0080 | Implemented | Every cell named for a screen reader; ruler and lane names pinned | MP-0289-01/-03/-06 passed in Edge 2026-11-12 and CI run 43119473767; `Studio.test.tsx` 2026-11-11 | Independent review |
| P0081 | Implemented | Played square marked; focused square kept clear of pinned ruler/names (`.studio-grid` scroll-padding) | MP-0289-02 passed in Edge 2026-11-12 and CI run 43119473767; `Studio.test.tsx`, `StudioSafety.test.tsx`, `useStickyClearance.test.tsx` 2026-11-11 | Independent review |
| P0082 | Verified (automated) | Preparing shows an estimate and keeps polling; failure named with Try again that reloads the same pair; missing stems marked unavailable | `polishStudioRecovery.test.tsx` P0082; `Studio.test.tsx` estimate, polling, failure words, missing stem; `StudioSafety.test.tsx` stem could not load | - |
| P0083 | Verified (automated) | Studio says previewing pauses the main mix; play pauses it, Stop leaves it paused (the hint tells the person to resume from the main player); close and hidden tab release audio; failure gives the sound back | `polishStudioRecovery.test.tsx` P0083; `Studio.test.tsx` play/stop, close, hidden tab; `focus.test.tsx` 12 tests | Audible confirmation is P0088 |
| P0084 | Implemented | Visual and verbal separation of preview, arrange, fine-tune, restore, reset and Apply | MP-0289-04/-05 passed in Edge 2026-11-12 and CI run 43119473767; `Studio.test.tsx` 2026-11-11 | Independent review |
| P0085 | Verified (automated) | Working copy vs applied state said plainly; numbered pair named; save, failure and restore states shown | `StudioSafety.test.tsx` 8/8; `Studio.test.tsx` numbered pair, Apply, recovery | - |
| P0086 | Verified (automated) | Failed Apply keeps local work; recovery rejects wrong-size or corrupt copies; storage-blocked warning | `StudioSafety.test.tsx`; `Studio.test.tsx`; Playwright MP-0289-08 passed | - |
| P0087 | Open (Needs a person) | Keyboard reaches all 512 cells | `gp-0261-studio.test.tsx` 2/2 | Real touch device at narrow width; MP-0289-06 |
| P0088 | Open (Needs a person) | Automated pair-keeping path passes | MP-0289-08 | Audible real-stem audition evidence |

## ADR-0046 task evidence (reconciled 2026-11-10, uncommitted working tree)

P0141 is ticked (rollback check with ratings, 2026-11-11); every other task needs a full candidate run, recorded hardware, real audio, participants or owner disposition. Automated facts gathered on 2026-11-10:

| Task | Status | Result | Check run 2026-11-10 | Remaining |
|---|---|---|---|---|
| P0132 | Implemented (Needs a person) | `web/e2e/polish-p0132-baselines.e2e.ts`: candidate PNGs plus `candidate-not-independently-verified` manifests for every PAGES route and Library loading/empty/failed/recovered, light and dark, 375 and 1440px; fixed clock, reduced motion, documented masks | 8/8 passed in Edge 2026-11-12 and CI run 43119473767; `test_flow_screenshot_approval.py` 4/4 | Needs a person: approve and commit the baseline set, then P0133 review |
| P0133 | Open (Needs a person) | - | - | Named reviewer compares differences |
| P0134 | Verified (automated) | Full frontend, backend, browser, flag-sweep and file-length checks green without weakened assertions | CI run 43123598913 on main `fcf745f` (PR #55 merge), 15 jobs green, Edge E2E 539 passed, 2026-11-12 | - |
| P0135 | Open (Needs a person) | - | - | Traces on recorded hardware |
| P0136 | Open (built; one budget miss, PF-21) | Budgets, method and lab-versus-field rule in `docs/adr/completion/performance.md`; shared measurement code `web/e2e/perf-probe.ts` `vitalsSince` and `web/e2e/vitals.ts` (also used by MP-0298-06 and SF-0235-02) | `web/e2e/vitals.test.ts`; `web/e2e/p0136-responsiveness.e2e.ts` ran 2026-11-12: five surfaces inside budget, first Play on Listen INP 648 and 360 ms | Owner decision on PF-21, then a green lab run on a quiet machine |
| P0137 | Open (Needs a person) | - | - | Actual audio evidence |
| P0138 | Implemented | Six integrated scenarios P0138-01 to -06 (disconnect/reconnect, stale response, failed render, failed save, missing source, export recovery) in `web/e2e/integration.e2e.ts` | `web/e2e/integration.e2e.ts` describe 'P0138 integrated failure and recovery', 6/6 passed together twice 2026-11-12 (dist-r7b) | Independent review |
| P0139 | Open (Needs a person) | - | - | Unguided participant tasks |
| P0140 | Open (Needs a person) | - | - | Owner blocker review |
| P0141 | Implemented | Rollback to `main` (`405cf7f`) and forward again: "nothing lost"; songs, steering, mix, seam settings, drafts, corrected tempo, export record, requests, ratings (liked 1, disliked 1) and rated seams identical | `.venv\Scripts\python tests/rollback_check.py <git archive main src>` under the slot lock, exit 0, 2026-11-11 | - |
| P0142 | Open | Section entries updated; every task has an entry (P0009); inherited mapping in `completion/t-to-p-map.md`; header links PR #23, merged PR #55 (`fcf745f`, CI run 43123598913) and open PR #56 | - | PR #56 merge and its CI run link |
| P0143 | Open (Needs a person) | - | - | Release-candidate review and owner disposition |

## ADR-0039 task evidence (reconciled 2026-11-10/11, uncommitted working tree)

| Task | Status | Acceptance and result | Automated check run | Remaining |
|---|---|---|---|---|
| P0061 | Implemented | Identity, transport, next song first; view options disclosed and remembered | `Now.test.tsx` with `NowFlow`, `listenSeek`, `player` 79 passed (2026-11-10) | - |
| P0062 | Implemented | Transport stable across states | Playwright 2026-11-11, 25/26 passed (MP-0284-02, MP-0281-03) | - |
| P0063 | Implemented | Next song vs Jump to the transition in label, icon, tooltip, help | `polishPhase03Listen.test.tsx` P0063 | - |
| P0064 | Implemented | Missing, untimed, instrumental, no beat grid, failed details, last song | `lyricHonesty.test.tsx` 4/4, `Now.test.tsx`, `polishPhase03Listen.test.tsx` P0064 | - |
| P0065 | Implemented | Next-song changes never move the transport; made/planned said | Playwright 2026-11-11, 25/26 passed (MP-0281-03, MP-0284-05); `listenNextUp.test.tsx` 3/3 | - |
| P0066 | Implemented | New spec: seek, seam marker and countdown units in words at 100/200/400% | Playwright 2026-11-11, 25/26 passed (`polish-p0066-listen-zoom.e2e.ts`) | - |
| P0067 | Implemented | Rail, phone bar, mini-player, overlays and focus | Playwright 2026-11-11, 25/26 passed (MP-0280-06/07, MP-0281-05..08, finishing overlap) | - |
| P0068 | Implemented | Fullscreen refusal, restored preferences, reduced motion | Playwright 2026-11-11, 25/26 passed (finishing fullscreen refused + reduced motion, listen fullscreen, MP-0284-07/08) | - |
| P0069 | Open (Needs a person) | Automated parts pass except media keys (timed out waiting for renders under load) | Playwright 2026-11-11, 25/26 passed (MP-0280-07, one tab plays) | Installed-app layout and hardware media keys by a person; rerun media keys |

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
| P0103 | Verified (automated) | Query, filter, page depth, scroll position, typed values and opener focus survive details, a refused value, a failed save and the way back | `polish-p0103-scroll.e2e.ts` (2 tests) and MP-0291-06 passed in CI run 43123598913 (job 130871012003); `polish-p0103-p0104.test.tsx`, `Library.test.tsx`, `LibraryLx.test.tsx` (vitest) passed 2026-11-12 | - |
| P0104 | Verified (automated) | 20,000-song library pages 100 rows at a time without remounting shown rows; search keeps focus; no jump | MP-0291-07 passed in CI run 43123598913 (job 130871012003); `polish-p0103-p0104.test.tsx` and `LibraryLx.test.tsx` LX-0345-07 (vitest) passed 2026-11-12 | Hardware timing is P0135 |
| P0105 | Verified (automated) | Overview leads with repairs; sections share one rhythm; keyboard repair path | `Workshop.test.tsx`; MP-0293-01/02/05/07/08 | MP-0293-03/04/06 layout checks failing |
| P0106 | Verified (automated) | Control gallery only in development (or VITE_SELECTA_GALLERY=1) builds, folded under Diagnostics | new `web/src/views/polishWorkshopShowcase.test.tsx` P0106 (2); production bundle `dist-saas-p3/assets/*.js` has 0 `control-gallery` | - |
| P0107 | Verified (automated) | Budget, cache, free disk and untouched music named apart; refused save shows the confirmed limit and Retry; older save never overrides a newer choice | `polishWorkshopShowcase.test.tsx` P0107/P0111 (3); `Workshop.test.tsx` protected stems, really-saved value | MP-0293-04 geometry failing |
| P0108 | Verified (automated) | Export stages named distinctly; file offered only when it exists; snapshot pinned to the exact mix and revision; cancel only while waiting; job survives restart | `.venv\Scripts\python -m pytest tests/test_export_validation.py tests/test_export_retry.py tests/test_flow_export_jobs.py tests/test_diagnostics_operations.py tests/test_scan.py::test_an_unplugged_drive_has_not_changed tests/test_request_routes.py::test_an_unplugged_folder_loses_nothing tests/test_mix_mixes.py::test_storage_says_what_can_be_remade_and_keeps_the_limit_possible tests/test_mix_mixes.py::test_cache_pruning_keeps_stems_for_priority_songs_even_over_budget tests/test_s4_folder_input.py tests/test_listening.py -q -p no:cacheprovider` 45 passed; `ExportJobs.test.tsx`; `Mix.test.tsx` "saving as a file"; MP-0294-01 | MP-0294-02/03/04 row-geometry check failed |
| P0109 | Verified (automated) | A finished FLAC is decoded frame by frame and a wrong or bad file can never be reported ready; retry keeps the same snapshot; a failed transition names its pair | same pytest run (`test_export_validation.py`, `test_export_retry.py`, `test_flow_export_jobs.py`); `Mix.test.tsx` "says so if what's left can't be made" | Listening to an exported file is P0137 |
| P0110 | Verified (automated) | Unfinished answers restored per study; failed save stays on its trial; both versions must be heard; nothing unblinds | `Listening.test.tsx` 5/5; `ListeningStudyFlow.test.tsx`; `tests/test_listening.py`; MP-0294-07, MP-0294-08 | MP-0294-05/06 layout checks failed |
| P0111 | Verified (automated) | Unplugged folders lose nothing; worker stop/restart and storage-limit blocks reported; full disk named; stale storage writes ignored; diagnostics carry no paths | same pytest run (45 passed); `polishWorkshopShowcase.test.tsx` stale write; `Workshop.test.tsx` diagnostics | - |

## ADR-0045 task evidence (reconciled 2026-11-10/11, uncommitted working tree)

All runs are Edge (Chromium) on the shared Windows laptop and are simulated, not real-device. Playwright `mp-0298-responsive-and-a11y.e2e.ts` on 2026-11-10: MP-0298-01, -03, -05, -07 passed; -02 and -06 failed. 2026-11-11 rerun: both `flow-forced-colors.e2e.ts` tests failed, and 5 of 6 `integration.e2e.ts` tests that ran failed under heavy load. The rerun was stopped before `motion-preference`, `overlay-arbitration`, `mp-0287`, `mp-0288` and `mp-0289` ran.

| Task | Status | Acceptance and result | Automated check | Remaining |
|---|---|---|---|---|
| P0121 | Open (Needs a person) | - | - | Owner agrees support matrix |
| P0122 | Open (Needs a person) | 320 to 3840px, both sides of 620/760 and short landscape hold | MP-0298-01 passed | Safe areas and virtual keyboards on real devices |
| P0123 | Open (Needs a person) | Emulated zoom spec failed | MP-0298-02 failed | Real 200%/400% browser zoom and text resizing |
| P0124 | Verified (automated) | Every target is at least 24px or a documented WCAG exception; primary touch targets reach 44px | MP-0298-03 passed | - |
| P0125 | Verified (automated) | Text 4.5:1, large 3:1, field edges 3:1 in both themes; status has words and a drawn mark; forced-colour focus ring stays apart from selection | MP-0298-05, both `flow-forced-colors.e2e.ts` tests and MP-0287-04 passed 2026-11-12 (Edge, port 8961); forced colours also green in CI run 43123598913; `polish-p0125-nontext.test.tsx` (vitest) passed | - |
| P0126 | Open (Needs a person) | Automated keyboard parts pass | `ListeningStudyFlow.test.tsx`, `gp-0261-studio.test.tsx`, MP-0293-08 | Full manual keyboard-only journeys |
| P0127 | Verified (automated) | Sliders, seek, energy arc, tabs, grid and resize separator follow their keyboard and value patterns | `listenSeek.test.tsx`, `Mixes.test.tsx`, `ufSeamInspector.test.tsx`, `polish-components.test.tsx`, `Studio.test.tsx`, `gp-0261-studio.test.tsx`, `inspectorResize.test.tsx`, `Workshop.test.tsx` (vitest, passed) | - |
| P0128 | Open (Needs a person) | - | - | NVDA and VoiceOver journeys |
| P0129 | Implemented | - | MP-0288-06 failed | Rerun overlay-arbitration on a quiet machine |
| P0130 | Implemented | RTL/CJK/duplicate names readable | `Mix.test.tsx` metadata stress test | Forced colours failed; motion spec not run |
| P0131 | Open (in progress) | Failures classified per surface in the P0007 findings register (PF-01 to PF-21); PF-02, PF-05, PF-09, PF-10 and PF-20 resolved; PF-21 added 2026-11-12 | `test_polish_governance.py` P0007 test, passed 2026-11-12 | Resolve open findings on quiet reruns; human checks pending |

## P0007 findings register (2026-11-11)

Classifies every failure or gap recorded above, plus the copy findings in [completion/copy-audit.md](completion/copy-audit.md), as **P0** (integrity or essential-access blocker), **P1** (task, recovery or misleading-state problem) or **P2** (consistency or detail defect), each with a location, impact and acceptance check. Checked by `tests/test_polish_governance.py::test_p0007_findings_register_classifies_every_finding`. "Unconfirmed" means the only evidence is a failed run on the overloaded shared laptop: the failure stays recorded at the severity it would have if real. A finding closes only when its check passes and the run is named here. Human checks are not findings; they stay pending on their own lines (P0121-P0123, P0126, P0128, P0133, P0135, P0137, P0139, P0140, P0143). Inherited T work is mapped in [completion/t-to-p-map.md](completion/t-to-p-map.md) (P0005).

| ID | Severity | Surface / location | Finding | Impact | Acceptance check | Status | Tasks |
|---|---|---|---|---|---|---|---|
| PF-01 | P0 | Edit inspector sheet at 320px, `web/src/views/Mix.tsx` | MP-0288-06 failed: the narrow sheet or resized rail may cover the call to action or focus | Keyboard users could lose sight of focus (WCAG 2.4.11) | `web/e2e/mp-0288-seam-inspector.e2e.ts` MP-0288-06 | Open, unconfirmed (2026-11-10) | P0074, P0129 |
| PF-02 | P0 | Forced colours, `web/src/styles/polish.css` | Both forced-colour tests failed on 2026-11-11 | Focus or selection could vanish in high contrast | `web/e2e/flow-forced-colors.e2e.ts` | Resolved 2026-11-12: both passed locally (port 8961) and in CI run 43123598913 | P0125, P0130 |
| PF-03 | P0 | Browser zoom, app-wide | Emulated 200%/400% zoom MP-0298-02 failed | Content could be cut off when zoomed | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` MP-0298-02 | Open, unconfirmed (2026-11-10) | P0123 |
| PF-04 | P0 | Edit undo scope, `web/src/views/Mix.tsx` | Draft-while-current-plays Undo test timed out | If real, Undo could act on the wrong mix | `web/e2e/integration.e2e.ts` Undo scope test; `web/src/views/Mix.test.tsx` scope tests pass | Open, unconfirmed: on 2026-11-12 it failed again in `allRendered` (no transition rendered within 280 s on the loaded laptop), before reaching the Undo checks | P0073, P0078, P0138 |
| PF-05 | P0 | Rollback, `tests/rollback_check.py` | Ratings were not proven to survive a rollback | Good/Bad ratings could be lost unnoticed | `tests/rollback_check.py` against `main` | Resolved 2026-11-11: "nothing lost", ratings and rated seams identical | P0141 |
| PF-06 | P1 | Edit pinned bar, `web/src/views/Mix.tsx` | MP-0287-07 failed: name, current/draft and view may scroll away | People may lose which mix they edit | `web/e2e/mp-0287-editor-rows.e2e.ts` MP-0287-07 | Open, unconfirmed | P0070 |
| PF-07 | P1 | Edit reorder at 320px, `web/src/views/EditorRows.tsx` | MP-0287-03 failed: keyboard and drag move at 320px | Reordering may be hard on a phone | `web/e2e/mp-0287-editor-rows.e2e.ts` MP-0287-03 | Open, unconfirmed | P0073 |
| PF-08 | P1 | Stem Studio grid, `web/src/views/Studio.tsx` | MP-0289-01 to -07 failed: `.studio-cell` never appeared in 60 s | Labels, states and narrow width unmeasured | `web/e2e/mp-0289-stem-studio.e2e.ts` MP-0289-01 to -07 | Open, unconfirmed | P0080, P0081, P0084, P0087 |
| PF-09 | P1 | Library correction, `web/src/views/Library.tsx` | MP-0291-06 failed: correction, error and the way back | Query or focus may be lost after an error | `web/e2e/mp-0291-library.e2e.ts` MP-0291-06 | Resolved 2026-11-12: passed in CI run 43123598913 | P0103 |
| PF-10 | P1 | Library at 20,000 songs, `web/src/views/Library.tsx` | MP-0291-07 failed | Large libraries may jump | `web/e2e/mp-0291-library.e2e.ts` MP-0291-07 | Resolved 2026-11-12: passed in CI run 43123598913 | P0104 |
| PF-11 | P1 | Background refresh, `web/src/state/async.ts` | MP-0297-03 failed: selection, focus, playback through a refresh | A refresh could move focus | `web/e2e/mp-0297-loading-and-recovery.e2e.ts` MP-0297-03 | Open, unconfirmed | P0037, P0043 |
| PF-12 | P1 | Integrated recovery, `web/e2e/integration.e2e.ts` | Two draft/current scenarios timed out | Recovery not proven end to end | `web/e2e/integration.e2e.ts` | Open: the P0138 scenarios now pass (6/6, 2026-11-12); the older draft/current tests failed at `allRendered` (renders not finished in 280 s on the loaded laptop) | P0138 |
| PF-13 | P2 | Placeholders, `web/src/ui/Skeleton.tsx` | MP-0297-01 failed: placeholder vs loaded geometry | Content may shift on arrival | `web/e2e/mp-0297-loading-and-recovery.e2e.ts` MP-0297-01, `polish-p0032-p0036-skeleton-geometry.e2e.ts`, `polish-p0033-library-skeleton-modes.e2e.ts` | Fixed 2026-11-12 (all passed in Edge) | P0032, P0033, P0034, P0036, P0043 |
| PF-14 | P2 | Edit timeline placeholder, `web/src/ui/Skeleton.tsx` | Opening a draft showed generic bars, not song rows with transitions between them | Timeline jumped from bars to rows | `web/src/ui/polishTimelineSkeleton.test.tsx`; `web/e2e/polish-p0035-timeline-skeleton.e2e.ts` | Built 2026-11-11; browser geometry pending | P0035 |
| PF-15 | P2 | Edit row marks, `web/src/views/EditorRows.tsx` | MP-0287-04 failed: selected, focused, locked, playing, pending marks | Marks may be ambiguous | `web/e2e/mp-0287-editor-rows.e2e.ts` MP-0287-04 | Open, unconfirmed | P0071 |
| PF-16 | P2 | Component states, `web/src/ui/ControlGallery.tsx` | MP-0279-02/03/04/06/07 failed | State styles may differ between families | `web/e2e/mp-0279-component-gallery.e2e.ts` | Open, unconfirmed | P0022 |
| PF-17 | P2 | Lab budgets | MP-0298-06 failed: layout shift, paint, interaction delay | Budgets not reported green | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` MP-0298-06 | Open, unconfirmed | P0136 |
| PF-18 | P2 | Short-load reveal, `web/src/ui/Skeleton.tsx` | No measurement showed a quick answer never flashes a placeholder | Possible flicker on fast loads | `web/src/ui/polishReveal.test.tsx`; `web/e2e/polish-p0038-reveal.e2e.ts` | Built 2026-11-11; browser measurement pending | P0038, P0042 |
| PF-19 | P2 | Visual baselines, `web/e2e/visual.e2e.ts` | Review candidates only; no committed pixel baselines | Visual regressions caught only by people | `web/e2e/polish-p0132-baselines.e2e.ts` | Built 2026-11-11; baselines not yet generated | P0132, P0133 |
| PF-20 | P2 | Copy, `docs/adr/completion/copy-audit.md` | Copy findings, each with a severity, fixed in the audit | Inconsistent words | `web/src/ui/Glossary.test.tsx`, `web/src/shell/actionTierRegister.test.ts` | Resolved (P0113, 2026-11-10) | P0113 |
| PF-21 | P1 | First Play press, `web/src/player.ts` `audio()` | The first Play creates the AudioContext inside the click handler; on the shared laptop `new AudioContext` took 0.6 to 2.2 s synchronously (one long animation frame blamed on the root click handler), so the first Play's INP was 648 to 2208 ms while every other measured interaction stayed at 96 ms or less | The first press of Play freezes the page before Loading song shows | `web/e2e/p0136-responsiveness.e2e.ts` (report field `audio_context_open_ms`) | Open (2026-11-12): not fixed; the context has to open inside the press for browsers that allow sound only then, so a fix (for example showing Loading song before opening it, or opening it on an earlier gesture) is an audio-ownership change for the owner to approve, and the time must also be checked on a quiet machine with real speakers | P0136 |
