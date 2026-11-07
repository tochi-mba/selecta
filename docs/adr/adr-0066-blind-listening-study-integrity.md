# ADR-0066: Blind study interface and evaluation integrity

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 — Discovery and operations
- **Extends existing decisions:** ADR-0021, ADR-0029, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0066-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Selecta supports blinded A/B seam studies with study codes, listener labels, audio audition, issue tags, quality rating, version choice and save recovery. UI cleanup must not leak the blinded method or alter scoring semantics.

## Decision proposed

Preserve exact trial, grade and response meanings while making trial progress, A/B audio ownership and recovery more accessible. Research screens must remain honest about sample size and not treat subjective scores as universal proof.

## Experience and frontend architecture

- Present one trial at a time with symmetric A and B controls and no renderer-method disclosure. Keep the same score range and issue taxonomy unless a separately approved study-protocol migration is undertaken.

- A/B previews share audio focus and never overlap with each other or main mix. A failed submission preserves all selections; retries and page reloads reconcile with canonical trial identity to avoid duplicates.

- Completion displays a true confirmation with no hidden metadata. A Cannot judge outcome is offered when a clip cannot be played according to the existing contract.

## Detailed implementation work (all Not started)

1. **S3-0066-01 — Not started.** Redesign study login/setup fields with accurate requirements and error states.
2. **S3-0066-02 — Not started.** Design readable one-trial A/B layout with stable labels and symmetric transport.
3. **S3-0066-03 — Not started.** Preserve grade scale, issue tags, preference, cannot-judge and method blindness.
4. **S3-0066-04 — Not started.** Use one audio owner and expose currently playing A/B clip to assistive technology.
5. **S3-0066-05 — Not started.** Preserve session recovery, failed submit retries and duplicate prevention.
6. **S3-0066-06 — Not started.** Test missing clips, incomplete grade, multiple study sessions and study completion.
7. **S3-0066-07 — Not started.** Protect results from method leakage in UI/diagnostic text and anonymize shared screenshots.
8. **S3-0066-08 — Not started.** Perform manual listening and accessible keyboard study passes.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Double submission after response timeout, reload mid-trial, failed audio in A or B.
- Switch A/B rapidly while main mix previously playing; no overlapping sources or unsolicited resume.
- Ensure no hidden condition leaks in names, DOM accessible labels, ordering metadata or error messages.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A visually elaborate comparative player could reveal differences through unequal graphics or descriptions. Keep neutral symmetric controls and a stable protocol.

## Acceptance and evidence

Blindness, trial identity, scoring semantics, recovery and actual audio audition are verified; no finding is inferred from an automated mock.

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
