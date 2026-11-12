# Selecta - FP historical status reconciliation and acceptance provenance

**Historical baseline - FP documentation proposal as of 2026-11-08:** baseline main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`. 8 Proposed ADRs (0264–0271), 64 task acceptances Not started, 0 In progress, 0 Implemented, 0 independently Verified. All owner decisions pending; no source change or human verification is claimed.

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-final-polish-implementation-checklist.md)):** 8 Accepted ADRs (0264-0271); 64 task acceptances: 53 Implemented, 2 In progress, 9 Not started (each names a person-only step); **0 independently Verified**.

## Programme status must be kept separate

| Programme | Historic documentation/ledger | Effect of this FP PR |
|---|---|---|
| T/P (ADR-0001–0046) | Foundational/local app and initial polish | No change; historical implementing evidence stands |
| S3/S31 (ADR-0047–0088) | Earlier overhauls, theme and visual QA | No change |
| S4 (ADR-0089–0113) | Broad design overhaul proposals | No change |
| EX/MI (ADR-0114–0164) | Journey, motion and experience work | No change |
| CI and spectrum (ADR-0165–0197) | Creative interface and 15 source-present spectrum modes | No change; modes must be preserved |
| SF / Selecta Flow (ADR-0198–0247) | 50 Accepted ADR decisions, separate 400-task baseline ledger | No change; do not count its 400 as absent existing source |
| GP / gap polish (ADR-0248–0263) | 16 Accepted ADR decisions (2026-11-08), separate 128-task ledger (2026-11-12: 111 Implemented, 17 Not started) | No change; GP requirements are acceptance deltas, some code already exists |
| **FP / final polish (ADR-0264–0271)** | **8 Accepted decisions; 2026-11-12: 53 Implemented, 2 In progress, 9 Not started, 0 Verified** | This PR creates a new independent docs ledger only |

**Baseline:** `main` `5347e7309c5ff8b2e2965c2194bf2089b6ad2721` on 2026-11-08. The FP roadmap and task IDs reference this baseline. Subsequent PRs must record their own exact SHA rather than treating this planning commit as implementation.

## Source facts that avoid fabricated work

- Existing `tokens.css` defines separate dark/light semantics and a first-paint theme preference; `ThemeChoice.tsx` provides System, Light and Dark.
- Existing `Now.tsx` renders live mixed-audio spectrum and preserves fifteen spectrum choices; ADR-0266 is about matched theme-state acceptance, not adding visualizers.
- Existing `Library.tsx` implements guarded batch selection with exact stable song IDs and a server batch endpoint; ADR-0267 addresses *when the action bar appears*, not missing batch capability.
- Existing `Studio.tsx` offers Shape, Grid and List, with the same eight stem lanes and 8–64-cell semantics; no reimplementation is authorized.
- Existing `LocalBackup.tsx` and `src/selecta/backup.py` support explicit local archive preview and staged restore; this FP series does not add backup features.
- Existing `web/e2e/visual.e2e.ts` samples different sizes for Light and Dark, so it cannot by itself establish matched same-state same-size pairs.

## Required reconciliation before changing any FP task status

1. Compare the exact new task acceptance with present source and tests, then the earlier SF/GP acceptance that owns its feature; record the exact unmatched delta.
2. If current code already satisfies it, record source/test SHA and evidence for owner review rather than duplicating code.
3. An ADR docs-only PR is not a source implementation or an independently witnessed review. Status remains Not started/Verified No unless explicitly reconciled per task.
4. Historical ledgers retain their original baseline and status, even if a newer source commit now satisfies an older requirement.
5. Owner accepts, rejects or supersedes each FP decision with date/rationale; no status auto-updates on PR merge.
6. For each implementing change, add tests and preserve original media, audio focus, request consent, revisions/Undo, Studio parity, privacy, FLAC and the Study protocol.
7. Independent verification must state actual reviewer, device/OS/browser, test data, task completion or failure, SHA, evidence and rollback outcome.
8. Publish a scoped GO/NO-GO for FP; it must not be confused with a global verdict on the current product.

## Invariant and release boundary

Never aggregate the historical 400 SF + 128 GP + 64 FP tasks as 592 unique features that are missing. They represent **different acceptance programmes with overlapping source features**. Unverified means no independent evidence has been recorded, not necessarily that the app lacks a feature.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [JSON](selecta-final-polish-code-status.json) · [Parity](selecta-final-polish-overlap-and-parity.md) · [Verification](selecta-final-polish-verification-matrix.md) · [Reconciliation](selecta-final-polish-status-reconciliation.md) · [Release](selecta-final-polish-release-gates.md)
