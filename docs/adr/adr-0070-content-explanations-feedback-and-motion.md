# ADR-0070: System vocabulary, understandable explanations and restrained motion

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-12; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0027, ADR-0036, ADR-0044
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The product describes planned, prepared, ready, fallback, requested, analyzed and cached states across many screens. Inconsistent terms can cause users to believe that a requested musical outcome is already available or that an automated quality check proves a transition sounds good.

## Decision proposed

Create a product vocabulary and explanation hierarchy that reuses backend truth, presents musical intent in plain language and keeps expert diagnostics available. Motion should communicate state, not decoration.

## Experience and frontend architecture

- Use a shared glossary for song, seam/transition, mix, current mix, draft, request, bridge, render, stem and readiness. Include a source-of-truth field mapping and ensure equivalent states have the same label across Listen/Edit/Library/Requests/Workspace.

- Explain automated choices through a short reason, actual outcome and expandable evidence. Never fabricate planner reasoning, probabilities or confidence. Good/Bad ratings are explicit user feedback, not inferred from skips.

- Animation budget covers modal/sheet entry and playback progress; no continuous shimmering after a real load, no flashing, and reduced-motion is respected. Status messages are announced only when meaningful, to avoid assistive-tech overload.

## Detailed implementation work

1. **S3-0070-01 - Implemented.** Publish product-wide glossary of every user-facing state and its canonical API source. **Evidence:** docs/adr/selecta-3-glossary.md 'Things' and 'States, and where each comes from' (each state with its API field); tests/test_s3_docs_contracts.py test_the_glossary_layers_numbers_and_motion_are_specified; web/src/state/readiness.test.ts 'shows failures before pending queue or rendering states' (passed 2026-11-11).
2. **S3-0070-02 - Implemented.** Write consistent primary button, disabled reason, empty state, retry and destructive copy. **Evidence:** docs/adr/selecta-3-glossary.md 'Buttons and messages'; web/src/apiFaults.test.ts 'every built-in message names the cause and a safe next step in plain words'; web/src/gp-0263-offline.test.tsx 'a Library list that fails to load says the songs are fine, and offers a retry, not Add music'; web/src/ui/CommandPalette.test.tsx 'shows exact Undo scope but refuses an unavailable mutation' (disabled reason) (passed 2026-11-11).
3. **S3-0070-03 - Implemented.** Create layered explanations for mix recommendation, steering, seam selection, bridge and rendering fallback. **Evidence:** docs/adr/selecta-3-glossary.md 'How explanations are layered'; fallback: web/src/views/Mix.test.tsx 'keeps the move you asked for pressed, and names what really plays separately'; recommendation: web/src/views/Mixes.test.tsx 'says why a preset can’t be played yet'; bridge: web/src/views/RequestsJoining.test.tsx 'show a bridge’s transitions between each song' (passed 2026-11-11).
4. **S3-0070-04 - Implemented.** Document how to label estimates, scores, missing data and subjective ratings honestly. **Evidence:** docs/adr/selecta-3-glossary.md 'Being honest about numbers'; web/src/views/ExportJobs.test.tsx 'offers a download only for a ready file, never for expired, failed or unfinished jobs, and shows no percent'; web/src/views/LibraryLx.test.tsx 'a correction, the measurement and an unknown are labelled apart'; web/src/views/s3-0064-workspace.test.tsx 'Learning keeps the blind study entry point and separates automatic checks from a person’s ear (S3-0064-06)' (passed 2026-11-11).
5. **S3-0070-05 - Implemented.** Specify motion use, limits, reduced-motion, hidden-tab and loading transition behavior. **Evidence:** docs/adr/selecta-3-glossary.md 'Motion'; web/e2e/finishing.e2e.ts 'with reduced motion nothing keeps moving by itself, on any page'; web/e2e/creative-visualizers.e2e.ts 'each horizontal mode paints measured audio, goes blank on pause and stops while hidden'; web/src/ui/useVisiblePoll.test.tsx 'does not poll hidden tabs, refreshes on return, and removes its listeners' (passed 2026-11-11).
6. **S3-0070-06 - Implemented.** Replace ambiguous X-as-delete and unlabeled icon-only shortcuts with consistent language. **Evidence:** web/src/s3-0070-wording.test.ts 'no button or link has a cross glyph or a lone X as its only content' and 'a cross glyph never appears as visible text anywhere in the interface'; web/src/ui/formControls.test.tsx 'buttons and icon buttons have names, and a busy button says so' (passed 2026-11-11).
7. **S3-0070-07 - Needs a person.** Review content for privacy consent, local-only claims and nontechnical musician comprehension. **Status:** Needs a person: a nontechnical musician reading the privacy, consent and local-only wording for comprehension; the wording itself is held word for word by web/src/localPrivacyCopy.test.ts and web/e2e/finishing.e2e.ts 'a first run says what leaves this PC before anything is sent', which passed 2026-11-11
8. **S3-0070-08 - Implemented.** Validate every new string under long translations, RTL metadata and constrained widths. **Implementation:** Implemented; **Independently Verified:** No; **Evidence:** browser check passed: both 'S3-0070-08 pseudo-localised interface strings, 40% longer, fit every page at 320px' and '... at 1280px' passed (CI run 43119473767, Edge E2E (shard 2/2) job 130857753267, head f851f2b, recorded 2026-11-12) and rerun locally 2026-11-12 under the slot lock (Edge, web/dist-r6e); spec (web/e2e/s3-0070-pseudo-locale.e2e.ts 'S3-0070-08 pseudo-localised interface strings, 40% longer, fit every page at 320px' and '... at 1280px', written 2026-11-11). The interface has no translations, so the spec is the pseudo-localised run: on every page it swaps each visible string, label and placeholder for an accented copy about 40% longer in brackets, with the long, right-to-left and duplicate song names from tests/e2e_server.py, then fails on anything sticking out of the window and on any button, tab, link, label or heading cut off without an ellipsis. Long, right-to-left and duplicate metadata at the smallest width already passes (web/e2e/finishing.e2e.ts 'long, right-to-left and duplicate names stay readable and whole at the smallest size', 2026-11-11)

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Compare same seam readiness across Listen, Editor and export before/after a failure.
- Screen-reader announcement frequency during streaming progress, background analysis and retries.
- Automated checks for forbidden false ready labels and manual study of users interpreting fallback.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Hardcoded copy per screen seems quick but causes contradictions. A shared truth-to-label mapping and style guide creates consistency and simplifies audits.

## Acceptance and evidence

Users can correctly distinguish planned versus available, requested versus actual and automated metrics versus musical quality.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
