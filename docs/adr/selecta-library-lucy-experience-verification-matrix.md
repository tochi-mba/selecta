# Selecta - LX verification matrix

**Status:** 26 Proposed ADRs (0340–0365); 208 LX tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owner unassigned. Baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be` (2026-11-08). Documentation only.

| ADR | Minimum machine/evidence fixture | Required independent acceptance |
|---|---|---|
| [ADR-0340](adr-0340-library-experience-charter-and-information-architecture.md) | Uncoached paired task walkthrough and decision log; Source-to-ADR parity audit at implementing SHA; Keyboard landmark traversal and screen-reader outline | Named design review with dated paired screenshot set; named reviewer and matched state |
| [ADR-0341](adr-0341-library-header-counts-and-collection-overview.md) | Paired desktop/mobile hierarchy critique; Unknown/partial status fixture; Comprehension task with misleading-value fixture | Uncoached count explanation and retrieval comparison; named reviewer and matched state |
| [ADR-0342](adr-0342-library-search-and-exact-recording-retrieval.md) | Visual hierarchy and search-discovery test; Router and browser-history E2E; Title/artist/credit/id fixtures with AT | Keyboard and novice/expert comparison study; named reviewer and matched state |
| [ADR-0343](adr-0343-library-filters-sorting-and-musical-query-depth.md) | Uncoached filter discovery and copy study; Keyboard, theme and pressed-state tests; Full sort comparison and Back/Forward E2E | Timed novice/expert search study; named reviewer and matched state |
| [ADR-0344](adr-0344-library-list-rows-and-dense-scanning.md) | Mixed-length title and duplicate fixture screenshots; Computed-grid geometry in both densities; Metadata update and unknown-value screenshots | Timed expert/novice comparison with matched data; named reviewer and matched state |
| [ADR-0345](adr-0345-library-collection-card-view-and-meaningful-artwork.md) | Collection versus list first-impression study; Asset provenance, missing-art and offline tests; Duplicate card task and AT labels | Uncoached browse-and-find study; named reviewer and matched state |
| [ADR-0346](adr-0346-library-contextual-track-action-hierarchy.md) | Readiness-to-UI contract test; Uncoached task priority comparison; Real-player focus and replacement E2E | Pre-action comprehension study; named reviewer and matched state |
| [ADR-0347](adr-0347-library-bulk-selection-scope-and-feedback.md) | No-selection visual and keyboard discovery; 20k paged and AT wording tests; 0/1/200 selection snapshot matrix | Novice batch-action comprehension study; named reviewer and matched state |
| [ADR-0348](adr-0348-library-song-inspector-and-metadata-provenance.md) | Duplicate recording and long-title review; First-glance provenance task; Override/unknown fixture and AT labels | Uncoached correction-and-restore study; named reviewer and matched state |
| [ADR-0349](adr-0349-library-readiness-corrections-and-guarded-management.md) | Invalid/valid field tests and human comprehension; Correction/reset API and UI regression; Response-dependent message fixtures | Backend fixture and real-file integrity test; named reviewer and matched state |
| [ADR-0350](adr-0350-library-large-scale-paging-scroll-and-performance.md) | Repeatable lab performance manifest; Cursor overlap and page-depth E2E; API-call count and stale-refresh tests | Named device p75 lab trace and reviewer signoff; named reviewer and matched state |
| [ADR-0351](adr-0351-library-mobile-tablet-zoom-and-accessibility.md) | Responsive grid geometry matrix; 320px and zoom screenshot tests; Touch and keyboard filter task | Uncoached one-handed task study; named reviewer and matched state |
| [ADR-0352](adr-0352-library-empty-loading-stale-and-error-experiences.md) | State catalogue linked to test fixtures; Same-state layout-shift screenshots; Empty-state copy and action study | Named reviewer/device/fixture evidence; named reviewer and matched state |
| [ADR-0353](adr-0353-make-a-mix-quick-play-and-lucy-entry-architecture.md) | Uncoached first-choice expectation study; Quick Play regression and real-audio E2E; 5-second entry discovery test | Novice and expert preference task; named reviewer and matched state |
| [ADR-0354](adr-0354-make-a-mix-moods-discovery-and-creation-intent.md) | Card comprehension and visual hierarchy study; Live candidate versus actual build fixture; Before-action prediction study | Cross-route session task with playback; named reviewer and matched state |
| [ADR-0355](adr-0355-lucy-desktop-proposal-conversation-workspace.md) | Viewport/container and zoom matrix; Paired visual hierarchy critique; Long-chat retrieval task | Timed desktop describe/revise task study; named reviewer and matched state |
| [ADR-0356](adr-0356-lucy-readable-transcript-and-conversational-control.md) | Long/short transcript screenshots; Adversarial content and HTML-escape tests; Transcript sequence and reading-order fixture | Uncoached explanation comprehension study; named reviewer and matched state |
| [ADR-0357](adr-0357-lucy-composer-context-and-mobile-keyboard.md) | First-message usability test; Duplicate song/scoped prompt E2E; Keyboard and CJK composition tests | One-handed + TalkBack/VoiceOver study; named reviewer and matched state |
| [ADR-0358](adr-0358-lucy-music-specific-activity-and-tool-cards.md) | Event-stream timing and ordering test; Adversarial partial-result fixtures; Long-run hierarchy study | Comprehension study with mixed runs; named reviewer and matched state |
| [ADR-0359](adr-0359-lucy-proposal-status-constraints-and-readiness.md) | State machine and copy comprehension tests; Older/current snapshot fixture; 1/2/long route and unknown-length tests | Uncoached musical-state interview; named reviewer and matched state |
| [ADR-0360](adr-0360-lucy-song-seam-timeline-and-contextual-editing.md) | Paired 1/8/64-song timeline screenshots; K−1 edge alignment fixture; Known/unknown energy AT and screenshot tests | Novice/expert timeline usability study; named reviewer and matched state |
| [ADR-0361](adr-0361-lucy-revision-comparison-critiques-and-undo.md) | History/current action gating fixture; Synthetic revision-pair accuracy fixture; Before/after seam proof test | Uncoached compare-and-restore study; named reviewer and matched state |
| [ADR-0362](adr-0362-lucy-approval-commit-and-audio-focus-ux.md) | Before-action comprehension task; Approval snapshot and stale revision test; Real-player audio-focus E2E | Uncoached active-player approval study; named reviewer and matched state |
| [ADR-0363](adr-0363-lucy-conversation-history-recovery-and-privacy-controls.md) | History search and route task; Destructive-action comprehension test; Delete semantics E2E | Uncoached resume-and-explain study; named reviewer and matched state |
| [ADR-0364](adr-0364-library-lucy-shared-visual-language-and-accessibility.md) | CSS owner and computed-state audit; Cross-route motif and provenance review; Paired light/dark visual critique | Independent dated art/AT review; named reviewer and matched state |
| [ADR-0365](adr-0365-library-lucy-evidence-parity-and-release-gates.md) | Decision-status consistency audit; 208-ID and link integrity script; Ledger row and ID count audit | Gate dry run with refusal cases; named reviewer and matched state |

## Cross-cutting release matrix

| Domain | Required scenario | Record |
|---|---|---|
| Geometry | 320/375/768/1024/1440/1920 CSS px, 200/400% zoom, short landscape and real container widths | Measured overlap, dimensions, visible focus |
| Themes | Light/Dark/System, forced colours, contrast, long/RTL/CJK metadata and missing art | Paired same-data screenshots and CSS computed values |
| Accessibility | Keyboard including tabs/menus/dialogs, NVDA, VoiceOver/TalkBack, pointer/touch, meaningful status | Human task + automated axe-like audit; named platform |
| Library scale | 0/1/100/1k/20k songs, paging and search races, loaded-only max 200 batch | API count, DOM/memory work, focus, row ID and timing |
| Lucy flow | Empty → prompt → run → proposal → critique → revision → save/optional play | Snapshot identities, screen-reader, uncoached prediction |
| Ready-only | K songs/K−1 seams, zero seam, cache eviction, history-only evidence, directed graph infeasibility | Valid real decoded audio/no worker side effect |
| Audio safety | Existing music playing/paused/idle, provider off, save draft, save-and-play, cancel, back | Real-player monitoring with one owner and no surprise pause/play |
| Failure | Offline, stale, cancelled, delayed reply, duplicated submit, multitab, failed preflight | Recoverability, data integrity, truthful messages |
| Human testing | Separately report novice and expert task completion, confusion and duration | Cohort/denominator, exact script and observed failures |
| Performance | Actual named device and network; report LCP/INP/CLS where relevant | Measured candidate versus baseline, not invented p75 |

**Success thresholds are proposed:** user-task completion ≥90% separately by cohort for critical scenarios; WCAG 2.2 AA; relevant good Web Vitals reference thresholds LCP ≤2.5s, INP ≤200ms, CLS ≤0.1, not an assertion that current field metrics pass. Performance regressions against captured baseline require owner decision, not impression.

No machine run, screenshot, AT session or independent listening study is executed by this document PR. An item cannot be marked independently Verified on plan alone.
