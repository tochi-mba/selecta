# ADR-0268 - Explore card information and disclosure budget

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 7/8 Implemented; 0/8 In progress; 1/8 Not started.
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta final polish (FP), 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority/phase:** P0 / Explore / mix choice.
- **Owner:** Unassigned.
- **Related owners:** ADR-0216, ADR-0217, ADR-0222, ADR-0259; their historical statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`; `web/src/styles/creation.css`.

## Context and source-evidence boundary

Explore already provides rich music ideas, eligibility, descriptions and distinct Play/Shape/Save outcomes. Dense descriptive paragraphs can make cards compete for attention and obscure rapid comparison. Existing GP-0259 owns truthful expectations, not an explicit measured *default card information budget*.

A planning or source observation is not proof of a user problem. Cross-check exact existing SF/GP tasks and implementation first; no missing-feature inference.

## New delta versus earlier ADRs

Specify a compact-comparison / full-disclosure boundary for existing music idea cards, while retaining supported musical facts, accessibility, eligibility and honest estimates.

## Proposed decision and alternatives

At rest, each eligible mix card foregrounds its idea, short differentiator and one obvious primary action. Detailed caveats, deeper explanations and optional steering remain reachable by labeled disclosure. Compression cannot remove action-relevant information or imply that proposed traits are measured outcomes.

**Alternative:** Keep existing layout if direct research disproves the problem; do not reimplement existing navigation, accessibility primitives or current features.

## Implementation checklist - 7/8 Implemented; 0/8 Verified

1. **FP-0268-01 - Inventory actual card copy.** **Acceptance:** Identify title, explanation, artist cues, metrics, eligibility, qualifiers and actions; classify decision-critical versus detailed. **Required verification:** Real and sparse-library card inventory, source references **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** copy inventory with source fields and decision-critical/detail classes in docs/adr/adr-0268-explore-card-information-budget.md; web/src/views/fp-0268-explore-cards.test.tsx 'a closed card shows only the idea, its comparable facts, the disclosure name and the ranked actions' and the sparse-card case in FP-0268-03 (passed 2026-11-11); independent reviewer -.
2. **FP-0268-02 - Specify concise default content.** **Acceptance:** The default scan surface has a recognizable idea, brief supported distinguishing fact and clearly ranked action; essential warnings are never hidden. **Required verification:** Copy specimen, five-second glance and visual density comparison **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/fp-0268-explore-cards.test.tsx 'Explore card inventory and default content (FP-0268-01/02)' pins the exact closed-card text and the Play (filled) then Shape first, Save draft (quiet) order (passed 2026-11-11); the five-second glance is for the independent reviewer; independent reviewer -.
3. **FP-0268-03 - Standardize comparison facts.** **Acceptance:** Different cards use a comparable set of real locally supported facts; no approximate or unknown musical claim appears as verified. **Required verification:** Planner/data fixture truth table and missing-data cases **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/fp-0268-explore-cards.test.tsx 'every card states the same two facts; tempo, artists and basis appear only when they are known' (passed 2026-11-11); independent reviewer -.
4. **FP-0268-04 - Consolidate repetition without hiding caveats.** **Acceptance:** Repeated planned-versus-rendered and generic qualification text is consolidated while relevant uncertainty remains visible before committing. **Required verification:** Comprehension test and copy diff on pending/ready states **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/fp-0268-explore-cards.test.tsx 'the section says once that ideas are planning preferences; each card keeps its own caveat in its detail' (passed 2026-11-11); the comprehension test is for the independent reviewer; independent reviewer -.
5. **FP-0268-05 - Reveal complete explanations by intent.** **Acceptance:** Full why/eligibility/preview information is available by named disclosure, pointer, touch and keyboard rather than hover alone. **Required verification:** AT/keyboard/touch disclosure checks **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/e2e/fp-0268-explore-disclosure.e2e.ts 'the card explanation opens by pointer and keyboard, never by hover alone' and 'a tap on the named disclosure opens and closes the explanation' (2 passed 2026-11-11); independent reviewer -.
6. **FP-0268-06 - Preserve Play/Shape/Save consequences.** **Acceptance:** The separate effects and protections around playback, current mix, draft and further shaping remain obvious and unchanged. **Required verification:** Mix/transport E2E including failed creation and draft state **Implementation:** Implemented; browser check passed (web/e2e/fp-0268-build-consequences.e2e.ts 'a failed Play build leaves the current mix and the drafts alone and says why (FP-0268-06)', the same for Shape first and Save draft, and 'a saved draft is added without touching the current mix, and Shape first opens the new mix to edit (FP-0268-06)'; all four passed in CI run 43119473767, Edge E2E (shard 1/2) job 130857753346, head f851f2b, recorded 2026-11-12); **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/fp-0268-explore-cards.test.tsx 'a build that fails leaves the current mix alone and says so' (passed 2026-11-11); web/e2e/fp-0268-build-consequences.e2e.ts 4/4 passed (CI run 43119473767, shard 1/2 job 130857753346, recorded 2026-11-12); left unchecked for independent verification; independent reviewer -.
7. **FP-0268-07 - Handle long and missing metadata.** **Acceptance:** Card actions stay visible and reachable with real long/RTL strings, absent artist metadata and both themes. **Required verification:** 320px, 1440px and 400% matched screenshots **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/e2e/fp-live-theme.e2e.ts 'Explore card actions stay visible and reachable at 320px / 1440px / 400% zoom in both themes (FP-0268-07)' (3 passed 2026-11-11 on a fresh build; the label read matches the current .action-labels markup); missing artists covered by the FP-0268-03 sparse card; independent reviewer -.
8. **FP-0268-08 - Validate faster, accurate comparisons.** **Acceptance:** Time to choose, success at identifying eligible option and accuracy of promised outcomes improve or stay stable; no increase in false beliefs. **Required verification:** Pre/post uncoached listener and DJ study, exact SHA/reviewer **Implementation:** Not started; Needs a person: pre/post uncoached listener and DJ comparison study with SHA and reviewer; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -; independent reviewer -.

## Explore card copy inventory (FP-0268-01, 2026-11-10)

Source: `web/src/views/Mixes.tsx` (the `article.vibe-card` block); data: `VibeCard` in `web/src/api.ts`. Proven by
`web/src/views/fp-0268-explore-cards.test.tsx` with a full card and a sparse one (no tempo, no artists, no basis).

| Element | Source field | Class | Where it shows |
|---|---|---|---|
| Name (`h3`) | `name` | decision-critical | always |
| Tempo range "N-M BPM" | `tempo` | decision-critical when known | only when the server measured it |
| Family scope "Stays within X" | `family` | decision-critical (eligibility) | only for a family-limited idea |
| One-line summary | `blurb` | decision-critical | always |
| "N matching songs" | `songs` | comparison fact | always, same wording on every card |
| "About T of matching source songs" | `seconds` | comparison fact (approximate, says "About") | always, same wording on every card |
| Disclosure "Why X? More details" | - | entry to detail | always, a native `details`/`summary` (pointer, touch, keyboard) |
| Artists drawn from | `artists` | detail | inside the disclosure; "your mix-ready songs" when none are known |
| How it moves | `moves` | detail | inside the disclosure |
| Measured basis | `basis` | detail; never claimed without a basis | inside the disclosure, only when the server sent one |
| Planning caveat and consequences | - | qualifier | once for the section, visible ("planning preferences, not previews"); per card inside the disclosure |
| Use this feeling with Lucy | - | advanced action | inside the disclosure, behind the `lucy` flag |
| Play | - | primary action (filled) | always |
| Shape first | - | contextual action (quiet) | behind the `editor` flag |
| Save draft | - | contextual action (quiet) | behind the `drafts` flag |

Unavailable ideas are not cards: they are listed under "Needs more mix-ready songs" with how many more they need.

## Safety, negatives and evidence requirements

**Area-specific negatives:** all choices ineligible; one eligible; partly analysed library; unavailable candidate facts; generated vs ungenerated; missing artist; Unicode/RTL/very long titles; mobile 320px; 400% zoom; disclosure keyboard focus.

**Common cases:** Light/Dark/System, 320–2560px and 400% zoom, short landscape, forced-colours, reduced motion, duplicate/long/RTL/Unicode metadata, loading/stale/offline/failed/cancel, keyboard/touch/NVDA and real audio where relevant.

**Preservation:** Original audio unchanged; one player and intentional Pause; exact song and seam occurrence, current/draft revisions and scoped Undo; consented atomic bridges; eight-lane 8–64-cell Studio; true Library readiness and LRCLIB disclosure; unbiased studies; frozen-revision decodable FLAC. No SaaS or telemetry.

**Proof:** Novice and experienced listener card-choice tasks, screenshot pairs, fixture/data-truth and accessible disclosure tests. Record independent reviewer name/date, exact implementing source/test SHA, platform, task counts, observed failures and rollback. CI screenshots alone never confer Verified.

## Status governance

**Decision** Proposed → Accepted/Rejected/Superseded only with dated owner approval and reason. **Implementation** Not started → In progress → Implemented requires linked source PR/SHA. **Verified** No → Yes requires separate named human/audio/AT/visual evidence. This docs-only PR does not count as an implementing PR, and does not update any previous programme ledger.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Verification](selecta-final-polish-verification-matrix.md).
