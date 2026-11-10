# ADR-0054: Explore mixes, presets, creation defaults and energy journeys

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 9 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0010, ADR-0011, ADR-0038
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The existing Mixes page includes a featured suggestion, sixteen preset vibes, duration, transition feel, stems frequency, five-point energy arc, destination selection and draft paths. The breadth of controls can compete with the primary 'play a good mix' task.

## Decision proposed

Use an intent-led Explore landing page with a prominent playable recommendation, clear preset catalogue and progressive Customize surface. Preserve every preset, option and creation semantic. Make replacing the active set explicit and offer a draft alternative when appropriate.

## Experience and frontend architecture

- Feature cards prioritize name, concise musical character, real readiness and Play; Edit first/Save as draft remain discoverable secondary paths. Show accurate unavailability reasons and never fabricate track eligibility.

- The customization surface groups transition feel, stem frequency, approximate length, destination and five-stop desired energy. Keep requested and measured-achieved energy scales explicitly separate; never overlay relative measurements as if numerically equivalent.

- Creation operations identify target scope, guard double-submission, and reconcile completed mix IDs before navigation or playback replacement.

## Detailed implementation work

1. **S3-0054-01 - Implemented.** Create Explore hierarchy with Mixes, Word Connections and Harmonic Matches subnavigation. **Evidence:** exploreTabs in web/src/shell/manifest.ts; web/src/views/Links.test.tsx 'each have their own address'; web/src/shell/mpSurfaceInventory.test.ts 'covers every destination and tab in the navigation manifest' (passed 2026-11-10).
2. **S3-0054-02 - Implemented.** Redesign featured Play and the sixteen preset cards with accessible primary and secondary actions. **Evidence:** web/src/views/Mixes.tsx; web/src/views/Mixes.test.tsx 'groups mixes by why you’d press them', 'says what’s inside each one, from the songs that would really play' and 'says why a preset can’t be played yet' (passed 2026-11-10).
3. **S3-0054-03 - Implemented.** Provide context on active-mix replacement, reversible activation, and create-as-draft alternative. **Evidence:** web/src/views/Mixes.test.tsx 'keeps the active mix until confirmation and guards the mix seen when Play was chosen' and 'builds it without touching what’s playing'; web/src/App.test.tsx 'asks before replacing an active mix with a draft, and cancel leaves playback untouched' (passed 2026-11-10).
4. **S3-0054-04 - Implemented.** Reorganize customization into grouped accessible controls with visible current summary. **Evidence:** web/src/views/MixSetup.tsx grouped controls with the summary line; web/src/views/Mixes.test.tsx 'how mixes get built stays out of the way until it’s wanted, and says it’s for new mixes' (passed 2026-11-10).
5. **S3-0054-05 - Implemented.** Preserve Smooth/Punchy equivalent, Never/Sometimes/Often stem settings, approximate duration presets and saved defaults. **Evidence:** web/src/views/Mixes.test.tsx 'lets the listener choose the transition feel and saves it for future mixes', 'serializes rapidly changed feel settings so the last selection wins on the server', 'lets the listener set how often new mixes use stem-assisted moves' and 'browsing says roughly how long, because that’s all it can promise' (passed 2026-11-10).
6. **S3-0054-06 - Implemented.** Redesign five-stop energy arc as keyboard-operable desired target with honest observed-comparison labeling. **Evidence:** web/src/views/MixSetup.test.tsx 'keeps numeric input, slider and drawn stops on the same exact preference values' and 'cancels an interrupted pointer stroke without leaving a half-drawn energy choice'; web/src/views/Mixes.test.tsx 'lets the listener shape and save a five-stop energy arc'; web/src/ui/MusicObjects.test.tsx 'keeps requested and measured energy explicitly separate, with no invented measurement' (passed 2026-11-10).
7. **S3-0054-07 - Implemented.** Build robust destination search, clear/remove controls and stale-response protection. **Evidence:** web/src/views/MixSetup.tsx destination search with Clear destination; web/src/views/Mixes.test.tsx 'lets the listener set a song as the destination for future mixes' and 'ignores an older answer that arrives after the newer search, and can be cleared' (passed 2026-11-10).
8. **S3-0054-08 - Implemented.** Define eligible/ineligible state messages and first-mix call to action backed by actual library readiness. **Evidence:** web/src/views/Mixes.test.tsx 'waits for six mix-ready songs even when audio analysis has finished on more', 'says why a preset can’t be played yet' and 'keeps Christmas off the waiting list until there are enough songs for it'; web/src/views/Setup.test.tsx 'does not promise a playable mix before the real readiness threshold' (passed 2026-11-10).
9. **S3-0054-09 - Needs a person.** Usability-test novice selection and expert customization separately. **Status:** Needs a person: usability tests of novice selection and expert customization with participants.

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
| 2026-11-10 | Accepted | In progress (8/9) | Task-by-task evidence on each item; 1 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
