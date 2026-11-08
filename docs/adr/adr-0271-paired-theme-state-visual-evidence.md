# ADR-0271 — Matched light/dark route-state visual evidence and verification

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 8/8 Not started, 0/8 In progress, 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta final polish (FP), 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority/phase:** P0 / Cross-product verification.
- **Owner:** Unassigned.
- **Previous primary owners:** ADR-0201, ADR-0234, ADR-0239, ADR-0240, ADR-0247, ADR-0257. Previous decision/implementation states are unchanged.
- **Source touchpoints:** `web/e2e/visual.e2e.ts`; `web/e2e/creative-visualizers.e2e.ts`; `web/playwright.config.ts`; `docs/adr/selecta-flow-verification-matrix.md`.

## Context and evidence boundary

Visual E2E currently samples light at 320/1280px and dark at 375/1440px. Those candidate captures are not matched same-viewport pairs. Earlier ADR-0239 requires stable visual fixtures but does not define a per-route/state, paired light-and-dark acceptance denominator.

Source inspection is a gap hypothesis, not independent visual, usability, audio or accessibility proof. Existing features must be credited accurately after exact task acceptance comparison.

## Novel delta and proposed decision

**Delta:** Define *paired state-matched evidence governance*: same data, route/state, time, viewport, browser and motion setting in both themes, traceable to source SHA and human approval. No new visual framework or false claim that screenshots certify real sound.

**Decision:** Every critical route-state fixture must have equivalent light/dark screenshots; required-versus-accepted pairs are counted and reviewed. Automated pixel candidates, contrast and DOM tests support, but never substitute for independent human/AT/audio verification.

**Alternatives and limits:** Reject this delta when measured research disproves its need; do not introduce an unrelated architecture rewrite, new cloud service or automated claim of sign-off.

## Implementation checklist — 0/8 Implemented, 0/8 Independently Verified

1. **FP-0271-01 — Define canonical route-state fixtures.** **Acceptance:** Identify stable fixture IDs spanning Start, Setup, Explore, Listen, Stage, My Mixes, Edit, Inspector, Studio, Requests, Discovery, Library, Details, Workspace, Backups and Export, including key empty/error/loading states. **Required verification:** Source-linked route/state inventory, not just route names **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **FP-0271-02 — Capture paired theme instances.** **Acceptance:** For each critical fixture capture Light/Dark at the same viewport with identical music identity, state, motion, locale and server data. **Required verification:** Deterministic paired Playwright captures with fixture hashes **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **FP-0271-03 — Document viewport coverage denominator.** **Acceptance:** Require 320/375/768/1280/1440/1920px as applicable, and additional short landscape and 400% zoom checks. **Required verification:** Explicit required/captured coverage matrix and exclusions **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **FP-0271-04 — Verify semantic state parity.** **Acceptance:** Selection, focus, primary action, disabled state, lyrics, energy, seam and status meaning match across both themes beyond colour alone. **Required verification:** DOM and computed contrast comparisons plus visual review **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **FP-0271-05 — Record artifact provenance.** **Acceptance:** Capture source SHA, route, state ID, theme, viewport, browser, OS, fixture data version, date and redacted reviewer information. **Required verification:** Machine-checkable no-sensitive-data manifest **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **FP-0271-06 — Separate candidate from golden approval.** **Acceptance:** Automated captures and green CI remain unapproved candidates until a named person reviews exact pairs and records verdict. **Required verification:** Signed approval transition record and rejection rationale **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **FP-0271-07 — Link failures back to owning ADR.** **Acceptance:** Theme failures have exactly identified source state, owning SF/GP/FP task, severity and rerun evidence; old task histories remain intact. **Required verification:** Defect-to-task evidence crosswalk **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **FP-0271-08 — Block release on missing critical review.** **Acceptance:** Publish completed/required pair denominator, open P0s, exact source SHA, reviewers and documented GO/NO-GO. **Required verification:** Independent signed release gate; no silently inferred verification **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Negative tests, safeguards and independent proof

**Area-specific:** extreme title length, duplicate IDs, paused/transition, Studio 64 cells, open Inspector, backend error/offline, running export, PWA, system theme mismatch, reduced motion, forced-colours, deep links.

**Common:** light/dark/system, forced colours, 320–2560px, short landscape, 400% zoom, Still/reduced motion, stale/offline/loading/failure, long/RTL/Unicode/duplicate metadata, keyboard/touch/NVDA, real audio and hardware where relevant.

**Non-negotiable:** Original local media unchanged; one audio owner/intentional Pause; stable song and seam identities, scoped draft/current revisions and Undo; consented atomic request bridge; eight Studio lanes and 8–64 cells; truthful readiness/LRCLIB disclosure; unbiased listening studies; frozen-revision decodable FLAC. No SaaS/telemetry/cloud audio/new platform.

**Verification:** Machine-readable fixture manifest, pair coverage numerator/denominator and independent reviewed approvals. No Verified claim without named reviewer/date/platform, exact implementing source SHA, concrete outcomes and independently reviewed evidence. Muted synthetic tests/screenshots are *not* audio proof.

## Decision and implementation status governance

Proposed → Accepted/Rejected/Superseded requires explicit owner/date/rationale. Not started → In progress → Implemented requires linked source/test implementing PR/SHA. Verification No → Yes requires independent human/AT/audio/device proof. A docs-only PR does **not** satisfy implementation; no old programme status is changed.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Release](selecta-final-polish-release-gates.md).
