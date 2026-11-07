# ADR-0070: System vocabulary, understandable explanations and restrained motion

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 — Foundations
- **Extends existing decisions:** ADR-0027, ADR-0036, ADR-0044
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0070-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The product describes planned, prepared, ready, fallback, requested, analyzed and cached states across many screens. Inconsistent terms can cause users to believe that a requested musical outcome is already available or that an automated quality check proves a transition sounds good.

## Decision proposed

Create a product vocabulary and explanation hierarchy that reuses backend truth, presents musical intent in plain language and keeps expert diagnostics available. Motion should communicate state, not decoration.

## Experience and frontend architecture

- Use a shared glossary for song, seam/transition, mix, current mix, draft, request, bridge, render, stem and readiness. Include a source-of-truth field mapping and ensure equivalent states have the same label across Listen/Edit/Library/Requests/Workspace.

- Explain automated choices through a short reason, actual outcome and expandable evidence. Never fabricate planner reasoning, probabilities or confidence. Good/Bad ratings are explicit user feedback, not inferred from skips.

- Animation budget covers modal/sheet entry and playback progress; no continuous shimmering after a real load, no flashing, and reduced-motion is respected. Status messages are announced only when meaningful, to avoid assistive-tech overload.

## Detailed implementation work (all Not started)

1. **S3-0070-01 — Not started.** Publish product-wide glossary of every user-facing state and its canonical API source.
2. **S3-0070-02 — Not started.** Write consistent primary button, disabled reason, empty state, retry and destructive copy.
3. **S3-0070-03 — Not started.** Create layered explanations for mix recommendation, steering, seam selection, bridge and rendering fallback.
4. **S3-0070-04 — Not started.** Document how to label estimates, scores, missing data and subjective ratings honestly.
5. **S3-0070-05 — Not started.** Specify motion use, limits, reduced-motion, hidden-tab and loading transition behavior.
6. **S3-0070-06 — Not started.** Replace ambiguous X-as-delete and unlabeled icon-only shortcuts with consistent language.
7. **S3-0070-07 — Not started.** Review content for privacy consent, local-only claims and nontechnical musician comprehension.
8. **S3-0070-08 — Not started.** Validate every new string under long translations, RTL metadata and constrained widths.

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

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
