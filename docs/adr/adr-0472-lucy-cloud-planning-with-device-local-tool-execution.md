# ADR-0472 - Lucy cloud planning with device-local tool execution

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0404, ADR-0406, ADR-0428; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/ai/`, `src/selecta/lucy/`, `src/selecta/modes/models.py`, `web/src/views/LucyCloudSettings.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

Hosted AI is useful for programming, but a generic tool gateway could accidentally upload audio or execute unvalidated device commands.

## Accepted decision

1. Lucy cloud requests contain only permissioned, bounded catalogue summaries, preferences and text; no audio, stems, PCM, media paths, reconstructible features or unlicensed lyric bodies.
2. Cloud model proposes signed/versioned intent and recipe changes; the local executor authorises, resolves recordings, enforces content rules and performs all audio operations.
3. Hosted token usage remains billable and bounded; deterministic local planner and playback continue when hosted AI is unavailable.
4. Treat remote model output as untrusted; no arbitrary URLs, filesystem paths, execution scripts or expanded permissions from prompt injection.

## Operational edge cases

AI proposes missing/blocked song; model token limit; source tags contain injected instructions; cloud AI outage at opening; user opts out of metadata sync.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Keep existing local Lucy tools and introduce explicit metadata-only gateway; log only redacted tool outcomes. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Prompt-injection, no-audio-egress, tool authorisation, missing-track repair, AI allowance and offline fallback tests. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0472-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of lucy cloud planning with device-local tool execution. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0472-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0472-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0472-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
