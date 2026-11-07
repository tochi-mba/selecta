# Selecta 4.0 — implementation-release readiness and explicit GO/NO-GO

**Current disposition: NO-GO for a Selecta 4.0 UI release (2026-11-07).** This proposal PR contains documentation only, and **may merge as planning documentation** without claiming that any proposed UI feature shipped.

- **Proposed:** 2026-11-07.
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (PR #25 and PR #26 already merged at review).
- **Status:** 25 decisions **Proposed**; 250 tasks **Not started**; **0 Implemented / 0 Verified**.
- **Change scope:** Documentation only; no frontend, backend, audio, database, test or CI changes.
- **History:** ADR-0001–0088, T/P/S3/S31 identities and their historical evidence remain unchanged.


Historical 3.1 status statements mentioning an open PR #25 are stale after its merge. PR #26 also merged. Do not change historical evidence or count old tasks as Verified automatically. This separate 4.0 release requires its own proof.

## Gate register — all outstanding

| Gate | Required proof | State |
|---|---|---|
| Complete feature parity | Existing actions mapped to new visible controls, with tests | Not started |
| Correct current/draft, revision and scoped Undo | Real backend contract and concurrent tests | Not started |
| One audio owner, stable navigation, Media Session | Supported Windows/Edge with real media | Not started |
| Request bridge consent and atomic join | All-or-none idempotent insertion tests | Not started |
| Exact frozen revision FLAC | Download, decode, content/order/length verification | Not started |
| Data and privacy | Original files untouched, preference and draft preservation, Host/Origin and metadata disclosure | Not started |
| Dark + light independently reviewed | Reviewed visual diffs, contrast and selected/focus/disabled states | Not started |
| WCAG 2.2 AA human acceptance | Axe plus manual NVDA/Edge; keyboard, zoom and mobile | Not started |
| Responsive layouts | 320–2560, 200/400% zoom, safe-area, virtual keyboard | Not started |
| 20k/100-song/64-cell scale | Recorded hardware, latency, memory and audio continuity | Not started |
| User task outcomes | Unassisted listener, creator, expert sessions and observed errors | Not started |
| CI on exact candidate head | Full Python/Web/Edge and actual green conclusions | Not started |
| Rollback | Old/new/old build and persisted data compatibility | Not started |
| Defect risk acceptance | Zero open P0, explicit owner disposition for P1/P2 | Not started |
| Final human go/no-go | Named reviewer, date, SHA and evidence links | Not started |

## Severity and status contract

**P0** wrong-mix change, original song loss, unconsented/partial bridge, audio overlap/surprise resume, corrupt/wrong-revision FLAC, privacy breach, lost durable creative work or inaccessible essential task: stop.

**P1** broken important flow, meaningful focus/zoom/media regression, missing recovery, misleading readiness: block unless named owner explicitly accepts risk.

**P2** secondary visual, alignment, wording or minor optimization: document disposition.

**Decision Accepted** needs the actual owner decision; **Implemented** needs merged code with relevant automated tests; **Verified** needs real independently reviewed visual, AT, audio, user and performance evidence applicable to the task. A green CI or checkbox alone is never a release. All S4 work currently **Not started**.

## Release sign-off template

| Field | Current value |
|---|---|
| Candidate commit | Not assigned |
| Approved ADRs | None |
| Implementing PRs | None |
| 4.0 tasks Implemented / Verified | 0 / 0 |
| CI and security | Not run for 4.0 |
| Human/NVDA/audio acceptance | Not run |
| Approved visual baselines | None |
| Scale metrics | No new measurements |
| Rollback demonstration | Not done |
| Approver and date | Not recorded |
| Verdict | **NO-GO** |

To change verdict, populate the [evidence ledger](selecta-4-evidence.md), fix defects, run tests at final SHA, review dark/light on real viewports, decode real FLAC, complete AT/user/audio review, demonstrate rollback and obtain explicit owner sign-off.
