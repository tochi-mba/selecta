# ADR-0096: First-run folder import, analysis readiness and time to first valid play

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 3 Listener
- **Extends, does not automatically supersede:** ADR-0053, ADR-0037, ADR-0081
- **Source surfaces to reconcile:** `web/src/views/Start.tsx`; `web/src/views/Setup.tsx`; `src/selecta/routes/library.py`
- **Tasks:** S4-0096-01 through S4-0096-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A browser chooser cannot necessarily give the local backend a usable filesystem path. First-run success depends on platform-accurate guidance, specific validation and an honest six-ready-song milestone.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Keep three conceptual stages—Add your music, Prepare library, Play first mix—with streamlined copy and clearly represented partial preparation. Preserve existing secure folder-path and metadata disclosure semantics.

## Experience, frontend and interaction specification

- Provide Windows File Explorer steps and pasteable folder path with clear example and quoting normalization.
- Never fake a native folder picker unless a separately reviewed trusted native/server capability exists.
- Show ready count versus six, analysing count, blockers, source name and first-play CTA without implying all processing is complete.
- Retain original-file safety, local-first promise and specific LRCLIB metadata disclosure.

## Detailed implementation work — all Not started

1. **S4-0096-01 — Redesign welcome hierarchy and path entry guidance.** Acceptance: New user can supply backend-usable path without guessing. Required verification: Unassisted Windows/Edge task and 320px screenshots. **Implementation: Not started; Verified: No.**
2. **S4-0096-02 — Specify path parsing/quoting/normalization and validation copy.** Acceptance: Input preserved on missing/invalid/unreadable path. Required verification: Quote, space, UNC, Unicode, file-versus-folder tests. **Implementation: Not started; Verified: No.**
3. **S4-0096-03 — Preserve existing source validation and safety.** Acceptance: No input path escapes backend permissions/origin policy. Required verification: Python/API security and filesystem fixture tests. **Implementation: Not started; Verified: No.**
4. **S4-0096-04 — Design accurate scanning and partial-progress states.** Acceptance: Scan started only after backend acceptance; cancelled != lost. Required verification: Delayed/failed/cancel/reload scan E2E. **Implementation: Not started; Verified: No.**
5. **S4-0096-05 — Represent readiness threshold precisely at 5/6/7 tracks.** Acceptance: First-play enabled at valid minimum, not full-library completion. Required verification: Fixture count and unsuitable-ready-song tests. **Implementation: Not started; Verified: No.**
6. **S4-0096-06 — Surface specific blockers and recovery actions.** Acceptance: Disconnected drive and failed analysis lead to helpful next step. Required verification: Permission, drive disconnect, zero supported music tests. **Implementation: Not started; Verified: No.**
7. **S4-0096-07 — Preserve lyric privacy and error-isolated lyric lookup.** Acceptance: Lyric outage does not falsely block all music. Required verification: Mock unavailable LRCLIB, disclosure review. **Implementation: Not started; Verified: No.**
8. **S4-0096-08 — Handle server restarts and browser reload during preparation.** Acceptance: No duplicate scan and accurate recovered counts. Required verification: Restart/reload fault tests. **Implementation: Not started; Verified: No.**
9. **S4-0096-09 — Design first mix with one primary gesture and optional customization.** Acceptance: First play is obvious but no automatic unexpected audio. Required verification: Real browser gesture and first-run usability. **Implementation: Not started; Verified: No.**
10. **S4-0096-10 — Record time-to-first-valid-play baseline and follow-up.** Acceptance: Only observed sessions establish improvement. Required verification: Listener task log and evidence. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Exactly six tracks may be counted ready but mix selection may still have musical constraints; UI must convey actual eligibility.
- Browser localStorage denied or backend unavailable; do not lose entered data unexpectedly.
- Path handling differs between local filesystem and network-share paths; don't invent support.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Explicit path entry is less visually modern than a fake picker but truthful for the current local-server architecture.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0096 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
