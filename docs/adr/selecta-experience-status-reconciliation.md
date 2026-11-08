# Selecta - historical ADR implementation-status reconciliation

**As-of source baseline:** main `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, [PR #29](https://github.com/tochi-mba/selecta/pull/29) merged, 50 changed files. **No historical task status has been changed by this documentation-only PR.**

## What the existing status files say - versus the current merged code

| Programme | Existing document | Recorded status meaning |
|---|---|---|
| Original ADR-0001–0032 (T/P tasks) | [ADR index](README.md), [implementation evidence](implementation-evidence.md) | Mixed historical states; reconcile per task |
| Polish ADR-0033–0046 | [143-item checklist](polish-implementation-checklist.md) | Older proposal, not proof of current implementation |
| Selecta 3.0 ADR-0047–0077 | [258-item checklist](selecta-3-implementation-checklist.md) | Historical headings predate merged code |
| Selecta 3.1 ADR-0078–0088 | [116-item checklist](selecta-3-1-implementation-checklist.md), [release report](selecta-3-1-release-readiness.md) | Some descriptions still say PR #25 open, though merged; unverified human gates remain |
| Selecta 4.0 ADR-0089–0113 | [250-item checklist](selecta-4-implementation-checklist.md), [evidence](selecta-4-evidence.md) | **250 unchecked, historically recorded 0 Implemented / 0 Verified** on baseline `9b663f9`; not a current code-status conclusion |
| Experience-first ADR-0114–0134 | [105-item checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md) | **105 new Not started, 0 Implemented, 0 Verified** at creation, distinct acceptance criteria |

PR #29 modifies the frontend, routes, some API behavior and tests, including Now, Mix, Mixes, Library, Studio, Requests, Shell and UI controls. **It would be inaccurate to say nothing was implemented after PR #29; it is equally inaccurate to count every S4 task as done.** Determine S4 implementation per task by merged code, relevant tests and exact acceptance. Human audio, visual and AT verification are separate.

## Recorded 4.0 tracker inventory (status is historical, post-merge assessment outstanding)

| ADR | Workstream | Recorded 4.0 task count | Actual post-PR-29 implementation | Independently Verified |
|---|---|---|---|---|
| 0089 | Charter/parity | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0090 | Theme palette | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0091 | Type/CSS | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0092 | Shell/navigation | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0093 | Player/focus | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0094 | Controls | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0095 | Async/Undo | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0096 | Onboarding | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0097 | Explore | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0098 | Listen | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0099 | My Mixes | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0100 | Editor | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0101 | Inspector | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0102 | Studio | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0103 | Requests | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0104 | Discovery | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0105 | Library | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0106 | Song details | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0107 | Workspace | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0108 | FLAC export | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0109 | Blind study | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0110 | WCAG | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0111 | Frontend/performance | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0112 | Verification | 10 unchecked | Needs task-specific audit | Not established by tracker |
| 0113 | Research/release | 10 unchecked | Needs task-specific audit | Not established by tracker |

## Independent proposed deltas vs source-observed current capability

- Existing: navigation, mini-player, current/draft paths and theme preferences. New: *intent-led labels and contextual entry* (0115).
- Existing: transport, Stage, lyrics, visualizer, requests and steering. New: *listening-first default with optional DJ controls* (0116).
- Existing: Explore Play/Edit/Save, five-stop energy and settings. New: *optional choose/shape/commit and stronger card hierarchy* (0117–0118).
- Existing: drafts/render line, song-seam rows, inspectors, full Studio. New: *unmistakable scope, arrangement hierarchy, audition-first inspection, optional Shape* (0119–0122).
- Existing: Library, Requests, discoveries, Workspace, export, study. New: *less dense and more legible domain-specific journeys* (0123–0129).
- Existing: layered CSS, design tokens, shared components and tests. New: *approved design states, verified CSS ownership and human outcome gates* (0130–0133).
- **Explicitly rejected:** desktop bundling/launcher/native picker. **Possible but not near-term:** SaaS (0126, 0134).

## Required future reconciliation process

1. Pin actual main HEAD at that point; correlate changed files and diff to exact old S4-XXXX-NN tasks.
2. For each candidate task, record existing behavior, new implemented behavior, test coverage, missing manual evidence and reviewer.
3. Update old tracker **Implemented** only on verified merged code + relevant tests; update **Verified** only after actual human/visual/AT/audio/performance evidence.
4. Keep historical dates/SHA summaries as archival records; annotate later reconciliation as later evidence rather than replacing history.
5. Never mark new EX tasks completed because an older S4 file or PR title resembles them. New tasks require their own acceptance proof.

This file is a **status boundary/crosswalk**, not a claim that all 250 pre-existing tasks were independently audited.
