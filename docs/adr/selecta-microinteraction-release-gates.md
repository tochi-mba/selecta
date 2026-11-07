# Selecta immersive experience and microinteraction programme — independent NO-GO release gates

**Current programme verdict: NO-GO, because implementation is partial and independent acceptance has not occurred.** 30 ADRs Proposed; **79 source-level Implemented, 125 In progress, 36 Not started; 0 independently Verified**. [PR #31](https://github.com/tochi-mba/selecta/pull/31) contains code and tests, not a release approval. This does not mean the currently shipping local-first application is broken; it describes this newly proposed experience delta.

| Gate | Required before GO | Current |
|---|---|---|
| Owner decision | Named owner accepts each implemented ADR and its trade-offs | Pending |
| Baseline | Exact SHA, preserved actions/routes and approved before/after screens | Pending |
| Motion honesty | Causal normal/reduced motion, no fake beats or progress | Pending |
| Visual clarity | Approved dark/light/system, focus, disabled, stale, error states | Pending |
| Audio | Real preview ownership, manual Pause, seam/fallback alignment and gap test | Pending |
| Mix integrity | Draft/current revision, stable ID, scoped Undo, concurrent requests | Pending |
| Bridge consent | Extra songs approved; idempotent atomic join | Pending |
| Studio parity | Eight lanes and exact Shape/Grid/List 8–64-cell interchange | Pending |
| Export and research | Frozen decodable FLAC and unbiased blind A/B answers | Pending |
| Accessibility | WCAG 2.2 AA design target, NVDA/Edge human testing, reduced motion | Pending |
| Responsive | Touch, 320–2560px, keyboard and 200/400% zoom | Pending |
| Performance | Real audio under background load and named p95 frame/INP traces | Pending |
| Privacy/platform | Original files protected; truthful lyric disclosure; no cloud/desktop scope | Pending |
| User research | Uncoached listener, creator, expert and recovery trials with denominators | Pending |
| Rollback | Rehearsed old→new→old copied data, feature preservation | Pending |
| Final GO/NO-GO | No P0, named disposition for P1, signed exact SHA and owners | Pending |

**P0 blockers:** wrong mix/revision edit, source file corruption, unconsented/partial bridge, overlapping or surprise-resuming sound, mismatched/corrupt FLAC, a serious privacy regression, inaccessible required action, irrecoverable creative change, unsafe flashes or false critical ready status. **P1:** broken major path, misleading queue or waiting indicator, missing reduced-motion equivalent, meaningful keyboard/zoom failure, persistent animation jank. **P2:** low-consequence cosmetic inconsistency.

**Research targets are proposed, not observed:** ≥90% uncoached core task completion with numerator/denominator, actual audio comparison with varied music, confident distinction between requested/rendered and current/draft, perceived calm/delight plus actual performance on named reference devices. Browser INP and DSP render latency are separate metrics.

**A partially implemented PR is not GO.** The 79 checked code items still require relevant independent evidence; the remaining 161 tasks still require implementation or task-specific acceptance. Do not promote any gate without a named reviewer and exact tested SHA. [Ledger](selecta-microinteraction-evidence.md) · [Checklist](selecta-microinteraction-implementation-checklist.md) · [Verification matrix](selecta-microinteraction-verification-matrix.md) · [Status reconciliation](selecta-microinteraction-status-reconciliation.md).
