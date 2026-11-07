# Selecta 3.0 — verification, adversarial edge cases and release gates

- **Decision status:** Proposed.
- **Implementation status:** Not started.
- **Test execution status:** Not executed for this S3 programme; prior test suites exist but no new outcome is claimed by these docs.
- **Applies to:** All 30 new ADRs and all 252 unstarted implementation items.
- **Related:** [ADR index](selecta-3-roadmap.md), [work checklist](selecta-3-implementation-checklist.md), [parity](selecta-3-parity-matrix.md), [evidence](selecta-3-evidence.md).

## Coverage contract

Each screen and significant subview must receive a route/state record. Mark initial, populated, empty, partial, refreshing, saving, queued, rendering, ready, warning, failed, offline, unavailable, stale and recovered as tested or explicitly N/A with justification. For each state, check UI content, permitted actions, focus placement, status announcements, backend effects, audio impact and recovery.

Every existing behavior-based assertion survives. Tests may change DOM selectors and accessible labels when UI changes, but must not silently discard expectations about mutation identity, readiness, playlist order, file validity or audible results.

## Verification layers

| Layer | Existing baseline / proposed work | Evidence |
|---|---|---|
| Domain/frontend unit | `web/src/App.test.tsx`, `web/src/views/*.test.tsx`, `web/src/player.test.ts` | Route/transport behavior; domain selectors; optimistic state; Undo; parameter validity |
| Python/server contracts | `tests/test_api_contracts.py`, existing pytest | API backward compatibility, revisions, idempotency, security, source paths, atomic insertion |
| Large-library fixtures | `tests/test_library_edges.py` | 20k, Unicode, RTL, duplicate and missing metadata, search query handling |
| Browser page tests | `web/e2e/pages.e2e.ts` | Responsive widths, themes, route/reload/history, axe and fallback surfaces |
| Browser audio tests | `web/e2e/listen.e2e.ts` | Real Web Audio source/audio ownership, seek, transitions, media keys, multi-tab |
| End-to-end journeys | `web/e2e/flows.e2e.ts` | Draft edits, Library, requests, keyboard, export, user-error recovery |
| Concurrency tests | `web/e2e/integration.e2e.ts` | Current/draft isolation, stale writes and conflict races |
| Proposed visual regression | Deterministic Playwright snapshots with approved fixture/font/clock and masked nondeterminism | Reviewed dark/light and failure-state screenshots; no blanket baseline updates |
| Proposed accessibility | ARIA patterns, WCAG 2.2 AA, keyboard/screen reader manual checklist | No inaccessible essential task, focus not obscured, non-drag alternatives |
| Proposed sound/evaluation | Locally generated or licensed audio fixtures, real export decode and manual listening | Timing and continuity measured separately from subjective sound quality |
| Proposed performance | 20k Library, 100-song Edit, 64-cell Studio and background analysis | Hardware and production-build measurements, no audio regressions |
| Security/PWA | Host/Origin/IDs and external-network inspection; installed Chrome/Edge | Local source privacy and truthful PWA/offline behavior |
| Code hygiene | `tests/test_file_length.py`, existing project build/lint/CI | No broad code changes hidden within a design PR |

## Full route, mode and state audit

- **First run:** Invalid path, empty folder, inaccessible drive, existing user reconnect, 0–5 ready, first playable mix.
- **Explore:** Featured mix, 16 presets, unavailable reasons, length, stems, transition feel, energy curve, target song, active replacement, draft.
- **Listen:** No current mix, paused/playing/seeking/seam, skip vs jump, steering, Why explanation, Good/Bad.
- **Lyrics/Stage:** Timed word, timed line, untimed, instrumental, no data, long text, denied fullscreen, reduced motion.
- **My Mixes:** No drafts, multiple duplicate names, save/rename/delete/restore, queue, active draft swap, blocked render.
- **Edit:** Current/draft, insert, suggestions, analysis, reorder, lock/remove, Undo, ghost requests, 100-song list.
- **Seam inspector:** Listen/Change/Studio/Details, exact pair, preview, cue/style/phrase, render pending/ready/fallback/error.
- **Stem Studio:** Two songs × four stems × 64 cells, solo, shapes, AI, fine-tune, restore, dirty/apply/recover.
- **Requests:** None/one/many, optimistic/pending/confirmed, bridge approval/rejection/alternatives, cancel, Play anyway.
- **Word Connections:** Shared phrase, two songs, style, preview, render error, rating, atomic pair add.
- **Harmonic:** Four audition stages, Yes/No/Skip, submit failure and verdict restore.
- **Library:** Every filter, search, sort, 100-page load, 20k songs, readiness, corrections, exclusions, missing path.
- **Workspace:** Analysis, sources, watcher, storage, learning, diagnostics, paused jobs and storage failure.
- **Listening studies:** Setup/code, A/B, tags, quality, choice, Cannot judge, duplicate submission, completion.
- **Export:** Prerequisites, prepare/encode/download, expired/failure/retry, exact snapshot and modal dismissal.
- **Global:** Deep links, unknown route, history, PWA, 2 tabs, server disconnected, dark/light, high zoom.

For every item include: loading, success, empty, partial, errors and retry where meaningful. Verify long/missing/duplicate/RTL metadata and dark/light presentation. Preserve status semantics if the backend returns an unfamiliar value.

## Device and accessibility matrix

- **Widths:** 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 3840 CSS pixels.
- **Zoom:** 100%, 200% and 400% where applicable; increased text sizes, viewport height reductions, visual keyboard and orientation change.
- **Inputs:** keyboard only, pointer, touch, long press, screen reader, reduced motion, color and focus indicators.
- **Platform:** Chrome/Edge PWA installed flows and other OS/browser combinations only where Selecta officially supports them. Record exact browser/OS/assistive-tech versions; don't assert unsupported combinations were tested.
- **ARIA widgets:** Dialog, menu, combobox, tabs, grid, slider, lists and status need their actual WAI-ARIA Authoring Practices interactions.
- **WCAG 2.2:** AA baseline including target size minimum (24 CSS px or documented exceptions), dragging alternatives and focus not obscured. A comfortable 44px-class hit area is a design target, not an assertion that WCAG requires 44px.

## Race, recovery, revision and privacy matrix

| ID | Trigger | Required outcome | Owning ADR(s) |
|---|---|---|---|
| RACE-01 | Current mix A plays, edit/reorder draft B, request arrives for A, Undo in A | Only intended current/draft entity changes, no cross-scope Undo | 0056, 0057 |
| RACE-02 | Double-click Play, Add Request, render seam, Export | One logical backend operation; no duplicates or untracked work | 0051, 0052 |
| RACE-03 | Search A returns after search B | Latest entered query owns results, focus/input unchanged | 0052, 0062 |
| RACE-04 | Choose seam style A, start render, switch to B, old A completes | B remains intended; UI identifies actual playable audio and its revision | 0058 |
| RACE-05 | Remove or reorder selected pair during inspector edit | Stale selection disabled or revalidated, no wrong-pair change | 0057, 0058 |
| RACE-06 | Two requests reserve the same insertion slot | Planner prevents duplicate or conflicting placement | 0060 |
| RACE-07 | Approve multi-song bridge, cancel during rendering, late poll | No canceled resurrection, no partial route and no unapproved audio | 0060 |
| RACE-08 | Bridge one of N required seams fails while others finish | Entire route stays nonplayable until safe/approved replacement | 0060 |
| RACE-09 | Submit request, receive server confirmation only after retry | Single canonical request identity, no duplicate insertion | 0052, 0060 |
| RACE-10 | Preview A, preview B, explicit user Pause, A ends late | No overlap, unexpected resume or stale owner release | 0069 |
| RACE-11 | Preview active while navigating or opening Studio | Previous owner canceled and correct main-player resume semantics | 0059, 0069 |
| RACE-12 | Main transport in two browser tabs | Single active tab controls sound; Media Session remains correct | 0069, 0072 |
| RACE-13 | Stem Studio pair P reordered before Apply | Revision guard rejects stale commit; no wrong transition | 0059 |
| RACE-14 | Studio local shape dirty, storage denied, close | No false saved/recovered state; safe warning and no data loss claim | 0059 |
| RACE-15 | AI stem arrange fails after user manual shape edit | Previous shape preserved and recoverable | 0059 |
| RACE-16 | Half-time BPM override followed by reanalysis completion | User override remains; derived readiness updates truthfully | 0063 |
| RACE-17 | Watch folder removed or drive offline during scan | Existing library safe, clear source-unavailable recovery | 0053, 0064 |
| RACE-18 | Rapidly change storage budget, oldest response arrives last | Latest confirmed value wins, rollback on failure | 0064 |
| RACE-19 | Export draft B, reorder B and switch current mix during encoding | Output is original immutable snapshot or explicit invalidation | 0065 |
| RACE-20 | Export overlay closed, reopened, page reload, file expires | Job status and availability reflect actual backend retention | 0065 |
| RACE-21 | FLAC encoder fails or disk becomes full | No fabricated download, valid recovery, source files untouched | 0065 |
| RACE-22 | Blind study response saved but ack lost; user resubmits | No duplicate trial; A/B method blindness intact | 0066 |
| RACE-23 | Fullscreen denied on entry to Stage | In-window Stage works, focus and Escape restore predictably | 0049, 0055 |
| RACE-24 | 320px screen, active player, nav, request sheet, virtual keyboard | No overlapping navigation/transport or hidden focus/submit | 0049, 0067 |
| RACE-25 | 400% zoom, dialog, long RTL track and error message | Reflow, readable label, reachable action and visible focus | 0051, 0067 |
| RACE-26 | Space/arrow in Stem Studio or waveform with global shortcuts enabled | Composite widget receives keys, no surprise transport action | 0059, 0068 |
| RACE-27 | Old deep link to /workshop/storage and draft editor after new nav | Same operation, correct resource and Back/Forward | 0048, 0071 |
| RACE-28 | Old optional API field absent or unknown enum value | Safe explicit fallback without wrong readiness | 0052, 0071 |
| RACE-29 | 20k Library with 100-song Edit under background render | Responsive controls, stable scroll, no audio drop | 0062, 0073 |
| RACE-30 | UI downgrade after new layout ships | Original data/IDs/routes/audio behavior still work | 0076 |
| RACE-31 | Network inspection of setup, discovery, export, PWA | No unauthorized remote audio/metadata transfer | 0072 |
| RACE-32 | Song not ready, missing beat grid, malformed duration, no lyrics | Truthful disabled reason and no fabricated mix readiness | 0052, 0055, 0063 |
| RACE-33 | Touch drag-only editor or tiny insertion target | Equivalent non-drag control and WCAG-conforming target size/spacing | 0057, 0067 |
| RACE-34 | Main audio active while new route subtree remounts repeatedly | Persistent transport and no playback restart | 0049, 0069 |
| RACE-35 | Offline stale Library results while refresh fails | Show known-stale data with recovery, not empty success | 0052, 0062 |
| RACE-36 | Unsupported secure folder picker platform | Validated manual path input works; no unsupported API claim | 0053, 0072 |

## Browser/audio fixtures and real listening

Use only original, synthetic or licensed audio fixtures. Include fast/slow/double-half tempo, matching/mismatched musical keys, stable/no beat grid, word/line/no lyrics, instrumental, corrupted/missing audio, late seam, failed render, fallback, multiple bridge tracks, source disappearance and partial stem readiness.

Validate actual timing and no unplanned silence/overlap in Web Audio, user-intent-driven pause/resume and the exact seam version being previewed. Decode completed FLAC to verify format and expected duration/track sequence. Run human listening evaluations for subjective transition quality; an automatic renderer score is not a listening study.

## Performance and visual reference targets

Profile production builds on named hardware under active background audio processing. Evaluate navigation responsiveness, playlist reorder, search/filter input, Studio grid repaint, long-list scroll, memory leaks, visualizer frame cost and audio timing. Reference web guidance of INP at or below 200ms and CLS at or below 0.1 where meaningful; do not confuse local laboratory metrics with 75th-percentile field telemetry, especially in a localhost app. Set actual device-specific budgets after baseline measurement.

Visual snapshots need approved fixtures, stable time/animations, deterministic fonts and a human-reviewed diff. Capture both themes and the listed widths at least for representative states; prioritize comprehensive state/interaction coverage over sheer screenshot count.

## Quality gates by implementation PR

1. List affected ADR/task IDs, owner and actual code scope; link current baseline and old parity row.
2. Run appropriate frontend, Python, contract, build and browser suites; document actual commands/results and CI link.
3. Exercise at least one meaningful negative path and any relevant stale-response/concurrency case.
4. Review dark/light screenshots, responsive focus/reflow, keyboard and screen-reader behavior for changed controls.
5. For audio-affecting work, use actual audio rather than mock-only verification.
6. Confirm no unrelated source music, draft, rating, metadata correction, request or export change.
7. Review rollback steps and old/new route/API compatibility.
8. Update task statuses only in proportion to recorded evidence.

## Integrated release blockers and sign-off

- **P0, always blocking:** Lost/corrupted source/user data; wrong mix/draft/cue mutation; unintended silence/overlap/resume; unapproved or partial bridge; invalid/wrong-revision export; unsafe local path or unexpected external transfer; inaccessible essential route/operation.
- **P1, resolve or explicitly disposition before release:** Material unrecoverable task failures, misleading status or pending state, major responsive/keyboard blockers, unbounded render/retry problems.
- **P2, review and disposition:** Noncritical typography, alignment, animation and secondary metadata defects.
- **Evidence:** Reviewed screenshots, exact CI and manual runs, measured performance, accessibility reports, real listening results, user task outcomes and rollback rehearsal.

A passing docs link check or the presence of planned tests does not complete a test. **All new S3 verification remains Not started.**
