# ADR-0092: Responsive navigation shell, optional inspector, global header and route integrity

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
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

## Detailed implementation work — all Not started

1. **S4-0092-01 — Inventory deep links, aliases, search params and browser history.** Acceptance: All current routes still load directly and Back/Forward restores context. Required verification: Router E2E for old paths and query combinations. **Implementation: Not started; Verified: No.**
2. **S4-0092-02 — Implement desktop rail with active and focus identity.** Acceptance: Nested edits retain their correct parent nav destination. Required verification: Keyboard navigation, collapsed rail and screen reader current-page. **Implementation: Not started; Verified: No.**
3. **S4-0092-03 — Implement mobile bottom navigation and Workspace under More.** Acceptance: Essential services and blockers remain discoverable. Required verification: 320/375/390/430px and orientation tests. **Implementation: Not started; Verified: No.**
4. **S4-0092-04 — Build contextual header with bounded global utilities.** Acceptance: No redundant button flood; breadcrumb/title reflect actual route. Required verification: Header action audit on all routes. **Implementation: Not started; Verified: No.**
5. **S4-0092-05 — Create optional inspector region and accessible resize controls.** Acceptance: Resize persists safely; timeline retains usable minimum width. Required verification: Pointer/keyboard resize, 200/400% zoom. **Implementation: Not started; Verified: No.**
6. **S4-0092-06 — Centralize sticky chrome/safe-area/visual-viewport calculations.** Acceptance: Player and nav do not cover last list row or focused input. Required verification: Mobile keyboard/short viewport/landscape tests. **Implementation: Not started; Verified: No.**
7. **S4-0092-07 — Preserve per-route selection and scroll where safe by stable ID.** Acceptance: Returning from Library to editor restores same valid transition. Required verification: Back/Forward and removal invalidation tests. **Implementation: Not started; Verified: No.**
8. **S4-0092-08 — Remove content/route ambiguity on empty Listen.** Acceptance: Route, heading and selected nav match visible content. Required verification: No-current-mix deep-link test. **Implementation: Not started; Verified: No.**
9. **S4-0092-09 — Make status and task blockers available without Workspace clutter.** Acceptance: Critical storage/analysis blocker cannot be hidden in More. Required verification: Attention indicator and accessible announcement tests. **Implementation: Not started; Verified: No.**
10. **S4-0092-10 — Validate standalone PWA, browser tab and reload shell geometry.** Acceptance: No false offline-without-server promise and no state loss. Required verification: Installed Edge and server-disconnected checks. **Implementation: Not started; Verified: No.**

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

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
