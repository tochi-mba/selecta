# ADR-0049: Responsive shell, persistent player and immersive Stage architecture

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 1 — Architecture
- **Extends existing decisions:** ADR-0002, ADR-0006, ADR-0009, ADR-0024, ADR-0039
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0049-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The current rail, mini-player and bottom navigation rely on multiple media queries. In shell.css a later .mini bottom:0 rule competes with the earlier mobile bottom offset, risking overlap. The shell must remain structurally reliable while the UI becomes more expressive.

## Decision proposed

Use one coordinated shell layout with semantic regions for navigation, route content, global player, contextual header and overlays. On phones, reserve exact space for the player stacked above bottom navigation. Stage is an intentional separate visual presentation that never destroys playback state.

## Experience and frontend architecture

- Define shell geometry through central tokens and layout slots, rather than scattered absolute-position offsets; allow reduced navigation width and responsive content maximums. Stable main-player ownership lives outside screen-specific React lifecycles.

- Mobile uses fixed or sticky stacked chrome with safe-area and visual-viewport awareness. The focused control must never be fully hidden under app chrome or the virtual keyboard. Desktop uses an expanded or collapsed side rail and a fixed transport dock.

- Stage hides routine chrome, handles fullscreen denial, exposes predictable Escape and return behavior, and scales lyrics and upcoming-track context independently of the default Listen page.

## Detailed implementation work (all Not started)

1. **S3-0049-01 — Not started.** Fix and regression-test mini-player/mobile-navigation stacking; remove contradictory bottom declarations rather than adding another override.
2. **S3-0049-02 — Not started.** Specify desktop rail, optional compact rail, header, content and player responsive geometry and z-index stacking.
3. **S3-0049-03 — Not started.** Implement centralized bottom-space, safe-area, zoom and keyboard-height handling for fixed chrome and toasts.
4. **S3-0049-04 — Not started.** Separate persistent playback presentation from transport service and route components so route transitions cannot restart audio.
5. **S3-0049-05 — Not started.** Define full-player/mini-player/Stage lifecycle and focus restoration when immersive mode opens or closes.
6. **S3-0049-06 — Not started.** Create deterministic responsive layouts for 320 through 3840px without hidden scroll traps or unreachable actions.
7. **S3-0049-07 — Not started.** Specify collapsed rail tooltips, ARIA names, selected states and persisted layout preference.
8. **S3-0049-08 — Not started.** Audit screen readers, fullscreen failure, multi-tab ownership, PWA installed mode and browser UI resizing.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Pixel/interaction tests at 320, 375, 390, 430, 768, 1024, 1440, 1920 and 3840, zoom 100/200/400% where applicable.
- Focus test with virtual keyboard open: no search field, submit control or selected row is obscured.
- Run real audio during 50 route transitions, Stage toggles and mobile orientation switches; measure zero unintended stops.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep independent fixed bars with CSS offset patches: fastest locally but error-prone across media queries. Use a single coordinated shell that explicitly owns its geometry instead.

## Acceptance and evidence

No overlap, hidden content, focus obscuration or player remount is observed in the supported viewport/installed-app matrix.

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
