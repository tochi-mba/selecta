# Selecta 2.0 - implementation roadmap

- **Decision status:** Accepted
- **Implementation status for every phase:** see the table ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06

Stages are dependency-oriented, not calendar promises. Each implementation PR must link to affected ADRs and include tests, backwards compatibility, audio/data safety and rollback notes. This documentation PR does not start or complete any stage.

| Phase | Workstream | ADRs | Exit evidence | Implementation status |
|---|---|---|---|---|
| 0 | Baseline and parity | 0001,0029,0030 | Capture main SHA, tests, API, screenshots and sound | In progress |
| 1 | Design system and accessible primitives | 0003,0004,0023 | Contrast, state gallery, dialog and focus tests | In progress |
| 2 | Navigation, shell and PWA | 0002,0024,0031 | Deep link, persistent player, mobile and standalone tests | In progress |
| 3 | State, API and security | 0005,0025,0026,0028 | Old/new contracts, conflict, concurrency and localhost checks | In progress |
| 4 | Listen, audio and lyrics | 0006,0007,0008,0009,0027 | Browser Web Audio timing and Stage/lyric tests | In progress |
| 5 | Mix discovery and steering | 0010,0011 | Presets, duration scope, energy and destination tests | In progress |
| 6 | Drafts, edit, seam and export | 0012,0013,0014,0022 | Draft isolation, editor/undo, render intent, FLAC decode | In progress |
| 7 | Requests and bridges | 0015 | Atomic join, approval, late playhead and race tests | In progress |
| 8 | Stem Studio | 0016 | Instant audio, 64 cells, AI restore, keyboard tests | In progress |
| 9 | Library and Discover | 0017,0018,0019 | 20k songs, corrections, link and harmonic tests | In progress |
| 10 | Workshop and evaluation | 0020,0021,0032 | Storage, worker, blind evaluation and privacy tests | In progress |
| 11 | Integrated user journeys | 0005,0007,0013,0015,0029 | Playback/edit/request/studio interleaving and failure injection | In progress |
| 12 | Accessibility and performance audit | 0023,0024,0029 | Manual screen readers, high zoom, load and visual regression | In progress |
| 13 | Release and rollback | 0029,0030,0031 | Backup restore, CI, audio listening, security, release gates | In progress |

## Rollout order and why

Begin with an immutable baseline and no-regression ledger. Build reusable components and routing while legacy UI still works. Consolidate async state before touching high-risk request/Studio behaviour. Write audio fixtures before implementing Next/Seek. Migrate Mixes and My Mixes before the complex editor. Move requests and stem UI after edit identity is stable. Add library metadata corrections and pair transactions only when backend contracts exist. Workshop, PWA, accessibility, performance and final QA complete the migration.

## Required status transitions

- **Proposed / Not started:** plan exists; no code implementation.
- **Accepted / Not started:** design approved for future work, not coded.
- **Accepted / In progress:** linked implementation PR is actively changing production code.
- **Accepted / Implemented:** shipped code and required tests merged, parity evidence pending.
- **Accepted / Verified:** acceptance ledger, browser/audio/a11y evidence and release gate recorded.

## Every implementation PR must answer

- Which ADR decisions are accepted and which specific implementation statuses change?
- Which previous user actions can still be performed and from where?
- What old test was changed, and why was its behavioural assertion retained?
- What new tests cover failure, concurrency, keyboard, mobile, sound and persistence?
- Does the backend need a compatible schema/API migration, data backup or rollback?
- Is current/draft scope explicit, and can a stale request or renderer overwrite newer user intent?
- Does it preserve localhost security, source music and offline limitations?

## Release blockers

Block release for source/draft data loss, wrong-target mutations, silent cue reset, late/silent audio, unapproved or partial bridge joins, critical inaccessible flows, invalid FLAC exports, unsafe file access, and unverified destructive migration. Technical render checks alone are never a substitute for human listening.

## Existing CI and planned additions

Current `.github/workflows/test.yml` runs Windows Ruff, Python pytest with at least 70% coverage, pnpm test and pnpm build. New browser E2E, visual, contract, accessibility and real-audio suites are **proposed but not yet added**. Their implementation must be in future code/test PRs, not silently claimed here.

**Programme status: In progress. See [implementation-evidence.md](implementation-evidence.md).**
