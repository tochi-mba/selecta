# Selecta 2.0 — tests, fixtures and edge-case matrix

- **Decision status:** Proposed
- **Implementation status of new tests:** Not started
- **Date proposed:** 2026-11-06

Changing markup is not permission to weaken behavioural tests. When a test's selector or label changes, retain the assertion about its durable or audible outcome. All suites below are existing reference points; none are modified by this docs-only PR.

| Suite | Existing test path | Preserve | Add during implementation |
|---|---|---|---|
| App | web/src/App.test.tsx | Navigation, shortcut and global update behaviour | Deep links, focus, mini-player, multi-tab |
| Mixes | web/src/views/Mixes.test.tsx | Presets, steering, curve, destination, draft builds | Scope, ineligible preset, concurrent build |
| Now | web/src/views/Now.test.tsx | Beat/lyrics and playback UI | Seek, media keys, Stage fallback |
| Mix | web/src/views/Mix.test.tsx | Reorder, lock, add, seam preview/rating and undo | Stable IDs, conflict, drag alternative |
| Library | web/src/views/Library.test.tsx | Search, filter, priority, song actions | Pagination, override, scan refresh |
| Links | web/src/views/Links.test.tsx | Word and harmonic audition/feedback | Pair transaction, preview failure, draft target |
| Requests | web/src/views/Requests.test.tsx | Optimistic requests, bridges, cancellation | Approval/cancel race, duplicate reservation |
| Drafts | web/src/views/Drafts.test.tsx | Creation, queue, undo, draft play | Scope and storage block |
| Studio | web/src/views/Studio.test.tsx | Cells, shapes, solo, AI, commit | Keyboard grid, dirty recovery, audio focus |
| Workshop | web/src/views/Workshop.test.tsx | Analysis and storage | Cache budget, offline, worker failure |
| Listening | web/src/views/Listening.test.tsx | Blind studies, response recovery | Non-overlap, duplicate submission |
| Player | web/src/player.test.ts | Scheduling, preview and fallback | Real browser audio and safe seek |

## New test layers to implement

1. Domain unit tests for status mapping, optimistic reconciliation, energy curves, revision and cue validity.
2. Accessible component tests for button states, dialogs, combo boxes, keyboard reorder and Stem Studio grid.
3. Backend/frontend contract tests for old/new payload compatibility, canonical readiness, pagination, IDs, atomic insertion and idempotency.
4. Playwright user journeys: initial folder to playback; preset customization; draft editing; bridge approval; stem changes; word/harmony discovery; FLAC export.
5. Real Web Audio fixtures for gapless transitions, late seam, fallback, seek before/after cue, preview focus, audio-context suspend and end of mix.
6. Visual regression for dark/light, mobile/desktop, empty/error/render/warn, large text, zoom, Stage and overlay.
7. Accessibility checks (automated + manual screen reader/keyboard) for entire creative and listening journeys.
8. Large-library and local-workload tests for 20k songs, 100-song edit, 64 Studio cells and audio processing load.
9. Manual blind listening comparisons to validate actual musical quality separately from DSP assertions.

## Critical edge-case sequences

**Current versus draft:** Play mix A; open draft B; reorder B; receive live request for A; render B's seam; switch to A; Undo in A. Assert no B operation changes A and undo has correct scope.

**Request bridge:** Submit two requests quickly; they compete for a location; approve route with two intermediate tracks; cancel another request mid-render; let one seam fail and stale polling return. No duplicate or partial playable insertion, no canceled resurrection.

**Manual cue and render race:** Select exact cue and style, request render, choose another style before old render finishes, fallback while playing. Later result cannot change manual intent, playback must remain continuous, UI names actual audio.

**Studio session:** Open seam, toggle/solo cells, navigate away after local preview, user pauses main player, return to Studio, recover pending shape, commit on correct revision. No surprise resume or wrong-seam commit.

**Export:** Export an unfinished draft, then switch to another mix and change song order. The export must either use a defined immutable snapshot or invalidate cleanly. Downloaded FLAC must decode and match intended mix.

**Analysis correction:** Override half-time BPM then background reanalysis completes. Override remains, dependent derived data refreshes, unrelated drafts remain.

**Backend disconnect:** Stop server during search, request, export and storage setting. Do not show fabricated empty results or success; resume/retry safely without duplicate writes.

## Required fixtures

Original or licensed audio: fast/slow tempo; harmonic fit/mismatch; beat-grid/no grid; word/line/no lyrics; instrumental; good/warn/failed render; late seam; route with up to three bridges; missing audio; partial stem load. Metadata: unicode, RTL, long title, duplicate, zero duration, nonmusic, missing path. Operational: no library, minimum songs, 20k library, cache full, backend unavailable, old server response.

## Browser, screen and accessibility matrix

Widths 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920 and Stage large-screen. Zoom 100/200/400% as applicable. Current supported Chromium plus Firefox/Safari where product supports them; installed Chrome/Edge PWA. Keyboard-only flows, NVDA/VoiceOver/TalkBack as applicable, reduced motion and high contrast.

## Evidence and gate

Keep Windows CI Ruff, pytest (coverage ≥70%), pnpm tests and build; extend in later implementation PRs. Link screenshots, traces, real-audio assertions, accessibility findings, manual listening notes, migration and rollback evidence to ADRs and release gates. A passing mocked test is not proof that the music sounds good.

**All proposed test additions: Not started.**
