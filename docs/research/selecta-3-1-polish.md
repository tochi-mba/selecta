# Selecta 3.1 — UI/UX finishing research basis and confidence boundary

- **Date:** 2026-11-07.
- **Purpose:** trace the existing research and source-observed issues to a verification-first finishing programme, without claiming new experiments or new implementation.
- **Source baseline:** `main` merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831` (PR #24).
- **Evidence limit:** repository code and documents were inspected; source observations are not screenshots, WCAG attestations, participant outcomes, machine measurements or audible reviews.

## Existing implementation and what this plan adds

| Source | Source-observed state (not independent visual confirmation) | Finishing hypothesis / proposed proof |
|---|---|---|
| `web/src/styles/tokens.css`, `web/src/main.tsx` | Both themes and design tokens exist; eight CSS imports include legacy `style.css` and newer layered CSS | Audit cascade ownership, long metadata, states and actual pixel/contrast results in both themes (ADR-0079) |
| `web/src/shell/Shell.tsx`, `web/src/views/Now.tsx` | Rail, bottom nav, mini-player and Stage exist with responsive geometry; music options are extensive | Validate listener hierarchy, short viewports, keyboard inset, focus and actual audio continuity (ADR-0082) |
| `web/src/ui/controls.tsx`, `web/src/state/activity.ts` | Asynchronous actions, overlays, statuses and durable Activity/Undo exist | Confirm focus/overlay traps, burst Undo survival, accessible copy and slow/failure paths (ADR-0080) |
| `web/src/views/Start.tsx`, `web/src/views/Mixes.tsx` | Folder onboarding, readiness and mix choice exist | Observe whether new users can start a real first mix and understand privacy/readiness (ADR-0081) |
| `web/src/views/{Drafts,Mix,SeamInspector}.tsx`, `ExportJobs.tsx` | Current/draft editing, protected revision and export job surfaces exist | Prove that users understand scope, fallback truth and exact export snapshot (ADR-0083) |
| `web/src/views/Studio.tsx` | 64-cell stem grid and keyboard handling exist | Test labelling, dirty/apply semantics, audible handover and actual AT keyboard use (ADR-0084) |
| `web/src/views/{Requests,Links}.tsx` | Requests/bridges and discovery audition surfaces exist | Test consent comprehension, asynchronous truth and paired audition outcomes (ADR-0085) |
| `web/src/views/{Library,Workshop,Listening}.tsx` | Search/filter/operations/study surfaces exist | Test 20k scale, corrections, operational recovery and study blinding (ADR-0086) |
| `web/e2e/{pages,flows,listen,integration}.e2e.ts` | Browser workflow/audio tests and axe checks are present; no visual snapshot assertions found in these files on baseline | Add approved visual baselines and human/real-audio acceptance; never weaken existing assertions (ADR-0087/0088) |
| `docs/adr/selecta-3-evidence.md` | Still says PR #24 is in progress with no S3 items merged | Reconcile actual merge and prove per-task completion; do not infer verification from merged code (ADR-0078) |

## Research and standards consulted by Selecta's earlier reviews

The links below are authoritative **pattern references**, not empirical proof of Selecta outcomes.

1. [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/): focus not obscured, reflow, text/non-text contrast, drag alternatives and target size; AA minimum 24x24 CSS px with exceptions.
2. [WAI-ARIA APG — Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), [Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and [Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): expected keyboard roles and focus management for Selecta's overlays, Studio and palette.
3. [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): show common tasks first, allow expert depth without hiding critical controls.
4. [Microsoft Research — Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/): explain limitations and enable user correction; relevant to recommended mixes, measured fallbacks and auto-planned bridges.
5. [IBM Carbon — Loading patterns](https://carbondesignsystem.com/patterns/loading-pattern/): differentiate skeletons, spinners and long-running tasks; verify linked page and version again before implementation.
6. [Playwright — Visual comparisons](https://playwright.dev/docs/test-snapshots) and [Clock](https://playwright.dev/docs/clock): deterministic fixture review, clock and animation control; no snapshot has been produced by this plan.
7. [web.dev — Core Web Vitals](https://web.dev/articles/vitals): INP and CLS reference thresholds with actual 75th-percentile field methodology; do not substitute one localhost lab run.
8. [Mixxx 2.5 — interface reference](https://manual.mixxx.org/2.5/en/chapters/user_interface.html): optional density and expert music context, not a design template to copy.
9. [MDN — showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): browser support and security limits; browser directory handles cannot be assumed to provide a validated backend path.

Historical project research: [Selecta 3.0 overhaul](selecta-3-overhaul.md), [UI/UX polish](ui-ux-polish.md), [broader music UI research](ui-ux.md). Claims in those files have their own evidence limitations and do not become verified by reference.

## Human research to actually conduct

Prepare synthetic or licensed fixture libraries with known missing/unknown data, long and RTL text, varied tempo/key/lyrics readiness, incomplete seams, missing stems, failed exports and disconnected files. Invite representative first-time listeners, daily listeners, creators and AT users.

Use uncoached task scripts (first ready mix, song request, bridge consent, draft edit/undo, Studio shaping, exact export, troubleshooting). Record per-task completion and latency, errors, recovery, confusion and confidence. Compare results to the baseline before approving any proposed redesign. The >=90% completion value in the roadmap is an **initial target for approval**, not a measured Selecta rate.

## Integrity and ethics

Do not copy copyrighted music into published fixtures or distribute private source paths; use synthetic/licensed audio. Label measured acoustic outcomes separately from subjective quality. Treat local-first as accurate, not synonymous with zero network traffic (LRCLIB lyric metadata lookup sends defined fields). No new remote analytics or CDN assets without a separately accepted privacy decision.

## Next evidence boundary

The programme creates *testable hypotheses and acceptance requirements*. Future PRs must collect actual evidence, refine the plan when results contradict it, and record negative findings openly.
