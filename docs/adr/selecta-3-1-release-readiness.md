# Selecta 3.1 - release readiness and known evidence gaps

**Disposition (2026-11-11): merged, not verified.** The owner merged [PR #25](https://github.com/tochi-mba/selecta/pull/25) on 2026-11-07 as `6d78cf4`. Everything a test can show is recorded below and in the [ledger](selecta-3-1-evidence.md#task-status). The checks only a person can make (assistive technology, listening, unassisted use, real devices, approved images) have not been made, so no task is Verified and no written go or no-go exists.

## Build and scope

- Base: merged 3.0 `main` `3b01dc1336aab0f1cb0a4d85be5eba359de81831` (PR #24).
- Merged: PR #25 as `6d78cf4` from head `ea47848`.
- Surface: the web app, its CSS, one server fix (export job files on Windows), browser and unit tests, a FLAC content check, a scale harness and a rollback check. No schema, audio-engine or dependency changes.
- Platform: Windows, Edge and the local Selecta server, light and dark, from 320 px phones to 3840 px. An installed app is not claimed to play anything without its local server.

## Release gate register

| Gate | State | Evidence |
|---|---|---|
| Full CI: Python, web, Edge and combined coverage | **Passed on main; failed on PR #25's merged head** | `c1f9400` passed in full during PR #25. The merged head `ea47848` failed lint (long lines in files committed before they were checked) and one Library browser test (a race in the test itself). Both were fixed on main; `c3fb6d3` passed in full. |
| Source, drafts, corrections, settings, local-only, request atomicity | **Automated: passing** | Server contract and integration tests; the [rollback check](selecta-3-1-measurements.md#rolling-back) reads all of them identically in 3.0 and back; the page only talks to this computer |
| Playback, previews, transitions, Stage and media keys | **Automated: passing. Audible: not done** | Real Web Audio in muted Edge: clocks, ownership, seeks and hand-offs. Nobody has listened |
| Decodable, revision-correct FLAC | **Automated: passing. Listening: not done** | [Decoded](selecta-3-1-measurements.md#a-saved-flac-decoded): right length, all songs found in order after the mix changed mid-export |
| Keyboard and screen readers | **Keyboard automated: passing. Screen reader: not run** | Tab through 14 pages at two widths with focus visible and never covered; grid, reorder, requests, palette, Stage. NVDA is not installed on the PC used |
| Responsive, zoom, short viewports, safe areas | **Automated: passing. Real devices: not done** | Reflow from 320 to 3840 px and at maximum zoom, 8 phone heights, landscape, keyboard-up layout |
| Visual baselines | **Candidates only** | 19 states at 4 sizes uploaded by CI; [review procedure](selecta-3-1-visual-review.md); none approved |
| Scale and load | **Measured on one PC** | [20,000-song Library, 100-song editor, 64-square Studio](selecta-3-1-measurements.md#scale), with a render running |
| Unassisted listener, creator and expert sessions | **Not run** | |
| P0 and P1 issues, rollback, owner sign-off | **P0 and P1 found were fixed; rollback demonstrated; sign-off not written** | [Findings register](selecta-3-1-evidence.md#findings-register): 1 P0 and 6 P1 fixed with tests, P2s listed with four still open |

## Known limitations

- No person has listened to the transitions or exports in this programme, used it with a screen reader, or used it unassisted. Tests and screenshots can't stand in for those.
- The review images come from the synthetic library and haven't been approved.
- Scale numbers come from one PC with copied rows, not a real 20,000-file library.
- The 258 inherited S3 items are still unreconciled (S31-0078-02).
- Four P2s are open: busy buttons in the Studio and Library still use a real `disabled`; Listen at 1280 x 860 with Display options open puts the lyrics below the fold; the desktop editor has seven actions in one row; Library filters take three rows on a phone.

## Decision record

| Field | Value |
|---|---|
| Version | Selecta 3.1 finishing |
| Merge | PR #25 merged by the owner, 2026-11-07, `6d78cf4` |
| ADR decisions | Accepted by the owner, `73bd72a` |
| Written go or no-go for release | Not recorded |
| Risk exceptions | None recorded |
| Last user, NVDA or listening assessment | None in this programme |
| Rollback | Demonstrated against 3.0 (`3b01dc1`) with `tests/rollback_check.py` |
| Next step | The person-only checks in the ledger, then the owner's written decision |
