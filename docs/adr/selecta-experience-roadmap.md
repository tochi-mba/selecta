# Selecta - experience-first UI/UX ADR roadmap

**Planning baseline:** main `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged [PR #29](https://github.com/tochi-mba/selecta/pull/29), 2026-11-07. Created as a documentation-only proposal with 21 Proposed ADRs and 105 EX tasks Not started. **Status 2026-11-12 (recounted from the [checklist](selecta-experience-implementation-checklist.md) task lines): 21 Accepted; 91 Implemented, 4 In progress, 7 Not started, 3 Superseded; 51 Verified.** These do not automatically supersede earlier 4.0 decisions or assert that previous code has not been written.

## Independent design direction

**Listening effortless; making a mix expressive; expert editing precise; operations quiet.** This programme intentionally challenges the information hierarchy and structure of the existing app rather than merely repeating the 4.0 typography/layout checklists. Changes remain reversible hypotheses until real task, audio, accessibility and visual acceptance.

## ADR index with implementation statuses

| ADR | Proposed decision | Phase | Priority | Decision | Implementation | Verified |
|---|---|---|---|---|---|---|
| [ADR-114](adr-0114-experience-charter-and-measurable-quality.md) | Experience-first product charter and measurable quality | Baseline | P0 | Accepted | 3/5 Implemented, 1 In progress, 1 Not started, 0 Superseded | 0/5 |
| [ADR-115](adr-0115-intent-led-navigation-and-route-continuity.md) | Intent-led navigation, route continuity and entry context | Structure | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 2/5 |
| [ADR-116](adr-0116-listening-first-player-and-optional-controls.md) | Listening-first player, Up Next and optional DJ controls | Listener | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-117](adr-0117-three-stage-mix-creation-journey.md) | Three-stage mix creation: choose, shape and commit | Make a Mix | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 4/5 |
| [ADR-118](adr-0118-recommendation-cards-and-authentic-preview.md) | Recommendations: clear music-first cards and authentic previews | Make a Mix | P1 | Accepted | 4/5 Implemented, 0 In progress, 1 Not started, 0 Superseded | 3/5 |
| [ADR-119](adr-0119-my-mixes-drafts-and-render-line.md) | My Mixes: distinct current, draft and render scopes | Creator | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 4/5 |
| [ADR-120](adr-0120-song-transition-editor-workstation.md) | Arrangement editor: distinct song and transition objects | Creator | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-121](adr-0121-transition-inspector-audition-and-truth.md) | Transition Inspector: intent, rendered reality and audition | Creator | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 4/5 |
| [ADR-122](adr-0122-studio-shape-and-detailed-editing.md) | Stem Studio: approachable Shape controls and lossless Detailed mode | Expert | P1 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-123](adr-0123-music-library-browse-and-contextual-actions.md) | Library: music-first browsing and contextual actions | Collection | P1 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-124](adr-0124-requests-lifecycle-and-bridge-consent.md) | Requests: truthful lifecycle and explicit bridge consent | Collection | P1 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-125](adr-0125-musical-discovery-audition-workflows.md) | Musical discovery as clear word and harmonic audition flows | Collection | P1 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 4/5 |
| [ADR-126](adr-0126-browser-first-onboarding-and-readiness.md) | Browser-first onboarding and readiness, without desktop packaging | Listener | P1 | Accepted | 4/5 Implemented, 0 In progress, 0 Not started, 1 Superseded | 2/5 |
| [ADR-127](adr-0127-export-job-and-frozen-revision.md) | Export: truthful frozen revision, job lifecycle and file delivery | Operations | P1 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-128](adr-0128-calm-workspace-and-operations.md) | Workspace as a calm, actionable operations center | Operations | P2 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 2/5 |
| [ADR-129](adr-0129-blind-study-neutral-audio.md) | Neutral blind A/B listening study with protocol integrity | Operations | P1 | Accepted | 4/5 Implemented, 0 In progress, 1 Not started, 0 Superseded | 2/5 |
| [ADR-130](adr-0130-brand-tokens-and-css-ownership.md) | Warm editorial design language, independent themes and CSS ownership | Foundation | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 0/5 |
| [ADR-131](adr-0131-component-states-and-scoped-recovery.md) | Shared component contracts, honest async states and scoped recovery | Foundation | P0 | Accepted | 5/5 Implemented, 0 In progress, 0 Not started, 0 Superseded | 3/5 |
| [ADR-132](adr-0132-responsive-accessibility-and-purposeful-motion.md) | Responsive compositions, WCAG 2.2 AA and purposeful motion | Quality | P0 | Accepted | 4/5 Implemented, 0 In progress, 1 Not started, 0 Superseded | 1/5 |
| [ADR-133](adr-0133-user-research-performance-and-release-evidence.md) | Uncoached user research, real performance and release evidence | Quality | P0 | Accepted | 0/5 Implemented, 3 In progress, 2 Not started, 0 Superseded | 0/5 |
| [ADR-134](adr-0134-web-first-future-saas-boundary.md) | Web-first product boundary for a possible future SaaS | Scope | P0 | Accepted | 2/5 Implemented, 0 In progress, 1 Not started, 2 Superseded | 2/5 |
| **Total** | **21 design decisions** | | | **21 Accepted** | **91/105 Implemented, 4 In progress, 7 Not started, 3 Superseded** | **51/105 Verified** |

## Delivery sequence (dependencies, not schedule)

1. **Baseline and decision authority:** ADR-0114, ADR-0134. Reconcile PR #29 and older S3/S31/S4 ledgers, preserve capability contracts, exclude desktop packaging and near-term SaaS.
2. **Foundation:** ADR-0115, ADR-0130, ADR-0131. Prototype intent navigation, dual-theme visual system and consistent component feedback.
3. **Listening and first value:** ADR-0116, ADR-0126. One music-first player, current browser/server setup, truthful readiness.
4. **Make a Mix:** ADR-0117, ADR-0118. Optional Choose–Shape–Commit and grounded music recommendations; authentic preview is feasibility-gated.
5. **Creator work:** ADR-0119, ADR-0120, ADR-0121. Current/draft/render distinctions, song/seam editor, audition-first Inspector.
6. **Expert and music collections:** ADR-0122, ADR-0123, ADR-0124, ADR-0125. Preserve full Studio precision, safer browsing, consented requests and discovery.
7. **Operations:** ADR-0127, ADR-0128, ADR-0129. Correct frozen FLAC, calm operational Workspace, neutral blind study.
8. **Quality applies to every slice and gates release:** ADR-0132, ADR-0133. Human WCAG/AT/audio, visual approval, benchmark evidence, rollback, explicit owner GO/NO-GO.

## Constraints and explicit exclusions

No original music file damage; no audio focus overlap; no inaccurate current/draft revision, identity or Undo; no unconsented partial bridge; no misleading ready/rating states; no loss of 8-lane Studio, route aliases, deep links, source monitoring, corrections, preferences, blind study or revision-bound FLAC. This PR makes **no runtime, test, CI, API, backend or schema changes**.

**No desktop launcher, executable packaging, native file picker or browser-to-backend directory bridge.** SaaS is a possible distant future; **do not build remote upload, storage, accounts, auth, subscription, multi-tenancy, sync, telemetry or migration now**. Future SaaS requires separate owner-approved decisions.

## Status governance and evidence

- ADR decision: Proposed → Accepted / Rejected / Superseded with recorded owner decision.
- Task implementation: Not started → In progress (named PR) → Implemented (merged code + applicable tests).
- Independent verification: No → Yes (evidence from users, real-audio, actual visuals, accessibility, scale and privacy as relevant). Only Verified tasks get checked.
- A capability already in the repo is baseline, **not automatic completion of the new UX task**. Previous historical status headings predate PR #29 and require task-by-task reconciliation.

[Implementation checklist](selecta-experience-implementation-checklist.md) · [Evidence ledger](selecta-experience-evidence.md) · [Feature-parity map](selecta-experience-feature-parity.md) · [Historical status review](selecta-experience-status-reconciliation.md) · [Release gates](selecta-experience-release-gates.md).

## Research basis (patterns, not Selecta experiment outcomes)

- [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [Microsoft Research human-AI interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots/)
- [web.dev INP](https://web.dev/articles/inp)
