# Selecta - gap-polish independent verification matrix

**16 Proposed ADRs (0248–0263), 128 new GP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Planning baseline main `2956bc47fd735339e7216e03d27817fb3a31e92b` on 2026-11-08. Owner decisions remain pending. This PR changes only documentation; it neither implements code nor changes historical SF/CI/MI or earlier statuses.

| ADR | Independent acceptance basis | Implemented | Verified |
|---|---|---|---|
| [ADR-0248](adr-0248-content-aware-title-typography.md) | light/dark title fixtures, browser layout and NVDA review; negative cases: long featured credits, RTL, CJK, emoji, 320px, 400% zoom, font fallback | Not started (0/8) | No (0/8) |
| [ADR-0249](adr-0249-listen-attention-hierarchy.md) | full-route visual state matrix, real audio and novice/DJ task study; negative cases: seam fallback, no lyrics, loading, active request, narrow landscape, reduced motion | Not started (0/8) | No (0/8) |
| [ADR-0250](adr-0250-edit-and-inspector-selection.md) | reorder/race E2E, real audition and independent creator test; negative cases: duplicate song occurrences, reorder, locked seam, pending preview, 100-song list | Not started (0/8) | No (0/8) |
| [ADR-0251](adr-0251-music-aware-search.md) | labeled query corpus, 20k search benchmark and duplicate-selection study; negative cases: same-title tracks, covers, feature credits, Unicode, 20k library, stale query | Not started (0/8) | No (0/8) |
| [ADR-0252](adr-0252-safe-library-relink.md) | real folder move, collision negatives, SQLite transaction and path-security tests; negative cases: unmounted drive, collision of same titles, symlink, partial scan, cancellation | Not started (0/8) | No (0/8) |
| [ADR-0253](adr-0253-durable-local-backups.md) | SQLite backup API tests, interrupted restore rollback and independent round-trip; negative cases: live SQLite WAL, corrupt archive, schema downgrade, full disk, moved paths | Not started (0/8) | No (0/8) |
| [ADR-0254](adr-0254-physical-audio-interruptions.md) | actual hardware/OS/browser matrix and live audio continuity log; negative cases: Bluetooth/USB, sleep-wake, media keys, multiple tabs, autoplay restrictions | Not started (0/8) | No (0/8) |
| [ADR-0255](adr-0255-return-to-work.md) | return-to-task E2E and uncoached longitudinal user study; negative cases: deleted draft, stale recent context, duplicate songs, multitab, lost file | Not started (0/8) | No (0/8) |
| [ADR-0256](adr-0256-contextual-music-help.md) | content audit, touch/NVDA tests and novice uncoached tasks; negative cases: touch-only, keyboard focus, screen reader, 400% zoom, expert repeat use | Not started (0/8) | No (0/8) |
| [ADR-0257](adr-0257-long-session-comfort.md) | attention-event trace, long-session human comfort and performance/audio test; negative cases: multi-hour playback, frequent background jobs, NVDA live regions, battery devices | Not started (0/8) | No (0/8) |
| [ADR-0258](adr-0258-safe-batch-library-actions.md) | selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; negative cases: stale filters, duplicate titles, 20k results, concurrent scans, partial errors | Not started (0/8) | No (0/8) |
| [ADR-0259](adr-0259-explore-expectations.md) | seeded planner fixtures and uncoached expectation study; negative cases: six-ready library, one genre, sparse metadata, unavailable songs, failed build | Not started (0/8) | No (0/8) |
| [ADR-0260](adr-0260-discovery-to-create.md) | stable-ID/race E2E and real-audio journey test; negative cases: reversed pair, duplicate recording, stale candidate, changed current mix, missing audio | Not started (0/8) | No (0/8) |
| [ADR-0261](adr-0261-studio-mental-model.md) | 64-cell keyboard/touch parity, live audio and novice/expert task study; negative cases: 8–64 cells, missing stems, stale AI response, touch drag, preview focus | Not started (0/8) | No (0/8) |
| [ADR-0262](adr-0262-request-outcome-uncertainty.md) | status fixtures, atomic joining E2E and listener prediction study; negative cases: multiple requests, missing track, duplicate title, changed mix, canceled bridge | Not started (0/8) | No (0/8) |
| [ADR-0263](adr-0263-workspace-self-service.md) | failure fixtures, clipboard redaction audit and independent nondeveloper repair task; negative cases: server offline versus empty, missing ffmpeg/model, permission denial, full disk, sensitive file path | Not started (0/8) | No (0/8) |

## Common verification and blockers

Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

At minimum use 20k Library, 100-song editor, 8-lane 64-cell Studio, active playback under analysis/render load and realistic interrupted path/device simulations where relevant. Exact implementing SHA, named independent reviewer, browser/OS/device, real source music, dated task outcomes and evidence are required.

**P0 blockers:** lost or modified original music; corrupted or non-reversible restore; wrong song/seam/revision; unconsented bridge; dual audio or unexpected resume after Pause; path privacy leak; incorrect fake playing/export/backup success; keyboard-inaccessible critical controls. P1 requires explicit disposition for significant task confusion, fatigue, zoom/contrast failure or sustained CPU jank. A passing CI run is not independent human/audio approval.
