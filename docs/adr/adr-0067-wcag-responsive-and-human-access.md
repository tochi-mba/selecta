# ADR-0067: WCAG 2.2 AA, responsive reflow and complete keyboard access

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 — Cross-cutting quality
- **Extends existing decisions:** ADR-0023, ADR-0024, ADR-0045
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0067-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Selecta has custom tabs, timeline, 64-cell Studio grid, persistent player, charts, sliders, tooltips and sheets. Automated axe scans and viewport captures are valuable but cannot prove full keyboard and screen-reader usability.

## Decision proposed

Target WCAG 2.2 AA across essential flows, not just static pages. Support keyboard, touch, speech and screen-reader use, 200%/400% zoom as applicable, orientation and reduced motion. Make dragging alternatives and target sizing first-class constraints.

## Experience and frontend architecture

- Audit contrast, focus not obscured, focus order, accessible names, error association, status announcements and touch/pointer targets. WCAG 2.2 target size minimum is 24x24 CSS px subject to specified exceptions; Selecta should normally aim for larger targets for touch comfort.

- Create accessible navigation for the multi-part shell, dialog focus, lists, waveform slider, editor reorder, Request bridge and Studio grid. Offer non-drag operations for every essential drag action. Zoom reflow must not require two-dimensional scrolling outside inherently 2D workspaces.

- Record manual NVDA/VoiceOver/TalkBack and keyboard passes; an axe scan alone never marks Verified. Ensure localized text and changing announcements do not cause endless live-region noise.

## Detailed implementation work (all Not started)

1. **S3-0067-01 — Not started.** Specify WCAG 2.2 AA inventory for every route/overlay and an applicability matrix with exceptions.
2. **S3-0067-02 — Not started.** Create focus and screen-reader test scripts for first-run, playback, editing, requests, Studio and export.
3. **S3-0067-03 — Not started.** Audit and fix every essential target below 24x24 or without adequate exceptions; choose comfortable 44px-class controls where useful.
4. **S3-0067-04 — Not started.** Ensure non-drag alternatives for reorder and every pointer gesture; include touch switch and keyboard testing.
5. **S3-0067-05 — Not started.** Implement semantic landmark, headings, error association and status announcement contracts.
6. **S3-0067-06 — Not started.** Verify dialogs, sheets, menus, tabs, grid, sliders and waveform against relevant ARIA APG patterns.
7. **S3-0067-07 — Not started.** Test 200%/400% zoom, small viewports, safe areas and visible keyboard focus without hidden controls.
8. **S3-0067-08 — Not started.** Run manual assistive-tech sessions and record device/browser/AT versions and remaining limitations.
9. **S3-0067-09 — Not started.** Preserve reduced-motion and non-color-only statuses in dark/light themes.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Complete primary journeys with keyboard only, NVDA/VoiceOver and supported touch reader.
- Target audit at 320/375 widths, touch controls, editor insertion gaps and overlapping player.
- Zoom 400%, increased text, RTL and focus behind sticky bars, modal scroll traps and tooltip-only content.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Treat accessibility as a final lint pass: lower immediate effort but exposes architecture defects too late. Build it into primitives and every migrated journey.

## Acceptance and evidence

No unverified accessibility blocker remains in an essential flow; verified task evidence exists beyond automated scans.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
