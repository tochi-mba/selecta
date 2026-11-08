# Selecta 3.1 - unapproved visual-review candidates

These images are **not approved baselines**, completion evidence or a substitute for accessibility/usability review.

## How to collect

On PR #25's exact latest commit, run the existing Windows/Edge CI jobs. `web/e2e/visual.e2e.ts` visits the **synthetic** Selecta test server with a deterministic reset mix. It captures 320px/light, 375px/dark, 1280px/light and 1440px/dark images across Explore, Listen, My Mixes, Edit, Library and Workspace, plus export/customization/requests overlays.

The workflow uploads `selecta-3-1-visual-review-1` and `selecta-3-1-visual-review-2` artifacts **even when the tests succeed**. Files are prefixed `candidate-`, specify width/theme/state, and are isolated to the synthetic e2e fixture. A missing artifact, cancelled runner, or incomplete test is **not** evidence that the viewport was checked.

## Human review checklist

1. Record reviewer, date, commit SHA, test run, browser version and rendering device; download only the candidate artifacts from that exact CI run.
2. Compare the same route/state across narrow/wide and light/dark. Note primary-action hierarchy, long metadata clipping, readable request and render state, focus appearance, safe area, scrolling and visible undo/recovery.
3. Review loading, failure, stale and empty states separately: the current snapshots do **not** cover all of them. Add explicit synthetic fixture states before accepting visual regression coverage.
4. Record each issue with screenshot filename, exact expected/actual difference, P0/P1/P2 priority, proposed fix and a reproducing browser test. No bulk rebaseline.
5. Only after owner approval, commit an intentional screenshot baseline per supported browser/OS/font configuration and run `toHaveScreenshot` comparisons with documented diff thresholds. Do not claim Playwright captured images are pixel stable across operating systems before validating them.
6. Perform independent keyboard/AT, reduced motion, 200%/400% zoom, real audio and human task reviews. Screenshots alone cannot mark S31-0078-05, S31-0079-10 or S31-0088-01 Verified.

**Current disposition:** capture infrastructure added; no approved screenshots, reviews or visual-baseline diffs are claimed.
