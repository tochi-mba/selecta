# Selecta 3.1 - release readiness and known evidence gaps

**Disposition: NOT READY / NO-GO (as of 2026-11-07).** This is a candidate report template for unmerged [PR #25](https://github.com/tochi-mba/selecta/pull/25), **not** release approval or confirmation of a complete implementation.

## Build and scope

- Base: merged 3.0 `main` `3b01dc1336aab0f1cb0a4d85be5eba359de81831` (PR #24).
- Implementing PR: #25, draft, head must be verified against its **latest SHA** before any decision; older green or cancelled jobs do not qualify.
- Surface: React/TypeScript Web UI, CSS, targeted interaction and Edge regression tests, synthetic visual-review image upload. No backend, audio-engine, schema or dependency changes are claimed.
- Primary intended platform: Windows + Edge + local Selecta server, with light/dark, touch and responsive browser support subject to independent review. Installed-PWA/offline server behaviour is **not** claimed to play audio without its local backend.

## Release gate register

| Gate | State | Evidence needed to change status |
|---|---|---|
| Latest-head `verify` including Python, Web, Edge and 70% combined coverage | **Pending** | Exact SHA, full job conclusion and logs; cancellation/failure blocks |
| Preserve source, drafts, corrections, settings, local-only and request atomicity | **Unverified** | Backend-contract and real app regression, no wrong mix or partial bridge |
| Audible playback, previews, transition continuity, Stage and Media Session | **Unverified** | Real audio/real supported OS review, mixed-control adversarial traces |
| Decodable revision-correct FLAC export | **Unverified** | Download, decode, measure content/duration/order against frozen snapshot |
| Manual keyboard and screen readers (NVDA/Edge plus available VoiceOver/TalkBack) | **Unverified** | Named platform/AT versions, task log, no essential traps |
| Responsive, 200/400% zoom, short viewport and safe areas | **Partially automated, not approved** | Full matrix, real device/AT, image review and safe-area/focus evidence |
| Deterministic visual baselines with owner-reviewed changes | **Candidate images only** | [Visual review procedure](selecta-3-1-visual-review.md), approved diff set |
| 20k Library / 100-song Editor / 64-cell Studio / loaded audio performance | **Unverified** | Real hardware, latency, frame/memory and response measurements |
| Unassisted listener, creator and expert task sessions | **Not run** | Observed completion/fail/hesitation with participant consent and actual data |
| Open P0/P1 issue triage, rollback and explicit owner sign-off | **Not done** | Accepted risk register, reproducible rollback run and recorded go/no-go |

## Known limitations and required decisions

- **No human study or assistive-technology review** has been performed in this PR; source inspection, axe checks and screenshots cannot substitute.
- Synthetic screenshots are *candidate* artifacts, not approved baselines or evidence that the interface works for real content, unreadable metadata or failed states.
- Background audio, actual transitions and FLAC require real media tests and audible evaluation. CI's muted Edge runner is valuable for behaviour, **not** perceived sound quality.
- The existing 3.0 task ledger contains historical status statements that predate PR #24's merge; the 258-item reconciliation is still incomplete. Do not infer 3.1 verification.
- Some ADRs remain **Proposed**, all 116 S31 tasks are unchecked, and the P0/P1 defect register plus 20k/100-song scale are not signed off.
- A green Web build or even green aggregate CI never independently satisfies human release acceptance. The PR must remain unmerged until the owner reviews all applicable evidence.

## Decision record

| Field | Value |
|---|---|
| Proposed version | Selecta 3.1 finishing |
| Decision | **NO-GO - incomplete acceptance** |
| Release/merge approver | **Not recorded** |
| Approved risk exceptions | **None recorded** |
| Last independent user / NVDA / real-audio assessment | **None recorded in this programme** |
| Rollback | Not demonstrated; existing source data and 3.0 baseline are preservation requirements |
| Next permissible step | Complete real checks, document issues, fix P0/P1, re-run all CI and seek explicit owner approval |

**Do not automatically check all items, mark release-ready or merge based on repository writes or test infrastructure alone.**
