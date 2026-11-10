# ADR-0237 - Shared data provenance and authoritative music-state truth

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 1/8 In progress, 1/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Architecture.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0166/0170/0172/0175; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/state/readiness.ts; web/src/ui/MusicObjects.tsx; web/src/player.ts.

## Context and evidence boundary

Every visible musical graphic must identify whether it is decorative, requested, discovered, measured, rendered, applied, previewed or playing. Consolidate truth mapping without inventing backend facts. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Every visible musical graphic must identify whether it is decorative, requested, discovered, measured, rendered, applied, previewed or playing. Consolidate truth mapping without inventing backend facts. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No guessed beat, cover, harmonic fit, exact lyric word, render percentage, track availability or successful mutation. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0237-01 - Enumerate provenance types.** **Acceptance:** All musical objects have declared authority and uncertainty. **Required verification:** Domain schema audit. **Implementation:** Implemented; each musical object names its authority (library ID, measured analysis, rendered move, server mix and job status, the one player clock) and how uncertainty shows; table in docs/engineering/flow-cross-cutting.md; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Musical provenance and authority; `web/src/ui/MusicObjects.test.tsx` (passed), `web/src/state/readiness.test.ts`, `web/src/state/jobs.test.ts`; `tests/test_flow_cross_cutting.py`; run 2026-11-10.
2. **SF-0237-02 - Map current readiness states.** **Acceptance:** Song, seam, stem and job conditions use canonical values. **Required verification:** API and fixture tests. **Implementation:** Implemented; song, seam and job states use the server's canonical values, and failures sort before pending; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/state/readiness.test.ts` 'shows failures before pending queue or rendering states', 'does not call a cached but cut-off seam ready for a continuous mix'; `web/src/state/polishReadinessDistinct.test.ts`; `tests/test_api_contracts.py`; passed 2026-11-10.
3. **SF-0237-03 - Define visual-state contracts.** **Acceptance:** Cards, lines and badges never mix plan with real status. **Required verification:** Design state matrix. **Implementation:** Implemented; cards, lines and badges keep the asked-for move apart from what really plays, and a proposed route apart from a joined one; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Mix.test.tsx` 'keeps the move you asked for pressed, and names what really plays separately', 'says nothing about a fallback when what played is what was asked for'; `web/src/ui/MusicObjects.test.tsx` 'shows only returned ordered route songs, and never implies a proposed path has joined', 'keeps queued, rendering, failed and rendered Thread states distinct without inventing sound'; passed 2026-11-10.
4. **SF-0237-04 - Handle unknown explicitly.** **Acceptance:** Missing values display unknown instead of fake estimates. **Required verification:** Null fixtures. **Implementation:** Implemented; missing energy, readiness or recording show as unknown, never an estimate; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'keeps unknown song energy as an unknown gap and selects only the actual row'; `web/src/views/Library.test.tsx` 'never opens another song if a deep-link ID is missing, and can retry'; `web/src/state/jobs.test.ts` 'never crashes the app for an incomplete status from a different server version'; passed 2026-11-10.
5. **SF-0237-05 - Bind exact object identity.** **Acceptance:** Occurrence, seam and revision stable through async work. **Required verification:** Race and duplicate ID tests. **Implementation:** Implemented; songs are bound to recording ID and occurrence, drafts to their own ID, and a request joins atomically or not at all; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Library.test.tsx` 'makes duplicate recording IDs visible in both rows and song details'; `web/src/views/Mix.test.tsx` 'keeps duplicate, RTL and CJK song names readable and occurrence-scoped', 'never confuses two different drafts with identical songs and transition keys'; `web/src/ui/CommandPalette.test.tsx` 'opens the exact recording ID even when different results share a title'; `tests/test_requests.py` 'test_ready_insertion_is_atomic_and_rejects_stale_or_unapproved_plans'; passed 2026-11-10.
6. **SF-0237-06 - Design AT descriptions.** **Acceptance:** Readiness accessible without colors or diagrams. **Required verification:** NVDA inspection. **Implementation:** In progress; Needs a person: an NVDA inspection that readiness is understandable without colour or diagrams. Automated part passed 2026-11-10: `web/src/ui/controls.test.tsx` 'never rely on colour alone'; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0237-07 - Test errors and fallback semantics.** **Acceptance:** Failed render and technique fallback visible. **Required verification:** Error fixtures. **Implementation:** Implemented; a failed render and a technique fallback are each shown and named; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback as the selected technique', 'never calls an automatic unrendered transition a confirmed technique'; `web/src/views/Mix.test.tsx` 'keeps the move you asked for pressed, and names what really plays separately'; `web/src/state/readiness.test.ts` 'shows failures before pending queue or rendering states'; passed 2026-11-10.
8. **SF-0237-08 - Validate user comprehension.** **Acceptance:** Novices distinguish prepared versus playing versus requested. **Required verification:** Uncoached status study. **Implementation:** Not started; Needs a person: an uncoached status study of novices telling prepared, playing and requested apart; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0166/0170/0172/0175; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
