# ADR-0238 - Local-first privacy and future SaaS-ready boundaries without SaaS

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 0/8 In progress, 2/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Architecture.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0025/0126/0184; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/views/Setup.tsx; web/src/views/Workshop.tsx; web/src/state/prefs.ts.

## Context and evidence boundary

Continue local-only operation, safe server file paths and limited LRCLIB lookup. Define optional future separation of storage, identity and render service interfaces in documentation only; do not ship accounts, remote media sync or telemetry. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Continue local-only operation, safe server file paths and limited LRCLIB lookup. Define optional future separation of storage, identity and render service interfaces in documentation only; do not ship accounts, remote media sync or telemetry. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No account screens, cloud registration, remote music upload, analytics beacon or cross-origin privilege change. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0238-01 - Audit current network and local paths.** **Acceptance:** All data egress and file permissions documented. **Required verification:** Network and server security inspection. **Implementation:** Implemented; every outbound connection is listed with what it sends and when, the local server binds 127.0.0.1, and original music is only read; a test fails if any other module opens a connection; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Network egress and local files; `tests/test_flow_cross_cutting.py` 'test_only_listed_modules_open_outbound_connections', 'test_the_local_server_only_listens_on_this_computer' (passed 2026-11-10).
2. **SF-0238-02 - Document LRCLIB disclosure.** **Acceptance:** Exactly what metadata is sent and when made explicit. **Required verification:** Privacy copy and packet review. **Implementation:** Implemented; lyric lookup sends only artist, title, album and duration to lrclib.net, and the first run and privacy copy say so before anything is sent; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_polish_phase03.py` 'test_lyric_lookup_sends_only_artist_title_album_and_duration'; `web/src/localPrivacyCopy.test.ts` 'only drops the LRCLIB sentence when lyric lookup is turned off'; passed 2026-11-10.
3. **SF-0238-03 - Protect original media.** **Acceptance:** UI actions never imply destructive source overwrite. **Required verification:** File safety tests. **Implementation:** Implemented; no UI action writes to an original file: corrections are stored apart and can go back to what was measured, and stopping watching a folder leaves every file byte for byte; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_api_contracts.py` 'test_stopping_watching_leaves_every_music_file_byte_for_byte'; `tests/test_flow_release_safety.py` (music hashed before and after); passed 2026-11-10.
4. **SF-0238-04 - Set preference data boundaries.** **Acceptance:** Theme and motion preferences remain local. **Required verification:** Offline persistence tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/state/sfPrefsLocal.test.ts` 'offline, a theme and motion choice saves, survives a reload and sends nothing'; `web/src/state/ufPrefsIsolation.test.ts` 'changes theme, density and motion without a request or any other stored state' (2 passed, vitest 2026-11-11).
5. **SF-0238-05 - Plan abstract storage seams.** **Acceptance:** Optional future interfaces do not change local code now. **Required verification:** Architecture design review. **Implementation:** Not started; Superseded by ADR-0391 and ADR-0397: cloud storage interfaces were built on purpose for Selecta Cloud; local mode keeps its local storage unchanged; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0238-06 - Specify future identity boundary.** **Acceptance:** No current login, billing or remote media scope. **Required verification:** Product scope check. **Implementation:** Not started; Superseded by ADR-0391: login and billing now exist in cloud mode by owner decision; local mode still has no login, billing or remote media; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0238-07 - Review new visual assets privacy.** **Acceptance:** Artwork and fonts work locally with authorized provenance. **Required verification:** Offline and resource inspection. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-0238-local-only.e2e.ts` 'SF-0238-07 every page, font, icon and picture comes from this machine' (passed 2026-11-11, dist-r3j).
8. **SF-0238-08 - Validate offline core paths.** **Acceptance:** Playback, library and editing do not require cloud. **Required verification:** Disconnected E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-0238-local-only.e2e.ts` 'SF-0238-08 playing, the library and editing all work with no internet at all' (passed 2026-11-11, dist-r3j).

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0025/0126/0184; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
