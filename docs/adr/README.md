# Selecta - Selecta Cloud (SaaS) proposal (2026-11-09)

**26 accepted ADRs, [ADR-0391](adr-0391-selecta-cloud-goal-and-local-guarantees.md) to [ADR-0416](adr-0416-rooms-guest-requests.md):** a subscription cloud edition beside the local app, from one codebase. Free, Standard and Premium plans (10, 50 and 100 GB); a durable job queue in Postgres with per-account fair shares by tier, leases and fencing; workers that scale by adding containers; R2 storage with server-completed uploads; Stripe billing; Lucy routed to hosted models per tier; staff roles and an admin console; one playing device per account; Premium Rooms with QR-code guest requests; and layered feature-flag targeting on top of [ADR-0390](adr-0390-feature-flags.md). All 26 Accepted by the owner on 2026-11-09; implementation tracked in the [checklist](selecta-cloud-implementation-checklist.md); 0 independently Verified. Baseline main `3c2f1eb`.

**Scope:** Local mode keeps every guarantee in earlier ADRs, including ADR-0025 and ADR-0072, and its flags behave exactly as ADR-0390 describes; ADR-0391 scopes the earlier SaaS non-goals to local mode without changing any older status. The [mode-by-mode guarantee table](../saas/README.md#guarantees-by-runtime-mode) is the concise contract for both runtimes.

**Start here:** [Proposal](../saas/README.md) · [Queue and scheduling](../saas/04-queue-and-scheduling.md) · [Devices and Rooms](../saas/11a-devices-and-rooms.md) · [Feature flags](../saas/11b-feature-flags.md) · [Roadmap and risks](../saas/17-roadmap-and-risks.md) · [Licence register](../saas/licence-register.md)

---

# Selecta - Feature flags ADR proposal (2026-11-09)

**One proposed ADR, [ADR-0390](adr-0390-feature-flags.md):** a single feature-flag registry for every feature, read by the server, the site, the CLI and the tests, with a browser sweep that checks every page with each feature turned off. 7 of 8 tasks Implemented, 1 In progress, 0 independently Verified. The catalog is [docs/flags.md](../flags.md).

---

# Selecta - Unified Experience Finish ADR proposal (2026-11-08)

**Unified experience finishing programme:** 24 **Accepted** ADRs (0366–0389); **192 UF acceptance items**: 184 Not started, 8 In progress, 0 Implemented and **0 independently Verified**. Requester accepted all UF decisions on 2026-11-08; PR #41 now contains app code and tests. Implementation owners and independent reviewers remain unassigned. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526`.

**Scope:** one source-verified finishing sequence, not a competing redesign: baseline research and parity → semantic CSS, primitives and async state → navigation and playback → Listen/visualisers → Make a Mix/Library/Lucy integration → drafts, Editor, Seam Inspector and Stem Studio → Requests, Discovery, Workspace and Export → responsive/accessibility → independent visual, human, performance and real-audio release gates. This PR changes **only `docs/adr/` markdown/JSON**, not application source/tests/audio or older ADR historical statuses.

**Authority:** SF/GP/FP/MP visual components and metrics retain existing ownership; LU owns Lucy agent/ready-only correctness; LX owns detailed Library/Make a Mix/Lucy redesign. UF adds cross-screen integration and verification requirements, never claims source-present features are missing simply because proposed task counters start at zero.

**Start here:** [Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)

---

# Selecta - Library + Lucy experience redesign ADR proposal (2026-11-08)

**New docs-only, scoped redesign programme:** 26 **Proposed** ADRs (0340–0365), 208 individually tracked **Not started** LX implementation tasks, 0 In progress, 0 Implemented and 0 independently Verified. All owners unassigned. Planning baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.

**Scope:** Full visual/interaction freedom **only** for Library / Song Details and the Make a Mix front door / Lucy conversation, proposals and approval. Existing application code, tests, audio engine, older ADR statuses and unrelated routes are unchanged. The proposed redesign is **not** claimed implemented or measured.

**Start here:** [Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)

---

# Selecta - proposed measured UI/UX micro-polish ADRs (2026-11-08)

**New documentation-only programme:** [28 ADR roadmap](selecta-measured-micro-polish-roadmap.md) · [224 implementation tasks](selecta-measured-micro-polish-implementation-checklist.md) · [per-task evidence](selecta-measured-micro-polish-implementation-evidence.md) · [status JSON](selecta-measured-micro-polish-code-status.json) · [overlap](selecta-measured-micro-polish-overlap-and-parity.md) · [geometry](selecta-measured-micro-polish-geometry-contract.md) · [verification](selecta-measured-micro-polish-verification-matrix.md) · [reconciliation](selecta-measured-micro-polish-status-reconciliation.md) · [release](selecta-measured-micro-polish-release-gates.md).

**Status:** 28 Proposed decisions, 224 Not started acceptance items, 0 In progress, 0 Implemented, 0 independently Verified. All owners unassigned. Baseline `100df404` on 2026-11-08. No application source, tests, audio or older programme status changed.

Scope: down-to-the-pixel polish of all routes, shared components, titles, margins, alignments, player, editor, Studio, Requests, Library, Discover, Workspace, Export, overlays, motion and responsive/AT/real-audio acceptance. Existing capabilities are credited and old ADR owners retain authority.

---

# Selecta - final-polish incremental UI/UX ADRs (2026-11-08)

**Documentation-only proposal:** [Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [JSON](selecta-final-polish-code-status.json) · [Parity](selecta-final-polish-overlap-and-parity.md) · [Verification](selecta-final-polish-verification-matrix.md) · [Reconciliation](selecta-final-polish-status-reconciliation.md) · [Release](selecta-final-polish-release-gates.md)

**Status:** 8 ADRs (0264–0271) Proposed / owner review pending; 64 FP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified. Baseline main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`. No app source, tests, previous programme ledger, media or other functionality is modified by this proposal.

**Scope:** additive acceptance for light-mode functional boundaries, manual theme/browser chrome, live music-graphics theme parity, contextual Library selection controls, Explore information density, route-state action tiering, stacked viewport/overlay occlusion and matched Light/Dark visual evidence. Already-source-present capabilities are **not** missing features; reconcile each FP item against SF and GP requirements before any implementation.

---

# Selecta - new proposed gap-focused UI/UX polish ADRs (2026-11-08)

**Docs-only proposal:** [16 ADR roadmap](selecta-gap-polish-roadmap.md) · [128 implementation tasks](selecta-gap-polish-implementation-checklist.md) · [per-task evidence ledger](selecta-gap-polish-implementation-evidence.md) · [machine-readable status](selecta-gap-polish-code-status.json) · [whole-product overlap/parity](selecta-gap-polish-overlap-and-parity.md) · [independent verification](selecta-gap-polish-verification-matrix.md) · [historic status reconciliation](selecta-gap-polish-status-reconciliation.md) · [NO-GO gates](selecta-gap-polish-release-gates.md).

**Statuses:** 16 Proposed decisions (owner review pending); 128 tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Baseline `2956bc47fd735339e7216e03d27817fb3a31e92b`. No source implementation, old programme ledger, audio file or production test is modified.

The additions concern adaptive titles, Listen and Editor visual priority, music-aware search, re-linking, local backups, audio output interruptions, returning work, help, long-session fatigue, safe batch operations, mix-choice predictions, Discovery handoff, Studio comprehension, request uncertainty and Workspace troubleshooting. Existing SF ADR owners retain first-run, all fifteen visualizers, frozen-revision FLAC, baseline WCAG and audio/player safety.

---

# Selecta / Flow - owner-accepted artistic UI/UX programme (2026-11-08)

**Owner-accepted design programme (2026-11-08):** **50 Accepted decisions, ADR-0198–0247; 400 SF implementation tasks Not started; 0 In progress, 0 Implemented and 0 independently Verified.** The new programme builds on the source as of main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15` and does **not** mark existing source capabilities missing, revise old implementation histories or change any application code.

**Start here:** [50-ADR roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [per-task status and independent evidence ledger](selecta-flow-implementation-evidence.md) · [machine-readable statuses](selecta-flow-code-status.json) · [art direction and screen contracts](selecta-flow-design-contracts.md) · [feature preservation](selecta-flow-feature-parity.md) · [motion and interaction matrix](selecta-flow-interaction-matrix.md) · [source map](selecta-flow-source-map.md) · [verification matrix](selecta-flow-verification-matrix.md) · [historical status reconciliation](selecta-flow-status-reconciliation.md) · [independent NO-GO gates](selecta-flow-release-gates.md).

**Direction:** Music is art: cinematic Listen, expressive Explore and precise tactile Create; real handoff choreography and truthful musical visuals. Preserve one audio owner/manual Pause, original local media, current/draft revision and Undo, consented atomic request bridges, full eight-lane Studio, honest Library status and exact frozen-revision FLAC. The fifteen currently source-present spectrum styles remain preserved; new visualizer work concerns polish and independent acceptance, not a claim they are absent. No SaaS, accounts, subscription, cloud media, telemetry, launcher or source audio changes now.

**Status discipline:** Owner-accepted decision ≠ implementation ≠ independent verification. Previous T/P/S3/S31/S4/EX/MI/CI history remains exactly as published. This new programme's NO-GO gate applies to the **proposed redesign**, not the current app's fitness.

---

# Selecta - creative-interface synthesis ADR programme (2026-11-08): 33 accepted decisions

**Owner-accepted creative-interface programme (all 20 decisions accepted 2026-11-08; originally submitted as documentation only):** [20 ADRs, ADR-0165–0184](selecta-creative-interface-roadmap.md) · [140-task implementation checklist](selecta-creative-interface-implementation-checklist.md) · [per-task implementation and verification evidence](selecta-creative-interface-implementation-evidence.md) · [feature-parity inventory](selecta-creative-interface-feature-parity.md) · [interaction and motion matrix](selecta-creative-interface-interaction-matrix.md) · [verification matrix](selecta-creative-interface-verification-matrix.md) · [historical status reconciliation](selecta-creative-interface-status-reconciliation.md) · [NO-GO release gates](selecta-creative-interface-release-gates.md).

**New CI status:** 20 **Accepted** decisions (owner approved 2026-11-08); **140 Not started**, 0 In progress, 0 Implemented; **0 independently Verified**. Baseline: main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd (2026-11-08). The original PR submission changed only ADR and planning documents; subsequent source implementation is recorded in the CI evidence ledger.

**Four additional accepted, width-first Listen visualizer ADRs:** [ADR-0185 Aurora Contours](adr-0185-aurora-contours.md), [ADR-0186 Spectral Lanes](adr-0186-spectral-lanes.md), [ADR-0187 Frequency Constellation](adr-0187-frequency-constellation.md), [ADR-0188 Recent Spectrum](adr-0188-recent-spectrum.md). Owner accepted 2026-11-08. Source and tests are being implemented on PR #33; independent accessibility, real-audio and measured performance sign-off remains open. Together with the original 20, this is **24 accepted decisions**. The existing 140-task checklist remains the original programme and is not automatically checked by adding these ADRs.

**Five further owner-accepted width-friendly visualizer ADRs:** [ADR-0189 Spectrum Skyline](adr-0189-spectrum-skyline.md), [ADR-0190 Glass Threads](adr-0190-glass-threads.md), [ADR-0191 Signal Pins](adr-0191-signal-pins.md), [ADR-0192 Spectrum Mosaic](adr-0192-spectrum-mosaic.md), and [ADR-0193 Afterglow Trails](adr-0193-afterglow-trails.md). Accepted on 2026-11-08 and implemented as WIP on PR #33. All five retain unverified final CI, visual, real-audio and accessibility acceptance gates. Total: **29 accepted decisions** (20 original + 9 additional audio-visualizer decisions). The original 140-task implementation checklist is unchanged until individual tasks satisfy their acceptance criteria.

**Four latest owner-approved landscape visualizer ADRs:** [ADR-0194 Spectral Dunes](adr-0194-spectral-dunes.md), [ADR-0195 Signal Ranges](adr-0195-signal-ranges.md), [ADR-0196 Frequency Mesh](adr-0196-frequency-mesh.md), and [ADR-0197 Split Flow](adr-0197-split-flow.md). With the original two spectrum modes plus thirteen additional choices, **Listen now offers fifteen horizontal visualizers**; the creative-interface programme now has **33 accepted ADRs** (20 original + 13 visualizer decisions). Code is pushed to PR #33; CI, real-audio, accessibility, performance and human review remain separate acceptance gates. The legacy 140-task ledger has not been automatically marked complete.

**Keep earlier MI statuses separate:** ADR-0135–0164 previously recorded 208 source-level Implemented, 4 In progress, 28 Not started and 0 independently Verified in their own published ledger. The new creative-interface proposals concern cross-screen musical object identity, expressive yet honest interaction, meaningful visual handoffs and independent user acceptance; no existing MI implementation is automatically marked a new CI task complete.

---

# Selecta - immersive experience and microinteraction ADR programme (2026-11-07)

**Immersive programme (documentation + implementation on PR #31):** [30 new ADRs, ADR-0135–0164](selecta-microinteraction-roadmap.md); [240 individually tracked tasks](selecta-microinteraction-implementation-checklist.md); [per-task implementation/verification evidence](selecta-microinteraction-evidence.md); [full interaction/motion specification](selecta-microinteraction-motion-matrix.md); [feature preservation map](selecta-microinteraction-feature-parity.md); [verification matrix](selecta-microinteraction-verification-matrix.md); [historical status reconciliation](selecta-microinteraction-status-reconciliation.md); [NO-GO release gates](selecta-microinteraction-release-gates.md).

**New programme status on [PR #31](https://github.com/tochi-mba/selecta/pull/31):** **30 Accepted decisions (owner acceptance recorded 2026-11-07); 208 source-level Implemented, 4 In progress, 28 Not started; 0 independently Verified.** [Code status map](selecta-microinteraction-code-status.json) and [240-task checklist](selecta-microinteraction-implementation-checklist.md) identify which implementation boxes are checked and what still needs task-specific acceptance. Source baseline was main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` after PR #30. Source changes and green tests are not visual approval, assistive-technology acceptance, independent real-audio/performance evidence or proof that a transition sounds good.

**Vision:** Give Selecta an earned sense of musical anticipation and agency: song-first composition; tactile controls; real seam handoff; delightful but restrained discoveries; expressive energy and stem editing; truthful status; calm recovery. Every animation has a cause, an accessible reduced-motion equivalent and an audio/state truth contract. No fabricated artwork, beat alignment, quality scores or success states.

**Preserve current product boundary:** Browser + local-only server, no desktop packager/launcher, native/browser folder-picker bridge, near-term SaaS, account/cloud sync, remote media upload, telemetry or unsolicited UI sounds. Preserve original media, LRCLIB metadata disclosure, one audio owner, draft/revision guards, consented atomic bridge, eight-lane Studio, blinded research and exact FLAC.

**Status caution:** Earlier T/P/S3/S31/S4/EX ledgers are historical and not rewritten here. Existing behavior that resembles a new requirement does not automatically mark it implemented or verified. See [cross-programme status mapping](selecta-microinteraction-status-reconciliation.md).

---

# Selecta - experience-first UI/UX ADR proposal (2026-11-07)

**New documentation-only proposal:** [21 independent new design decisions, ADR-0114–0134](selecta-experience-roadmap.md); [105-item implementation checklist](selecta-experience-implementation-checklist.md); [per-task implementation/verification ledger](selecta-experience-evidence.md); [feature-parity map](selecta-experience-feature-parity.md); [historical status reconciliation](selecta-experience-status-reconciliation.md); [NO-GO release gates](selecta-experience-release-gates.md).

**New ADR status:** 21 **Proposed** (not owner-accepted). **New implementation:** 105 **Not started**, 0 Implemented. **New independent verification:** 0 Verified. **Reviewed source baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged [PR #29](https://github.com/tochi-mba/selecta/pull/29).

**Direction:** Listening effortless; mix creation expressive; expert editing precise; operations quiet. These decisions go beyond cosmetics and independently reconsider navigation, optional mix shaping, card action hierarchy, editor song/seam objects and an audition-first inspector. All are user-testable proposals, not claims of measured failure or approved implementation.

**Owner-directed scope:** **Do not build a desktop launcher/installer, native folder picker or browser directory bridge.** Selecta may move to SaaS much later, but **no SaaS implementation now**. The current browser plus local server must keep working, along with original media safety, audio ownership, routes, drafts, requests, Studio, privacy, studies and exact-revision FLAC.

**Status caution:** The 4.0 tracker was written before merged PR #29. Its 250 unchecked / 0 documented Implemented tasks are historical *tracker entries*, **not** proof of current post-merge code completeness. The new [reconciliation file](selecta-experience-status-reconciliation.md) explicitly preserves older S4/S31/S3/T/P records and requires task-specific evidence before changing any implementation or verification state.

---

# Selecta 4.0 - complete UI/UX overhaul ADR programme (2026-11-07)

**This is a documentation-only proposal: ADR-0089–0113, 25 Proposed decisions, 250 new S4 tasks Not started, 0 Implemented, 0 Verified.** Baseline: `main` `9b663f9f10212619f27ce67ce82f602347065cbd` after PR #25 and #26 merged. Keep the warm charcoal/cream/electric lime scheme, improve dark and light themes, and preserve all existing functionality, original audio, local-first security, requests, Studio, drafts and FLAC.

**Start with:** [Selecta 4.0 roadmap and full ADR index](selecta-4-roadmap.md) · [250-item implementation checklist](selecta-4-implementation-checklist.md) · [per-task status/evidence ledger](selecta-4-evidence.md) · [feature-parity map](selecta-4-feature-parity.md) · [verification and edge-case matrix](selecta-4-verification-matrix.md) · [4.0 implementation release NO-GO](selecta-4-release-gates.md).

**Status discipline:** Decision status Proposed/Accepted is different from implementation Not started/In progress/Implemented and independent Verified. A documentation PR may merge while every new task remains unchecked. Earlier 3.0/3.1 ADRs and status tables are historic and may contain stale PR-open text; do not automatically mark inherited items complete or superseded. Only later implementing PRs with actual tests, reviewed dark/light screenshots, human AT/usability, real audio, performance and rollback evidence can advance S4 statuses.

---

# Selecta 3.1 - verification-led UI/UX finishing proposal (2026-11-07)

**Proposed decisions: ADR-0078–0088. Selected tasks now In progress on PR #25; 116 tasks: 0 Implemented / 0 Verified. Checkboxes remain open.** This programme follows merged PR #24 and focuses on evidence, visual consistency, listener/creator workflow polish and human acceptance-not another feature rewrite. PR #25 began as documentation-only and now includes multiple scoped frontend/test changes and review-only visual CI artifacts, without human verification.

Start with the [3.1 roadmap and ADR index](selecta-3-1-roadmap.md), [116-item checklist](selecta-3-1-implementation-checklist.md), [verification matrix](selecta-3-1-verification-matrix.md), [evidence ledger](selecta-3-1-evidence.md), [unapproved visual-review candidates](selecta-3-1-visual-review.md), [source surface inventory](selecta-3-1-surface-inventory.md), [NO-GO release readiness](selecta-3-1-release-readiness.md) and [research notes](../research/selecta-3-1-polish.md). Prior ADR-0001–0077 and T/P/S3 trackers are preserved. **Historical 3.0 "PR #24 open" statements in older files are stale after the merge and must be reconciled against code/CI before any status is advanced.**

---

# Selecta 2.0 - UI/UX architecture decision records

## Selecta 3.0 - full experience overhaul proposal (2026-11-07)

**Decision status: Proposed. Implementation status: In progress on PR #24; not Verified.** See the [new roadmap and ADR index](selecta-3-roadmap.md), ADR-0047–0077, [258 individually tracked work items](selecta-3-implementation-checklist.md), [feature preservation map](selecta-3-parity-matrix.md), [verification plan](selecta-3-verification-matrix.md), [evidence ledger](selecta-3-evidence.md) and [research notes](../research/selecta-3-overhaul.md).

This programme began **documentation only**, but PR #24 now includes runtime, audio, API, frontend and test changes. Its historical roadmap/checklist status summaries are not complete implementation evidence. Retain the warm black/cream/lime identity and the complete functional preservation contract while proposing an extensive navigation and workspace overhaul. Merging this proposal does not itself approve any decision or mark an implementation task complete.

Earlier ADR-0001–0046 history is retained. Older headline status summaries may be stale: PR #23 has merged, but actual implementation and verification evidence must be reconciled before any new code work.

## New UI/UX polish programme (2026-11-06)

The [polish roadmap and ADR index](polish-roadmap.md) adds ADR-0033–0046 and a separate [143-task implementation checklist](polish-implementation-checklist.md). Every new decision is **Proposed** and every new implementation is **Not started**. This is a documentation-only proposal; it does not reset or complete the older programme below.

See the [polish verification matrix](polish-verification-matrix.md), [evidence ledger](polish-implementation-evidence.md) and [research notes](../research/ui-ux-polish.md). Historical summary statements below belong to the original programme; use its linked evidence and source inspection to reconcile them, not as the status of this new plan.

## Original programme

**Document decision status: Proposed**  
**Overhaul implementation status: In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))**  
**Proposed date: 2026-11-06**

These documents propose a complete future redesign with full functional preservation. They do **not** implement the redesign, update the backend, modify audio behaviour, replace current tests or constitute evidence that any feature has shipped. Review and separately accept each decision before implementation.

## Vision and non-negotiable preservation

Selecta remains an offline/local-first DJ for the user's own music. Listening is effortless; creation and technical details are available on demand. Keep the existing warm dark/cream/electric lime identity, blue request semantics, warning orange, the current transition engine, drafted mixes, live requests with bridge approval, stem editing, word/harmonic discovery, evaluation and real FLAC export. Never trade away user intent, privacy, data integrity or audio correctness for visual polish.

## Dual status model

- **Decision status:** Accepted → Accepted; or Rejected / Superseded with rationale.
- **Implementation status:** Not started → In progress → Implemented → Verified.
- **Implemented** means code and its required tests have merged; **Verified** additionally requires recorded acceptance, regression, accessibility and audible evidence as applicable.
- Documentation can be merged while every decision remains Proposed and every implementation remains Not started.
- Any implementing PR updates the ADR, this index, feature parity, roadmap and tests with explicit PR/commit evidence. Never mark an item done based on a plan, screenshots or mocked success alone.

## ADR index

| ADR and decision | Decision status | Implementation status | Phase |
|---|---|---|---|
| [ADR-0001 - Product contract, scope and no-regression guarantees](adr-0001-product-contract-and-parity.md) | Accepted | In progress | 0 |
| [ADR-0002 - Contextual navigation, routing and persistent player shell](adr-0002-routing-and-shell.md) | Accepted | Implemented | 2 |
| [ADR-0003 - Semantic design system retaining Selecta's colours](adr-0003-design-tokens-and-brand.md) | Accepted | In progress | 1 |
| [ADR-0004 - Reusable controls, overlays, status and undo](adr-0004-interaction-primitives-and-notifications.md) | Accepted | In progress | 1 |
| [ADR-0005 - Typed API state, revisions and optimistic mutation consistency](adr-0005-domain-state-mutations.md) | Accepted | In progress | 3 |
| [ADR-0006 - Web Audio transport, seeking and Media Session semantics](adr-0006-audio-transport-and-media.md) | Accepted | In progress | 4 |
| [ADR-0007 - Coordinating main player and all audition audio](adr-0007-audio-focus-ownership.md) | Accepted | In progress | 4 |
| [ADR-0008 - Listen composition, waveform and next-transition clarity](adr-0008-listen-screen.md) | Accepted | In progress | 4 |
| [ADR-0009 - Synchronized lyrics, lyric focus and fullscreen Stage](adr-0009-lyrics-and-stage.md) | Accepted | In progress | 4 |
| [ADR-0010 - Vibe discovery, featured choice and build preparation](adr-0010-mix-discovery.md) | Accepted | In progress | 5 |
| [ADR-0011 - Energy curve, duration, transition feel and destination scope](adr-0011-steering-and-energy.md) | Accepted | In progress | 5 |
| [ADR-0012 - My Mixes projects, draft operations and render queue](adr-0012-drafts-and-queue.md) | Accepted | Implemented | 6 |
| [ADR-0013 - Song/seam arrangement timeline and stable edit scope](adr-0013-edit-timeline.md) | Accepted | In progress | 6 |
| [ADR-0014 - Seam inspector, cues, previews, fallbacks and auditing](adr-0014-seam-inspector.md) | Accepted | In progress | 6 |
| [ADR-0015 - Live Requests, route consent and atomic bridge joining](adr-0015-requests-and-bridges.md) | Accepted | In progress | 7 |
| [ADR-0016 - Stem Studio 64-cell creative workstation](adr-0016-stem-studio.md) | Accepted | In progress | 8 |
| [ADR-0017 - Library scale, filters and canonical mix readiness](adr-0017-library-scale-and-readiness.md) | Accepted | Implemented | 9 |
| [ADR-0018 - Analysis overrides and secure library-source management](adr-0018-library-corrections-and-folders.md) | Accepted | In progress | 9 |
| [ADR-0019 - Word-link discovery and harmonic staged auditions](adr-0019-discover-words-and-harmony.md) | Accepted | In progress | 9 |
| [ADR-0020 - Workshop, background processing, queue and cache transparency](adr-0020-workshop-and-storage.md) | Accepted | In progress | 10 |
| [ADR-0021 - Blind A/B evaluation protocols and reliable submission](adr-0021-blind-listening.md) | Accepted | In progress | 10 |
| [ADR-0022 - Rendered FLAC export and artifact lifecycle](adr-0022-flac-export.md) | Accepted | In progress | 6 |
| [ADR-0023 - WCAG 2.2 AA, screen readers and keyboard conventions](adr-0023-accessibility.md) | Accepted | In progress | 1–12 |
| [ADR-0024 - Mobile, tablet, wide-screen and high-zoom workspace design](adr-0024-responsive-workspaces.md) | Accepted | In progress | 2–12 |
| [ADR-0025 - Local-only security, privacy and filesystem boundaries](adr-0025-local-privacy.md) | Accepted | Implemented | 3–13 |
| [ADR-0026 - Additive backend contracts, stable identifiers and feature detection](adr-0026-api-compatibility.md) | Accepted | In progress | 3–10 |
| [ADR-0027 - Truthful AI explanations and musical feedback](adr-0027-explanations-and-feedback.md) | Accepted | In progress | 4–10 |
| [ADR-0028 - Backend-offline recovery, conflicts and multiple tabs](adr-0028-recovery-and-multitab.md) | Accepted | In progress | 3–12 |
| [ADR-0029 - Regression strategy, real audio fixtures and release quality gates](adr-0029-testing-and-quality.md) | Accepted | In progress | 0–13 |
| [ADR-0030 - Incremental migration, rollback and ADR status governance](adr-0030-migration-and-release.md) | Accepted | Implemented | 0–13 |
| [ADR-0031 - Installed PWA, browser features and platform integrations](adr-0031-pwa-and-browsers.md) | Accepted | In progress | 2–13 |
| [ADR-0032 - Privacy-safe diagnostics and truthful background-job feedback](adr-0032-diagnostics-and-operations.md) | Accepted | In progress | 10–13 |

## Planning and verification artifacts

- [What's done, task by task](implementation-evidence.md) - all 279 tracker tasks.
- [Implementation roadmap and release gates](implementation-roadmap.md) - phase by phase.
- [Feature preservation and no-regression matrix](feature-parity.md) - every feature and where it now lives.
- [Existing/new test and edge-case matrix](test-coverage-matrix.md) - which suite covers what.
- [Current acceptance ledger](../acceptance.md) records existing, measured behaviour and limits; do not overwrite it with speculative future success.
- [UI/UX research notes](../research/ui-ux.md) give precedent and documented uncertainty.

## How to maintain these ADRs

1. Record the implementation issue/PR and dependencies in the relevant ADR status history.
2. Decide Accepted, Rejected or Superseded explicitly; docs existence does not imply acceptance.
3. Add implementation PRs incrementally; keep every capability in the parity matrix.
4. Update tests and acceptance evidence before moving from Implemented to Verified.
5. Do not remove source features or weaken behavioural tests merely to make a new layout seem complete.
6. Treat audio continuity, wrong-mix edits, request atomicity, source-file safety, a11y, export correctness and localhost protections as release blockers.

**Current status of the whole Selecta 2.0 programme: Not started. This PR is documentation-only.**
