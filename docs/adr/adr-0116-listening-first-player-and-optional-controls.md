# ADR-0116 - Listening-first player, Up Next and optional DJ controls

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/5 new tasks implemented).
- **Independent verification:** No (0/5).
- **Programme/date:** Experience-first UI/UX; 2026-11-07; baseline `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Priority / phase:** P0 / Listener.
- **Related:** ADR-0093, ADR-0098, ADR-0082; no automatic supersession or inherited task completion.
- **Code touchpoints:** `web/src/views/Now.tsx`, `web/src/shell/Shell.tsx`, `web/src/player.ts`, `web/src/audio/focus.ts`.

## Context and evidence boundary

Now currently combines transport, lyrics, waveform/spectrum, explanation, transition ratings, next-song steering, requests and display options. Richness is an asset, but simultaneous visual priority requires independent listener evaluation. Source inspection is not proof of a rendered UI problem, human task failure or real-audio quality. Existing functionality does not count as implementation of this newly proposed behavior.

## Proposed decision

- Make song identity, reliable Play/Pause, progress, volume and genuine Up Next the dominant default view.
- Put steering, ratings, why/technical information, requests and display preferences in an optional DJ-controls area: discoverable, never deleted.
- Reveal transitions only with meaningful timing and distinguish planned, preparing, rendered, fallback and actually audible states.
- Keep lyric/Stage experiences readable with accurate timed/untimed/instrumental states, reduced motion and denied-fullscreen fallback.
- Retain one audio focus owner across main transport, mini-player, media keys and every preview. Explicit Pause never causes automatic resume.

## Alternatives considered and rationale

Separate novice/expert application modes duplicate state. A fully dense permanent control area hurts music immersion. Prefer a single listening-first composition with expandable creative controls.

## Consequences, risks and preservation

A beautiful player with missing steering or broken media-key continuity would be worse; all prior actions must be mapped and real-audio tested. Preserve original audio, routes, preferences, local security, current/draft/revision identity, scoped Undo, consented atomic bridges, full Stem Studio controls, blind study and decodable frozen-revision FLAC. No backend/audio/schema changes are implicitly approved.

## Implementation tasks (all Not started / Not verified)

1. **EX-0116-01 - Prototype default Listen hierarchy.** Acceptance: Current track, Play/Pause, progress and next song understandable immediately. Verification: Uncoached listener task study. **Implementation: Not started; Verified: No.**
2. **EX-0116-02 - Provide optional DJ-controls parity.** Acceptance: Every current steering/rating/explanation/display operation remains accessible. Verification: Keyboard and feature-preservation mapping. **Implementation: Not started; Verified: No.**
3. **EX-0116-03 - Design truthful transition cues.** Acceptance: No unrendered suggestion shown as playable result. Verification: Late/fallback/failure and live-seam fixtures. **Implementation: Not started; Verified: No.**
4. **EX-0116-04 - Validate Lyrics and Stage behavior.** Acceptance: Long/missing/RTL text and fullscreen denial never obscure transport. Verification: Both themes, reduced-motion, phone/zoom tests. **Implementation: Not started; Verified: No.**
5. **EX-0116-05 - Prove single-owner transport.** Acceptance: No overlapping previews, stopped audio or unexpected resume. Verification: Real-audio media session and race tests. **Implementation: Not started; Verified: No.**

## Required negative cases and references

Check empty/loading/partial/failed/stale/recovering states, long/RTL/duplicate names, dark/light/system themes, 320–2560px widths, 200/400% zoom, touch, keyboard, reduced motion and real audio where relevant. Preserve tests rather than weakening expectations. [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Microsoft human-AI guidance](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are pattern references, not evidence of Selecta outcomes. Status: [new checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
