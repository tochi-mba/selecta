# ADR-0049: Responsive shell, persistent player and immersive Stage architecture

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 1 - Architecture
- **Extends existing decisions:** ADR-0002, ADR-0006, ADR-0009, ADR-0024, ADR-0039
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The current rail, mini-player and bottom navigation rely on multiple media queries. In shell.css a later .mini bottom:0 rule competes with the earlier mobile bottom offset, risking overlap. The shell must remain structurally reliable while the UI becomes more expressive.

## Decision proposed

Use one coordinated shell layout with semantic regions for navigation, route content, global player, contextual header and overlays. On phones, reserve exact space for the player stacked above bottom navigation. Stage is an intentional separate visual presentation that never destroys playback state.

## Experience and frontend architecture

- Define shell geometry through central tokens and layout slots, rather than scattered absolute-position offsets; allow reduced navigation width and responsive content maximums. Stable main-player ownership lives outside screen-specific React lifecycles.

- Mobile uses fixed or sticky stacked chrome with safe-area and visual-viewport awareness. The focused control must never be fully hidden under app chrome or the virtual keyboard. Desktop uses an expanded or collapsed side rail and a fixed transport dock.

- Stage hides routine chrome, handles fullscreen denial, exposes predictable Escape and return behavior, and scales lyrics and upcoming-track context independently of the default Listen page.

## Detailed implementation work

1. **S3-0049-01 - Implemented.** Fix and regression-test mini-player/mobile-navigation stacking; remove contradictory bottom declarations rather than adding another override. **Evidence:** one geometry in web/src/styles/tokens.css (--nav-bottom, --player-height, --bottom-chrome); web/e2e/finishing.e2e.ts 'the mini-player and bottom bar never overlap, and the last row can always be reached'; web/e2e/pages.e2e.ts 'on a phone, nothing you can press sits half hidden behind the player, at any height' (passed 2026-11-10).
2. **S3-0049-02 - Implemented.** Specify desktop rail, optional compact rail, header, content and player responsive geometry and z-index stacking. **Evidence:** docs/adr/selecta-3-routes.md 'Shell geometry' (rail, header, content, player, stacking order) implemented in web/src/styles/tokens.css and web/src/styles/shell.css; web/e2e/pages.e2e.ts 'nothing goes wider than the window, from the smallest phone to 4K' (passed 2026-11-10).
3. **S3-0049-03 - Implemented.** Implement centralized bottom-space, safe-area, zoom and keyboard-height handling for fixed chrome and toasts. **Evidence:** --bottom-chrome and --keyboard-inset in web/src/styles/tokens.css set by web/src/shell/Shell.tsx; web/src/shell/Shell.test.tsx 'only yields chrome to a real editor keyboard, not pinch zoom or a blurred input'; web/e2e/overlay-arbitration.e2e.ts 'software keyboard makes notification chrome yield without removing notices or the mini-player'; web/e2e/finishing.e2e.ts 'with an on-screen keyboard up, what’s being typed gets the room'; web/e2e/flows.e2e.ts 'focus is never hidden behind the bottom bar on a phone' (passed 2026-11-10).
4. **S3-0049-04 - Implemented.** Separate persistent playback presentation from transport service and route components so route transitions cannot restart audio. **Evidence:** player in web/src/player.ts owned above the routes in web/src/App.tsx; web/src/shell/Shell.test.tsx 'nothing here restarts the music'; web/e2e/listen.e2e.ts 'moving around the app leaves the music alone, and the mini-player follows'; web/e2e/flows.e2e.ts 'music already loaded keeps playing while the server is away' (passed 2026-11-10).
5. **S3-0049-05 - Implemented.** Define full-player/mini-player/Stage lifecycle and focus restoration when immersive mode opens or closes. **Evidence:** web/e2e/finishing.e2e.ts 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops'; web/e2e/listen.e2e.ts 'lyrics follow the song, and the fullscreen view keeps everything working' (passed 2026-11-10).
6. **S3-0049-06 - Implemented.** Create deterministic responsive layouts for 320 through 3840px without hidden scroll traps or unreachable actions. **Evidence:** web/e2e/pages.e2e.ts 'nothing goes wider than the window, from the smallest phone to 4K' and 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go' (passed 2026-11-10).
7. **S3-0049-07 - Implemented.** Specify collapsed rail tooltips, ARIA names, selected states and persisted layout preference. **Evidence:** web/src/shell/Shell.tsx nav-collapse with data-tip names and railCollapsed in web/src/state/prefs.ts; web/src/shell/Shell.test.tsx 'collapses the rail with every place still named, and remembers it after a reload' (passed 2026-11-10).
8. **S3-0049-08 - Needs a person.** Audit screen readers, fullscreen failure, multi-tab ownership, PWA installed mode and browser UI resizing. **Status:** Needs a person: screen-reader and installed-PWA audit on real Chrome/Edge; the automatable parts pass in web/e2e/finishing.e2e.ts 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops', web/e2e/listen.e2e.ts 'only one tab plays at a time' and web/e2e/pages.e2e.ts 'the app can be installed: its manifest and icons are all there'.

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
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 1 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
