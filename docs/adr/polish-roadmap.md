# Selecta UI/UX polish - scope, ADR index and delivery roadmap

- **Decision status:** Accepted
- **Programme implementation status:** Not started
- **Date:** 2026-11-06
- **Planning baseline:** local main/origin/main at `fe785ec` when inspected.
- **This change:** documentation only. No application, audio, API, dependency, test or CI implementation.

## Outcome

Every screen, shared component and meaningful state should look deliberate and behave predictably, including skeleton loaders, empty/error states, tiny alignment details and failed-operation recovery. Retain Selecta's warm-black/cream/lime identity and its depth of music functionality. Professional finish is established through complete coverage and evidence, not a promise of subjective perfection.

## Relationship to the existing programme

These ADRs extend ADR-0001–0032 and do not reset their status or replace their feature-preservation contract. The older checklist and evidence remain historical sources. Some old prose describes pre-implementation plans while its later evidence records shipped work; use source inspection and linked evidence to reconcile that ambiguity before implementation. Do not treat contradictory old summary text as current truth.

The new P-task checklist is the canonical polish tracker. Decision status and implementation status remain separate. This planning PR does not accept ADRs and must not receive implementation.

## New ADR index

| ADR | Phase | Decision | Implementation |
|---|---|---|---|
| [ADR-0033 - Polish baseline, complete state inventory and evidence governance](adr-0033-polish-baseline-and-governance.md) | 0 | Accepted | Not started |
| [ADR-0034 - Precise visual foundations, typography and coherent iconography](adr-0034-polish-visual-system.md) | 1 | Accepted | Not started |
| [ADR-0035 - Complete shared control states, overlays and recoverable feedback](adr-0035-polish-components-and-feedback.md) | 2 | Accepted | Not started |
| [ADR-0036 - Content-shaped skeletons and truthful asynchronous state transitions](adr-0036-polish-loading-and-skeletons.md) | 2 | Accepted | Not started |
| [ADR-0037 - First-run setup, truthful readiness and local privacy explanations](adr-0037-polish-onboarding-and-readiness.md) | 3 | Accepted | Not started |
| [ADR-0038 - Mix browsing, creation defaults and unmistakable draft scope](adr-0038-polish-mixes-and-drafts.md) | 3 | Accepted | Not started |
| [ADR-0039 - Calm listening hierarchy, stable transport and shell continuity](adr-0039-polish-listen-and-shell.md) | 3 | Accepted | Not started |
| [ADR-0040 - Precise editing timeline and context-preserving transition inspector](adr-0040-polish-editor-and-inspector.md) | 4 | Accepted | Not started |
| [ADR-0041 - Readable Stem Studio grid, audition ownership and explicit commit state](adr-0041-polish-stem-studio.md) | 4 | Accepted | Not started |
| [ADR-0042 - Understandable requests, explicit bridge consent and auditionable discovery](adr-0042-polish-requests-and-discovery.md) | 3, 5 | Accepted | Not started |
| [ADR-0043 - Scannable Library, actionable Workshop and polished export/study flows](adr-0043-polish-library-and-workshop.md) | 5 | Accepted | Not started |
| [ADR-0044 - Consistent product vocabulary, truthful explanations and restrained motion](adr-0044-polish-language-and-motion.md) | 1 | Accepted | Not started |
| [ADR-0045 - Responsive workspace finish and complete accessible task journeys](adr-0045-polish-responsive-accessibility.md) | 6 | Accepted | Not started |
| [ADR-0046 - Visual regression, performance, listening and polish release gates](adr-0046-polish-verification-and-release.md) | 7 | Accepted | Not started |

## Delivery order and dependencies

0. **Baseline and scope.** Pin and capture the baseline; inventory every state and map existing capability/open tasks. Exit with traceable findings rather than speculative screenshots.
1. **Visual foundations and language.** Finish typography, layout, colour, icons, spacing, language and motion specifications. Review representative screen directions before broad migration.
2. **Shared components and loading.** Finish shared controls, overlays, actionable notifications and shaped skeleton/loading states. Review the full component gallery in both themes.
3. **Core listening, mixes and requests.** Apply the foundations to onboarding, Mixes/drafts, Listen/shell and Requests/bridge consent. Demonstrate the first-mix and uninterrupted-listening journeys.
4. **Editing and Stem Studio.** Polish Edit, transition inspector and Studio. Demonstrate current/draft isolation, exact-pair audition/commit and failure recovery.
5. **Library, discovery and operations.** Complete Library, Discover, Workshop, sources/storage, export and studies. ADR-0042's Discover work integrates here after shared audio/state controls.
6. **Responsive and accessibility verification.** Verify all migrated journeys across supported devices, real zoom, keyboard and assistive technology. Requirements apply throughout earlier phases.
7. **Integrated verification and release.** Review visual baselines, performance, recovery, real audio and unguided tasks; publish evidence and explicit release disposition.

These are dependency gates, not calendar estimates. Implementation may be split into reviewable future PRs once decisions are accepted. No new infrastructure, engine redesign, remote analytics, cloud service or native picker is implicitly required. Profile before choosing a rendering optimization.

## Review and release rules

- Preserve the whole [feature-parity matrix](feature-parity.md) and [existing test coverage](test-coverage-matrix.md).
- Review specification and representative visual direction before propagating it across screens.
- Record the implementing PR, changed P IDs, behavioural preservation, visual captures, tests and rollback scope.
- Update ADRs and [the evidence ledger](polish-implementation-evidence.md) as work lands.
- Never mark manual listening, screen-reader or task testing complete based on CI.
- Block release on lost data, wrong-mix edits, inaccessible essential controls, misleading pending states, unapproved/partial bridges, unintended silence/overlap, unsafe local access or invalid exports.
- Review every remaining detail defect; any accepted limitation must be named with a reason and disposition.

## Planning artifacts

- [143-task implementation checklist](polish-implementation-checklist.md)
- [Verification matrix and evidence requirements](polish-verification-matrix.md)
- [Implementation evidence ledger](polish-implementation-evidence.md)
- [Research and inspection notes](../research/ui-ux-polish.md)
