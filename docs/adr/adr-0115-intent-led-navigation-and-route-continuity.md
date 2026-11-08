# ADR-0115 — Intent-led navigation, route continuity and entry context

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/5 new tasks implemented).
- **Independent verification:** No (0/5).
- **Programme/date:** Experience-first UI/UX; 2026-11-07; baseline `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Priority / phase:** P0 / Structure.
- **Related:** ADR-0092, ADR-0093, ADR-0099; no automatic supersession or inherited task completion.
- **Code touchpoints:** `web/src/shell/manifest.ts`, `web/src/shell/Shell.tsx`, `web/src/router.ts`, `web/src/App.tsx`.

## Context and evidence boundary

The existing Listen / Explore / My Mixes / Library / Workspace rail is functional. However Explore also includes the main creative workflow; users may not infer that it means Make a Mix. Utility navigation and creator entry points have substantial overlap. Source inspection is not proof of a rendered UI problem, human task failure or real-audio quality. Existing functionality does not count as implementation of this newly proposed behavior.

## Proposed decision

- Prototype Listen, Make a Mix, My Mixes and Library as the primary intents, with Workspace/Settings lower in prominence; verify the names rather than renaming blindly.
- Use a contextual opening route: return to Listen with a meaningful existing mix/playback context; otherwise present the quickest valid first mix action. Avoid an extra generic dashboard.
- Keep discovery and studio routes discoverable from their creative parents without hiding expert operations.
- Preserve all existing route aliases, query-backed search filters, browser Back/Forward/refresh and accessible command palette semantics.
- Ensure routing, Stage, theme and overlays never remount or restart the shared player.

## Alternatives considered and rationale

The current labels minimize retraining; a new dashboard adds an unnecessary step; a radically new router risks deep-link breaks. Choose a minimal intent-led shell, prototype and test first.

## Consequences, risks and preservation

Naming change is an unverified hypothesis; the implementation must keep old addresses canonical or provide tested aliases and no audio interruption. Preserve original audio, routes, preferences, local security, current/draft/revision identity, scoped Undo, consented atomic bridges, full Stem Studio controls, blind study and decodable frozen-revision FLAC. No backend/audio/schema changes are implicitly approved.

## Implementation tasks (all Not started / Not verified)

1. **EX-0115-01 — Evaluate navigation terminology.** Acceptance: Uncoached users find Play, create, edit, library and operations. Verification: First-time label and destination task test. **Implementation: Not started; Verified: No.**
2. **EX-0115-02 — Map every route and alias.** Acceptance: Old URLs, search params and deep links retain their meaning. Verification: Browser history/refresh/404 E2E. **Implementation: Not started; Verified: No.**
3. **EX-0115-03 — Specify contextual entry states.** Acceptance: Active, paused, idle and deep-linked entry never redirect incorrectly. Verification: State matrix and real-player tests. **Implementation: Not started; Verified: No.**
4. **EX-0115-04 — Design narrow and keyboard navigation.** Acceptance: Primary and secondary areas reachable at 320px and zoom. Verification: Keyboard/NVDA/400% test. **Implementation: Not started; Verified: No.**
5. **EX-0115-05 — Verify shared audio across navigation.** Acceptance: No remount, double playback or surprise resume. Verification: Real Windows/Edge audio plus overlay races. **Implementation: Not started; Verified: No.**

## Required negative cases and references

Check empty/loading/partial/failed/stale/recovering states, long/RTL/duplicate names, dark/light/system themes, 320–2560px widths, 200/400% zoom, touch, keyboard, reduced motion and real audio where relevant. Preserve tests rather than weakening expectations. [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Microsoft human-AI guidance](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are pattern references, not evidence of Selecta outcomes. Status: [new checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
