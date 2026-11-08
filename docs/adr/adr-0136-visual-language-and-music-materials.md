# ADR-0136 - Visual materials, typography, hierarchy and authentic musical identity

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 8/8 Implemented, 0/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Visual foundation.
- **Related earlier ADRs:** ADR-0090, ADR-0091, ADR-0130; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/styles/tokens.css; web/src/styles/listening.css; web/src/styles/polish.css.

## Context and evidence boundary

The source defines warm charcoal, cream, lime, request blue, warning orange and heavy display type. More decoration is not automatically a better music experience; legibility and meaningful music visuals are the baseline. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Create a visual-materials guide for dark, light and system themes: warm matte surfaces, restrained borders, strong song typography and purposeful accent use.
- Limit the lime attention peak to the primary action/playing or selected state in a given region; use semantic blue for requests and orange for blockers.
- Reserve real album artwork only for verified local metadata/artwork; use a dignified typographic cover/abstract canvas when none exists, never fabricated cover art.
- Specify type overflow for long, multilingual and RTL titles; always preserve full accessible song identity.
- Use music-led hierarchy: song/artist above technical data on Listen, mood above BPM on recommendations, object and scope above metadata in editors.
- Provide spacing and density specimens at 320, 375, 430, 768, 1280, 1440 and 2560 CSS pixels, including zoom and enlarged fonts.

## Interaction choreography and visual behavior

- Surfaces do not continuously shimmer; use a maximum 120 ms contrast/color response for hover and active states.
- Do not animate layout-sensitive type measurements during a song change; crossfade old/new identity only after the song identity actually changes.
- Album-art placeholders are static, legible and non-deceptive; no fake waveform or invented musical cover.
- Light-mode lime remains a filled high-contrast action with dark text, never a thin unreadable lime line on cream.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0136-01 - Audit all semantic tokens.** Acceptance: One owner for palette, surfaces, type, spacing, motion and status meanings. Required verification: Token diff and dark/light/system contrast review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0136-02 - Specify song-title composition.** Acceptance: Long, RTL, emoji and missing metadata render without collision or inaccessible truncation. Required verification: Fixture screenshots and screen reader name checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/shell/Shell.tsx`; `web/src/views/Now.test.tsx`, `web/src/shell/Shell.test.tsx`; independent checks pending.**
3. **MI-0136-03 - Define accent and selection hierarchy.** Acceptance: Playing, focus, selection, queued and requested are distinguishable without color alone. Required verification: Forced-colors, grayscale and keyboard screenshots. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
4. **MI-0136-04 - Document authentic artwork rules.** Acceptance: Only verifiable artwork shown; all placeholders clearly non-representational. Required verification: Metadata-missing fixture review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: authentic-artwork rules and current neutral fallback inventory in `selecta-microinteraction-design-baselines.md`; independent fixture review remains open.**
5. **MI-0136-05 - Create page-level material specimens.** Acceptance: Listen, Mix ideas, Library, Editor, Studio and Workspace show appropriate density. Required verification: Human side-by-side design assessment. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: surface/source specimen map in `selecta-microinteraction-design-baselines.md` and `web/src/ui/ControlGallery.tsx`; independent comparison remains open.**
6. **MI-0136-06 - Calibrate readable text contrast.** Acceptance: Body, muted text, button, status and overlays satisfy applicable WCAG targets. Required verification: Measured computed-style contrast in both themes. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: semantic contrast ownership and targets in `selecta-microinteraction-design-baselines.md`, values in `web/src/styles/tokens.css`; candidate-SHA computed-style measurement remains open.**
7. **MI-0136-07 - Specify focus and reading widths.** Acceptance: Reading, browsing and editing layouts retain clear line length and logical reading order. Required verification: 320–2560 and 200/400% zoom checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0136-08 - Preserve existing identity.** Acceptance: Existing warm palette, source files and navigation semantics remain intact through visual refinement. Required verification: Before/after parity and owner review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
