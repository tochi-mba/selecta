# ADR-0066: Blind study interface and evaluation integrity

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-11; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0021, ADR-0029, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Selecta supports blinded A/B seam studies with study codes, listener labels, audio audition, issue tags, quality rating, version choice and save recovery. UI cleanup must not leak the blinded method or alter scoring semantics.

## Decision proposed

Preserve exact trial, grade and response meanings while making trial progress, A/B audio ownership and recovery more accessible. Research screens must remain honest about sample size and not treat subjective scores as universal proof.

## Experience and frontend architecture

- Present one trial at a time with symmetric A and B controls and no renderer-method disclosure. Keep the same score range and issue taxonomy unless a separately approved study-protocol migration is undertaken.

- A/B previews share audio focus and never overlap with each other or main mix. A failed submission preserves all selections; retries and page reloads reconcile with canonical trial identity to avoid duplicates.

- Completion displays a true confirmation with no hidden metadata. A Cannot judge outcome is offered when a clip cannot be played according to the existing contract.

## Detailed implementation work

1. **S3-0066-01 - Implemented.** Redesign study login/setup fields with accurate requirements and error states. **Evidence:** web/src/views/Listening.tsx setup form (labelled, required, help text, Open disabled until all three are filled, load failure and empty study reported); web/src/views/s3-0066-study.test.tsx 'each setup field is labelled and required, Open waits for all three, and a bad code or an empty study says so (S3-0066-01)' (passed 2026-11-11).
2. **S3-0066-02 - Implemented.** Design readable one-trial A/B layout with stable labels and symmetric transport. **Evidence:** web/src/views/Listening.tsx one .study-trial at a time with Version A and Version B built from one VERSIONS map; web/src/views/s3-0066-study.test.tsx 'one comparison at a time, with A and B built the same way and the same labels on every trial (S3-0066-02)' (passed 2026-11-11).
3. **S3-0066-03 - Implemented.** Preserve grade scale, issue tags, preference, cannot-judge and method blindness. **Evidence:** web/src/views/Listening.test.tsx 'what’s saved is the same grade and tags as ever', 'issues are ordinary checkboxes, and only count once it’s been rated' and 'won’t let you choose between two you haven’t both heard'; web/src/views/ListeningStudyFlow.test.tsx 'a missing clip says so and still lets you record cannot judge'; method blindness in web/src/views/s3-0066-study.test.tsx 'nothing on the trial, its labels or its clip addresses names a method or condition (S3-0066-07)' (passed 2026-11-11).
4. **S3-0066-04 - Implemented.** Use one audio owner and expose currently playing A/B clip to assistive technology. **Evidence:** web/src/views/s3-0066-study.test.tsx 'says which version is playing, and starting B stops A through the one audio owner (S3-0066-04)' (passed 2026-11-11).
5. **S3-0066-05 - Implemented.** Preserve session recovery, failed submit retries and duplicate prevention. **Evidence:** web/src/views/Listening.test.tsx 'restores unfinished ratings for the same study, without leaking them to another study' and 'keeps a failed save on its current trial'; web/src/views/ListeningStudyFlow.test.tsx 'a refresh part way returns to the same comparison with its ratings and heard clips' and 'a double submit stores one response and moves on once' (passed 2026-11-11).
6. **S3-0066-06 - Implemented.** Test missing clips, incomplete grade, multiple study sessions and study completion. **Evidence:** web/src/views/ListeningStudyFlow.test.tsx 'a missing clip says so and still lets you record cannot judge' and 'finishing every comparison saves each once and says the study is complete'; web/src/views/Listening.test.tsx 'won’t let you choose between two you haven’t both heard' (incomplete listening) and 'restores unfinished ratings for the same study, without leaking them to another study' (two study sessions) (passed 2026-11-11).
7. **S3-0066-07 - Implemented.** Protect results from method leakage in UI/diagnostic text and anonymize shared screenshots. **Evidence:** web/src/views/s3-0066-study.test.tsx 'nothing on the trial, its labels or its clip addresses names a method or condition (S3-0066-07)'; shared screenshots use only the made-up library from tests/e2e_server.py, per docs/adr/selecta-3-privacy.md 'Diagnostics and shared material' (passed 2026-11-11).
8. **S3-0066-08 - Needs a person.** Perform manual listening and accessible keyboard study passes. **Status:** Needs a person: manual listening passes and a keyboard-only and screen-reader study pass with a real listener; the automated keyboard run (web/src/views/ListeningStudyFlow.test.tsx 'can be answered with the keyboard alone through to the end') passed 2026-11-11

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
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
