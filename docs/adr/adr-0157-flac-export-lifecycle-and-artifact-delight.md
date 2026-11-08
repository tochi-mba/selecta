# ADR-0157 — FLAC export: frozen revision, trustworthy progress and finished-artifact moment

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Export.
- **Related earlier ADRs:** ADR-0127, ADR-0108, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/ExportPanel.tsx; web/src/views/ExportJobs.tsx; web/src/views/exportStore.ts.

## Context and evidence boundary

Saving a mix is emotionally meaningful, but a button glow must never imply a playable file exists while seams or encoding remain incomplete. The export remains attached to a frozen revision. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Export entry identifies source scope (current or draft), exact ordered songs, revision, estimated duration and FLAC format.
- Stages remain prepare transitions, encode, download, with queued/paused/error/interrupted/expired states clearly distinct.
- When current mix changes after exporting begins, show that the file is based on the earlier snapshot and offer a new export explicitly.
- Dialog can close without cancelling the job; Activity and Workspace expose the same real job state.
- A complete export is announced only after file existence and decodability checks, not just job scheduling.
- Provide one quiet finish moment with a ready-to-download action, not an automatic download or playback.

## Interaction choreography and visual behavior

- Export start acknowledges immediately, then enters persistent preparation state without fabricated percentage.
- Stage marker moves only when the authoritative job state advances; no backwards animated regress unless state truly reverts.
- Ready file gets a single ≤220 ms emphasis of the download action; no confetti or sound.
- Error/expired remains static with recovery action; reduced motion has identical stage labels.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — 2 source-level Implemented, 0 independently Verified

1. **MI-0157-01 — Specify frozen export identity.** Acceptance: Source kind, source ID, ordered songs, seam keys and revision visible and enforced. Required verification: Export snapshot/API test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx`; `web/src/views/Mix.test.tsx`; independent checks pending.**
2. **MI-0157-02 — Define job state choreography.** Acceptance: Preparing, encoding, ready, fail, interrupted, canceled, expired distinct. Required verification: Job fixtures and reload tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
3. **MI-0157-03 — Keep long work non-modal.** Acceptance: Job persists after dialog close/refresh and is discoverable. Required verification: Navigation and restart E2E. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: persistent backend export jobs surfaced in Activity after navigation/refresh by `ExportJobs.tsx` and export job API tests.**
4. **MI-0157-04 — Prevent false download success.** Acceptance: Ready only after confirmed decodable FLAC linked to snapshot. Required verification: Decoded audio and artifact signature check. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: download appears only for authoritative ready artifacts, expired files are blocked, and `tests/check_export_audio.py` decodes/checks output; real candidate audio remains open.**
5. **MI-0157-05 — Handle changed-since-export.** Acceptance: Old file described correctly, new revision requires new explicit action. Required verification: Concurrent edit/export test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx`; `web/src/views/Mix.test.tsx`; independent checks pending.**
6. **MI-0157-06 — Guard retries and idempotence.** Acceptance: Uncertain response retry cannot create accidental duplicate artifacts. Required verification: Lost response and operation-id tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: stable operation IDs in `ExportPanel.tsx` plus backend idempotence/guard tests; lost-response candidate rehearsal remains open.**
7. **MI-0157-07 — Specify accessible progress and error.** Acceptance: Screen readers hear meaningful stage changes once, focus retained. Required verification: NVDA/Edge and keyboard review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0157-08 — Evaluate finished moment.** Acceptance: Users identify the right file and revision without confusion. Required verification: Uncoached export and re-export task. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
