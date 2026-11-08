# Selecta - final-polish verification and acceptance matrix

**FP documentation proposal as of 2026-11-08:** baseline main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`. 8 Proposed ADRs (0264–0271), 64 task acceptances Not started, 0 In progress, 0 Implemented, 0 independently Verified. All owner decisions pending; no source change or human verification is claimed.

## Programme-specific acceptance routes

| ADR | Automated evidence (on exact implementing SHA) | Independent proof | Required negative cases | Gate |
|---|---|---|---|---|
| [0264](adr-0264-light-interactive-boundaries.md) | Adjacent-surface computed essential-edge contrast, component state variants, colour/forced-colours E2E | Independent low-vision/keyboard and theme specimen review | Selected+playing+focus, cream control edges, disabled, grayscale | No P0 invisible actionable edge |
| [0265](adr-0265-browser-chrome-theme-sync.md) | Effective theme precedence, first paint, pref storage and theme-switch E2E | Chrome/Edge installed PWA versus browser chrome capture, live audio | Manual opposite OS, OS preference change, storage denied | No contradictory supported chrome or player restart |
| [0266](adr-0266-live-theme-music-graphics.md) | Real-source spectrum, canvas repaint, seam/energy legends and Studio mode/state equality | Real-music live theme switching; visual/AT checks | Silence, Stage, 64 cells, selected+focused, unavailable beat/stem | Same music and data semantics in two themes |
| [0267](adr-0267-contextual-library-batch-presentation.md) | Zero/one/200 selected actions, filter identity, exact stable ID, transactional API | Library browse and batch task comparison, keyboard/NVDA | 20k tracks, stale page, duplicate names, failed mutate, cards | No wrong target; zero clutter without lost affordance |
| [0268](adr-0268-explore-card-information-budget.md) | Card copy/eligibility truth fixture, Play/Shape/Save E2E, disclosure accessibility | Novice/DJ card comparison and expectation accuracy | Sparse library, failed planner, long title/RTL, 320px | Faster scan without wrong expectations |
| [0269](adr-0269-cross-route-action-tier-map.md) | Route-state action inventory, focus, deep links, no lost controls | Uncoached novice and professional control discovery | Disabled palette, dirty Studio, pending request, small viewport | Advanced actions still discoverable |
| [0270](adr-0270-viewport-layer-occlusion.md) | Bounding-box collision assertions for sticky chrome/overlays and keyboard, focus/Escape E2E | Actual mobile+desktop viewport and audio checks | 320x568, short landscape, 400% zoom, dialog/toast/keyboard | Zero P0 covered actions |
| [0271](adr-0271-paired-theme-state-visual-evidence.md) | Same-state screenshot pair manifests, completeness denominator, contrast/DOM diff | Reviewer-approved pairs and named assistive/audio review | Missing metadata, offline, disabled, Stage and export | Every critical pair approved, no P0 |

## Route-state coverage plan

The cross-product inventory must cover: Start, Setup, Explore, Mix shaping, Listen, Stage, Up Next, My Mixes/Drafts, Edit and Inspector, Stem Studio, Requests, Word/Harmonic Discovery, Library List and Cards, Song Details, Workspace/Sources/Jobs/Settings, Backup/Restore, Export and neutral Listening Study. Include applicable empty, loading, success, error, partial, offline and conflict states, not only ideal screenshots.

**Paired capture:** For each approved critical fixture identifier, use the same route, identical source data/song IDs, action state, browser, dimensions, zoom and motion settings for Light and Dark. Record required count, captured pairs, human-approved pairs and rejected/missing pairs. Suggested viewport candidates: 320, 375, 768, 1280, 1440, 1920px; short landscape and 400% zoom run as explicit reflow cases. Enforced High Contrast is a separate semantic test, not a theme screenshot substitute.

## Required human participants and measurements

A suggested initial usability sample is five less-experienced listeners and five people experienced in DJ/music-editing tasks, with more participants if research shows inconsistent results. This is a recruitment proposal, **not** completed research. Capture tasks, denominators, success, hesitation, time, action discovery, misunderstanding and subjective load against the pre-change baseline. Contrast target follows applicable WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text and 3:1 non-text indicators where required. No universal 3:1 requirement applies to purely decorative panel dividers.

A green screenshot test, manually styled candidate image or a synthetic-muted server fixture cannot prove real audio continuity, human task success or assistive-technology quality. Record independent reviewers with exact SHA, browser/OS, actual hardware, evidence URLs or descriptions, failures and rollback.

## Status transition controls

**Not started → In progress:** assigned implementation owner and named source PR. **Implemented:** source/test artifacts, exact SHA and passing relevant regressions or documented accepted reconciliation. **Independently Verified:** separately reviewed task on that SHA with recorded outcomes. Decision **Proposed → Accepted** requires an explicit owner decision, not merge of ADR docs.

**Current FP programme:** 8 decisions Proposed; 64 task acceptances Not started; 0 independently Verified. New enhancement release **NO-GO** until the programme-specific [release gates](selecta-final-polish-release-gates.md) are met; this does not assert the existing app is unusable.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [JSON](selecta-final-polish-code-status.json) · [Parity](selecta-final-polish-overlap-and-parity.md) · [Verification](selecta-final-polish-verification-matrix.md) · [Reconciliation](selecta-final-polish-status-reconciliation.md) · [Release](selecta-final-polish-release-gates.md)
