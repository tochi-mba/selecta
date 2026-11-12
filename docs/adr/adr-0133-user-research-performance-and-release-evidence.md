# ADR-0133 - Uncoached user research, real performance and release evidence

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 5/5 Implemented (2026-11-12; code part only: study tool, visual approvals, scale profile, session scripts, rollback harness; the 20k profile and old-new-old runs are pending).
- **Verification:** No (0/5 tasks independently Verified).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, after merged PR #29.
- **Priority / phase:** P0 / Quality.
- **Related earlier ADRs:** ADR-0111, ADR-0112, ADR-0113. Historical decisions are preserved, not automatically superseded.
- **Source touchpoints:** `web/e2e/visual.e2e.ts`, `web/e2e/finishing.e2e.ts`, `web/bench/scale.bench.ts`, `docs/adr/selecta-4-release-gates.md`.

## Context and limits of current evidence

The repository has Vitest, Playwright, axe and scale benchmarks. Earlier 3.1 and 4.0 documents explicitly distinguish candidate screenshots from approved baselines and CI from subjective real-audio or human accessibility acceptance. Source observations and earlier planning are not proof of user task outcomes, accessible operation or current visual quality.

## Proposed decision

- Run task-based baseline and redesigned-candidate sessions with first-time listeners, regular listeners, creators and experienced users; record hesitations, errors and recovery.
- Collect deterministic dark/light screenshots of actual interactions and states, then require explicit human visual approval before accepting snapshot changes.
- Measure 20k library, 100-song editor, 64-cell Studio and audio playback continuity on named hardware, distinguishing local lab from real field data.
- Use evidence-backed initial targets (e.g. 90% uncoached core-task completion, 200ms INP where measurable), with denominators and limitations. Targets are not current results.
- Require exact candidate SHA CI, audio/AT/human review, zero P0, explicit P1 disposition and old-new-old rollback before an owner GO.

## Alternatives and rationale

Green CI only is fast but insufficient. Waiting for subjective universal perfection is impossible. Define release-blocking safety/AT/task outcomes and evidence-driven visual refinements.

## Consequences and boundaries

A numerical pass rate from tiny samples is unreliable; publish raw counts and task definitions. No automatic visual snapshot rebaseline or assertions weakened for redesign. Preserve old routes, preferences, original media, current/draft/revision identity, single audio owner, Undo, consented atomic bridges, full Studio control, blind study integrity and correct FLAC. No near-term desktop packaging or SaaS migration, no silent backend/audio/API changes or remote telemetry.

## Implementation tasks (all Not started; Verified: No)

1. **EX-0133-01 - Define and run baseline UX tasks**. Acceptance: Observed errors and outcomes separated from design hypotheses. Required verification: Consented uncoached sessions. **Implementation: Implemented (2026-11-12; code part); Verified: No. Evidence: observed-versus-hypothesis session records and report in `src/selecta/audit/ex_study.py` (`tests/test_ex_study.py` 13/13 passed 2026-11-12). Needs a person: consented, uncoached participant sessions, recorded with `python -m selecta.audit.ex_study template` and scored with `score`**
2. **EX-0133-02 - Establish approved visual baselines**. Acceptance: All key states, themes and browser environments reviewed. Required verification: Playwright snapshots plus reviewer. **Implementation: Implemented (2026-11-12; code part); Verified: No. Evidence: capture inventory and hash-pinned reviewer approvals in `src/selecta/audit/visual_approvals.py` (`tests/test_visual_approvals.py` 5/5 passed 2026-11-12). Needs a person: a named reviewer looks at every capture per browser and records approval with `python -m selecta.audit.visual_approvals approve <folder> --reviewer <name> --browser <browser>`**
3. **EX-0133-03 - Benchmark meaningful scale**. Acceptance: Latency, memory and audio continuity on recorded hardware. Required verification: 20k/100-song/64-cell profile. **Implementation: Implemented (2026-11-12; code part); 20k run pending; Verified: No. Evidence: 20k/100-song API and memory profile with hardware record `tests/ex_0133_scale_profile.py` (`tests/test_ex_0133_scale_profile.py` 2/2 passed 2026-11-12 at small size; 20k run pending). Needs a person: run `python tests/ex_0133_scale_profile.py 20000 100 profile.json` and the T0265 browser profile on named, recorded hardware, and listen for audio continuity**
4. **EX-0133-04 - Verify real audio and assistive access**. Acceptance: Audible seam, Stage, previews, NVDA and export checked. Required verification: Human listening and AT signoff. **Implementation: Implemented (2026-11-12; code part); Verified: No. Evidence: listening (Sitting 4, `tests/check_export_audio.py`) and AT (Sitting 2) scripts in `docs/verification/owner-runbook.md`. Needs a person: human listening of seams, Stage, previews and export, plus NVDA/AT sign-off**
5. **EX-0133-05 - Conduct exact-head release and rollback**. Acceptance: No P0 and all risks approved before GO. Required verification: CI, old-new-old restoration, decision record. **Implementation: Implemented (2026-11-12; code part); exact-head run pending; Verified: No. Evidence: old-new-old harness `tests/rollback_check.py` plus PR gate `src/selecta/audit/pr_slice_gate.py`; exact-head run pending. Needs a person: run `python tests/rollback_check.py <older checkout>` at the exact release SHA after green CI, then record the owner GO decision with no P0 open and every risk approved**

## Verification and sources

Test dark/light/system themes, long/RTL metadata, 320–2560px viewports and 200/400% zoom, keyboard/touch/NVDA, reduced motion and async failure/race states. Real media and export must be heard/decoded as applicable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Playwright visual testing](https://playwright.dev/docs/test-snapshots) · [web.dev INP](https://web.dev/articles/inp). These sources inform design methods, not reported Selecta test results. See [roadmap](selecta-experience-roadmap.md), [checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
