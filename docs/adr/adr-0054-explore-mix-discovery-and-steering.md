# ADR-0054: Explore mixes, presets, creation defaults and energy journeys

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0010, ADR-0011, ADR-0038
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0054-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The existing Mixes page includes a featured suggestion, sixteen preset vibes, duration, transition feel, stems frequency, five-point energy arc, destination selection and draft paths. The breadth of controls can compete with the primary 'play a good mix' task.

## Decision proposed

Use an intent-led Explore landing page with a prominent playable recommendation, clear preset catalogue and progressive Customize surface. Preserve every preset, option and creation semantic. Make replacing the active set explicit and offer a draft alternative when appropriate.

## Experience and frontend architecture

- Feature cards prioritize name, concise musical character, real readiness and Play; Edit first/Save as draft remain discoverable secondary paths. Show accurate unavailability reasons and never fabricate track eligibility.

- The customization surface groups transition feel, stem frequency, approximate length, destination and five-stop desired energy. Keep requested and measured-achieved energy scales explicitly separate; never overlay relative measurements as if numerically equivalent.

- Creation operations identify target scope, guard double-submission, and reconcile completed mix IDs before navigation or playback replacement.

## Detailed implementation work (all Not started)

1. **S3-0054-01 - Not started.** Create Explore hierarchy with Mixes, Word Connections and Harmonic Matches subnavigation.
2. **S3-0054-02 - Not started.** Redesign featured Play and the sixteen preset cards with accessible primary and secondary actions.
3. **S3-0054-03 - Not started.** Provide context on active-mix replacement, reversible activation, and create-as-draft alternative.
4. **S3-0054-04 - Not started.** Reorganize customization into grouped accessible controls with visible current summary.
5. **S3-0054-05 - Not started.** Preserve Smooth/Punchy equivalent, Never/Sometimes/Often stem settings, approximate duration presets and saved defaults.
6. **S3-0054-06 - Not started.** Redesign five-stop energy arc as keyboard-operable desired target with honest observed-comparison labeling.
7. **S3-0054-07 - Not started.** Build robust destination search, clear/remove controls and stale-response protection.
8. **S3-0054-08 - Not started.** Define eligible/ineligible state messages and first-mix call to action backed by actual library readiness.
9. **S3-0054-09 - Not started.** Usability-test novice selection and expert customization separately.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- All sixteen presets and unavailable reasons, repeated Play, old mix restore, draft creation and route continuity.
- Energy curve reset/saved values, destination disappearance, invalid destination, and approximate duration labeling.
- Network loss and concurrent build result; result must activate only the confirmed intended mix.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Expose every technical option on the landing page: high visibility but overwhelming. Hide all advanced options: simpler but hurts expert control. Progressive and explicitly labeled customization balances both.

## Acceptance and evidence

A new listener can start a prepared mix without understanding the editor; an expert retains all customization capabilities and current-mix safety.

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
