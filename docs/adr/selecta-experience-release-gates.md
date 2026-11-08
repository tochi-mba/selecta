# Selecta experience-first - independent release gates (NO-GO)

**Decision:** NO-GO for release of proposed new experience. **21 Proposed decisions, 105 newly specified tasks Not started, 0 Implemented, 0 Verified.** This documents criteria only; no new runtime implementation or tests have run in this PR.

| Gate | Required evidence | Status |
|---|---|---|
| Approved decisions | Named acceptance/rejection and alternatives for each ADR | Pending |
| Real current baseline | Exact SHA, feature inventory, user tasks, actual screenshots | Pending |
| Feature parity | Old routes and functions compared with candidate, no dropped capability | Pending |
| Safe playback | Real media with one owner, route/Stage/media-key continuity, explicit Pause | Pending |
| Scope/revision and Undo | Current vs draft, stable seam IDs, delayed mutation and restoration | Pending |
| Requests and bridges | Explicit extra-song consent, atomic idempotent join | Pending |
| Expert access | Eight-lane Studio, 8–64 cells, real hearing, stable recovery | Pending |
| Export and study | Frozen-revision decodable FLAC and blinded, once-only A/B | Pending |
| Visual state quality | Reviewed dark/light/system, empty/error/loading/selected/focus/disabled | Pending |
| Accessibility | WCAG 2.2 AA target, axe + human NVDA/keyboard/touch/200/400% zoom | Pending |
| User task outcomes | Uncoached first play, shape, edit, bridge, Studio, export and recovery | Pending |
| Performance | 20k-song Library, 100-song Editor, 64-cell grid, hardware/latency/memory/audio | Pending |
| Privacy and platform | No original-file mutation, accurate LRCLIB disclosure, no desktop or SaaS scope creep | Pending |
| Regression and rollback | Exact SHA CI, preserved tests, old→new→old persisted data recovery | Pending |
| Owner verdict | Zero open P0, signed P1 disposition, final named GO/NO-GO | Pending |

**P0:** wrong-mix mutation, original-file loss, unconsented/partial bridge, overlapping/surprise-resuming audio, corrupt/wrong-revision FLAC, unsafe path/privacy disclosure, unrecoverable creative changes or essential inaccessible operation. **P1:** broken major flow, misleading readiness, meaningful focus/zoom failures, missing recovery or significant performance regression. **P2:** secondary cosmetic/wording refinements.

**Proposed usability research targets, not observed Selecta results:** ≥90% core task completion in representative uncoached trials (record numerator/denominator and limitations), clear current/draft/preview comprehension, responsiveness assessed with INP reference 200ms *where that metric is meaningful*, and audible quality reviewed by listeners. DSP latency is not the same as INP.

**No-go is not an assertion that the existing app is broken.** This programme's new experience has not been implemented or evaluated. A docs merge, green CI or synthetic screenshot never proves it has shipped. [Evidence ledger](selecta-experience-evidence.md) · [status reconciliation](selecta-experience-status-reconciliation.md) · [Playwright visual guidance](https://playwright.dev/docs/test-snapshots) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
