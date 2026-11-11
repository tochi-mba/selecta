# ADR-0376 - Make a Mix quick paths, moods, shaping and Lucy handoff

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 0/8 Not started; 0/8 In progress; 8/8 Implemented (5/8 ticked in the checklist with automated evidence, 2026-11-10).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 05 Creation entry. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0216, ADR-0217, ADR-0259, ADR-0268, ADR-0283, ADR-0353, ADR-0354; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

LX-0353/0354 own Make a Mix presentation; UF owns the combined journey and guards.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 8/8 Implemented; 0/8 independently Verified

1. **UF-0376-01 - Delegate detailed design to LX.** **Acceptance:** Use existing LX-0353/0354 contracts and classify only integration gaps. **Required verification:** LX parity review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** LX crosswalk table in docs/adr/adr-0376-make-a-mix-quick-play-and-intent.md classifies each UF task against LX-0353/LX-0354 and earlier owners; only UF-0376-08 needed a new UF test (web/e2e/uf-creation-entry.e2e.ts) (2026-11-10); Needs a person: LX parity review of the crosswalk. Independent reviewer -.
2. **UF-0376-02 - Make Quick Play predictable.** **Acceptance:** Communicate actual readiness and next step without requiring DJ knowledge. **Required verification:** Uncoached first use. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** Quick Play readiness and next step owned by LX-0353-01/-03/-07 and MP-0282-07 (crosswalk in ADR-0376) (2026-11-10); Needs a person: uncoached first-use study. Independent reviewer -.
3. **UF-0376-03 - Guard active mix replacement.** **Acceptance:** Show consequence and existing Undo when changing currently audible music. **Required verification:** Replacement fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** already satisfied by ADR-0216/LX-0346-03 (crosswalk in ADR-0376): web/src/views/Mixes.test.tsx 'keeps the active mix until confirmation and guards the mix seen when Play was chosen' (23/23 passed); web/src/App.test.tsx 'asks before replacing an active mix with a draft, and cancel leaves playback untouched', 'playing one goes to Listen, and keeps what was playing in the drafts' (Undo notice) (12/12 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
4. **UF-0376-04 - Use genuine mood facts.** **Acceptance:** Mood cards compare source-backed vibe, duration and eligible song counts. **Required verification:** Card fixture/copy review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** already satisfied by ADR-0268/LX-0354: web/src/views/Mixes.test.tsx 'says what's inside each one, from the songs that would really play', 'keeps real comparison facts and all three consequences visible while disclosing the longer explanation by intent' (23/23 passed); web/src/views/fp-0268-explore-cards.test.tsx (4/4 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
5. **UF-0376-05 - Keep advanced controls optional.** **Acceptance:** Energy, stems and target can be shaped without blocking basic listen. **Required verification:** Basic/expert task comparison. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** Shape (energy, length, song count) is optional and Quick Play needs none of it: MP-0283-06, LX-0353-02 (crosswalk in ADR-0376) (2026-11-10); Needs a person: basic/expert task comparison with participants. Independent reviewer -.
6. **UF-0376-06 - Preserve Lucy handoff scope.** **Acceptance:** Mood/selected prompt is prefilled exactly and never auto-sent. **Required verification:** Deep-link and consent test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** already satisfied by LX-0353-04/LX-0354-05: web/src/views/Mixes.test.tsx 'offers a feeling-specific, editable Lucy prompt without sending it', 'shows two distinct choices while keeping Quick Play independent of Lucy' (23/23 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
7. **UF-0376-07 - Handle insufficient ready songs.** **Acceptance:** Offer scan/analysis path rather than impossible mix action. **Required verification:** Zero-ready fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** already satisfied by ADR-0217/ADR-0259: web/src/views/polishPhase03Start.test.tsx 'links to Library and progress before any mix can be made' (9/9 passed); web/src/views/Mixes.test.tsx 'waits for six mix-ready songs even when audio analysis has finished on more', 'says why a preset can't be played yet' (23/23 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
8. **UF-0376-08 - Check responsive card actions.** **Acceptance:** Mobile layouts retain comparable cards and safe button targets. **Required verification:** Paired screenshots. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/e2e/uf-creation-entry.e2e.ts 'UF-0376-08 Make a Mix cards keep their facts and 44px actions at 320px', '... at 375px' (2/2 passed, dist-r3e) (2026-11-10); **Evidence/reviewer:** independent reviewer -.

## LX crosswalk and integration gaps (UF-0376-01, recorded 2026-11-10)

Detailed Make a Mix design belongs to LX-0353 and LX-0354; UF adds no second design. Each UF task is classified against them:

| UF task | LX / earlier owner | Classification | Proof |
|---|---|---|---|
| UF-0376-02 Quick Play predictable | LX-0353-01, -03, -07; MP-0282-07 | already satisfied; uncoached first use still needs people | `web/e2e/lx-lucy.e2e.ts` LX-0353-01/-03/-07, `web/e2e/mp-0282-onboarding.e2e.ts` MP-0282-07 |
| UF-0376-03 replacement guard | ADR-0216, LX-0346-03 | already satisfied | `web/src/App.test.tsx` "asks before replacing an active mix with a draft", `web/e2e/mp-0283-make-a-mix.e2e.ts` MP-0283-07 |
| UF-0376-04 genuine mood facts | ADR-0268 (FP), LX-0354 | already satisfied | `web/src/views/fp-0268-explore-cards.test.tsx`, `web/src/views/Mixes.test.tsx` "says what's inside each one, from the songs that would really play" |
| UF-0376-05 advanced controls optional | MP-0283-06, LX-0353-02 | already satisfied; basic/expert comparison needs people | `web/e2e/mp-0283-make-a-mix.e2e.ts` MP-0283-06, `web/e2e/lx-lucy.e2e.ts` LX-0353-02 |
| UF-0376-06 Lucy handoff scope | LX-0353-04, LX-0354-05 | already satisfied | `web/e2e/lx-lucy.e2e.ts` LX-0353-04/LX-0354-05, `web/src/views/Mixes.test.tsx` editable Lucy prompt |
| UF-0376-07 insufficient ready songs | ADR-0217, ADR-0259 | already satisfied | `web/src/views/polishPhase03Start.test.tsx` "links to Library and progress before any mix can be made", `web/src/views/Mixes.test.tsx` "waits for six mix-ready songs" |
| UF-0376-08 responsive card actions | MP-0283 | refinement (new UF test) | `web/e2e/uf-creation-entry.e2e.ts` UF-0376-08 at 320 and 375px |

No UF-only Make a Mix source change was needed.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
