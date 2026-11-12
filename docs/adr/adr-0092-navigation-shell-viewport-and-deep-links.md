# ADR-0092: Responsive navigation shell, optional inspector, global header and route integrity

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 9/10 Implemented, 1 In progress (per-task source and test reconciliation 2026-11-10; updated 2026-11-11)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 2 Shell
- **Extends, does not automatically supersede:** ADR-0002, ADR-0048, ADR-0049, ADR-0078, ADR-0082
- **Source surfaces to reconcile:** `web/src/App.tsx`; `web/src/shell/*`; `web/src/router.ts`; `web/src/styles/shell.css`
- **Tasks:** S4-0092-01 through S4-0092-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Listen, Explore, My Mixes, Library and Workspace need a predictable shared frame without forcing every page into the same density. Current /listen-empty fallback can render Explore under a Listen route.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Preserve the conceptual destinations and existing URLs; build a desktop rail, responsive context header, optional resizable inspector, contextual mini-player and mobile bottom navigation. Treat viewport/safe-area/keyboard geometry centrally.

## Experience, frontend and interaction specification

- Desktop rail approximately 224–240px expanded and 68–72px collapsed; core content remains fluid.
- Mobile bottom destinations Listen, Explore, Mixes, Library, More (Workspace visible within More).
- Inspector present only for relevant selection; large-screen resize has pointer and keyboard alternatives.
- /listen without an active mix displays a true Listen empty state linking to Explore; no silent route/content mismatch.

## Detailed implementation work

1. **S4-0092-01 - Inventory deep links, aliases, search params and browser history.** Acceptance: All current routes still load directly and Back/Forward restores context. Required verification: Router E2E for old paths and query combinations. **Implementation: Implemented (2026-11-10). Evidence: `web/src/router.test.tsx` (every address leads back, Back, filters in the address); `web/e2e/pages.e2e.ts` 'reloading any page stays on it', 'Back and Forward go where they should', 'the Library's filters are part of its address', run 2026-11-10. Verified: No.**
2. **S4-0092-02 - Implement desktop rail with active and focus identity.** Acceptance: Nested edits retain their correct parent nav destination. Required verification: Keyboard navigation, collapsed rail and screen reader current-page. **Implementation: Implemented (2026-11-10). Evidence: `web/src/shell/Shell.test.tsx` 'marks where you are', 'marks My Mixes as the parent while a mix is being edited', 'collapses the rail with every place still named', run 2026-11-10. Verified: No. Needs a person: screen reader current-page check.** Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
3. **S4-0092-03 - Implement mobile bottom navigation and Workspace under More.** Acceptance: Essential services and blockers remain discoverable. Required verification: 320/375/390/430px and orientation tests. **Implementation: Implemented (2026-11-10). Evidence: More drawer in `web/src/shell/Shell.tsx`; `web/src/flags.test.tsx` 'keeps a Workspace tab while anything is left in it'; `web/e2e/finishing.e2e.ts` 'the mini-player and bottom bar never overlap'; `web/e2e/pages.e2e.ts` phone checks, run 2026-11-10. Verified: No. Needs a person: orientation check on a real phone.**
4. **S4-0092-04 - Build contextual header with bounded global utilities.** Acceptance: No redundant button flood; breadcrumb/title reflect actual route. Required verification: Header action audit on all routes. **Implementation: Implemented (2026-11-10). Evidence: `web/src/shell/Shell.test.tsx` 'names the page in the title and the breadcrumb, with its parent one step back', run 2026-11-10. Verified: No.**
5. **S4-0092-05 - Create optional inspector region and accessible resize controls.** Acceptance: Resize persists safely; timeline retains usable minimum width. Required verification: Pointer/keyboard resize, 200/400% zoom. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.tsx` separator with pointer and keyboard resize, clamped 320-520px and saved; first-visit default fixed to 380px; new `web/src/views/inspectorResize.test.tsx` (5 tests) passed 2026-11-10. Verified: No. Needs a person: 200/400% zoom check.** Verified: Claude (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
6. **S4-0092-06 - Centralize sticky chrome/safe-area/visual-viewport calculations.** Acceptance: Player and nav do not cover last list row or focused input. Required verification: Mobile keyboard/short viewport/landscape tests. **Implementation: Implemented (2026-11-10). Evidence: visual-viewport keyboard handling in `web/src/shell/Shell.tsx`; `web/src/shell/Shell.test.tsx` 'only yields chrome to a real editor keyboard'; `web/src/styles/optical-alignment.test.ts` 'publishes the bar height from the shell'; `web/e2e/finishing.e2e.ts` 'with an on-screen keyboard up, what's being typed gets the room'; `web/e2e/pages.e2e.ts` 'on a phone, nothing you can press sits half hidden behind the player', run 2026-11-10. Verified: No. Needs a person: real mobile keyboard and landscape check.**
7. **S4-0092-07 - Preserve per-route selection and scroll where safe by stable ID.** Acceptance: Returning from Library to editor restores same valid transition. Required verification: Back/Forward and removal invalidation tests. **Implementation: Implemented (2026-11-11). Evidence: `web/src/views/s4SelectionRoundTrip.test.tsx` 'coming back from Library reopens the same transition', 'follows the pair when a song was added in front of it while away', 'a transition removed while away is not replaced by its neighbour'; `web/src/views/Mix.test.tsx` 'keeps each mix scope's exact selection separate', run 2026-11-11 (vitest, passed). Verified: No.**
8. **S4-0092-08 - Remove content/route ambiguity on empty Listen.** Acceptance: Route, heading and selected nav match visible content. Required verification: No-current-mix deep-link test. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/ListenEmpty.tsx`; `web/src/App.test.tsx` 'says so rather than showing an empty mix in silence', run 2026-11-10. Verified: No.**
9. **S4-0092-09 - Make status and task blockers available without Workspace clutter.** Acceptance: Critical storage/analysis blocker cannot be hidden in More. Required verification: Attention indicator and accessible announcement tests. **Implementation: In progress (2026-11-10). Evidence: `web/src/shell/Shell.test.tsx` 'says so across the top, and what's on screen stays' (offline); storage and analysis blockers outside Workspace are not yet asserted. Verified: No. Needs a person: accessible announcement check.** Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
10. **S4-0092-10 - Validate standalone PWA, browser tab and reload shell geometry.** Acceptance: No false offline-without-server promise and no state loss. Required verification: Installed Edge and server-disconnected checks. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/pages.e2e.ts` 'the app can be installed: its manifest and icons are all there'; `web/src/RuntimeApp.test.tsx` 'picks up by itself when a server that wasn't there starts'; `web/src/shell/Shell.test.tsx` 'says so plainly if it was never there at all', run 2026-11-10. Verified: No. Needs a person: installed Edge PWA with the server disconnected.**

## Required negative cases and regression strategy

- Small-height landscape, on-screen keyboard, 320px width, safe areas, high zoom, long breadcrumbs.
- Selection removed by concurrent edit; restore focus to a safe surviving item.
- Theme/density/nav changes cannot remount player.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Mobile uses a shorter 'More' label for Workspace but must not bury urgent operational issues.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0092 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 8/10 Implemented, 2 In progress | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
