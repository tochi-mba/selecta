# ADR-0467 - Rollout order, refactor sequence and programme governance

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 3/6 Implemented; 2/6 In progress; 1/6 Not started.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / spans BF0 to BF6. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0414 (targeting: rules, percentage rollout, Labs): unchanged, supplies the mechanics. The SC (Cloud implementation), AV (Autopilot) and BZ (Business) programmes: unchanged; they consume the browser player once qualified and nothing here blocks them. Sibling BF ADRs: all.
- **Source touchpoints:** `src/selecta/flags/cloud.json` and `src/selecta/flags/rules.py` (flag choreography); `web/src/` refactor areas named in ADR-0462; `src/selecta/` gating areas named in ADR-0456; `docs/adr/README.md` (programme index).
- **Proposal chapter:** [docs/saas/17-roadmap-and-risks.md](../saas/17-roadmap-and-risks.md).

## Context and evidence boundary

Twelve ADRs define what; this one fixes in which order, because two orderings are load-bearing: the grandfather rule must exist before the default flips (ADR-0465), and shared-shell refactors must prove local mode unchanged before Cloud consumes them (ADR-0462). The flag mechanics for staged rollout (rules, percentage with stable hashing, Labs beta for `kind: beta`, admin preview) are built and tested on `main`; this programme only choreographs them.

The dark-step ledger, flip guard and CI oracle are implemented on PR #96. The rollout itself has
not advanced: dates are deliberately absent because gates, not dates, advance phases.

## Decision

- **Rollout order for `cloud.local_first`:**
  - **2026-11-22, owner decision:** with no customer accounts yet, the browser-first flags ship default on and hosted media becomes a staff grant directly, skipping steps 1 to 4 below; the ledger records it. The ADR-0466 gates still apply to launch.
  1. **Dark:** runtime, media, DSP and shell work lands behind the flag, default off; hosted Cloud is byte-identical for everyone (the flag sweep proves it per merge).
  2. **Internal:** admin previews on the owner's and staff accounts; the ADR-0466 register starts filling.
  3. **Labs beta:** the flag (or a `beta`-kind companion) opens to self-serve opt-in once gates 1 to 4 are green; Labs members get the truthful-status experience and a feedback path.
  4. **Percentage:** stable-hash rollout by account, watched through the per-mode cost and error dashboards; any venue-posture claim stays behind the hardware gates regardless of percentage.
  5. **Default on:** only after the ADR-0466 release-critical gates are green and the grandfather rule is verified in place; `cloud.hosted_media` rules precede this step mechanically (a release-gate check refuses the flip without them).
  6. Rollback at any step is the flag alone (ADR-0465).
- **Refactor sequence** (each step merges only with local mode proven unchanged):
  1. Backend gating first (ADR-0456): the grant flag, requires edge, job re-pointing, export branch - all invisible while no rule exists.
  2. Shell and data-layer refactors (ADR-0462: manifest requirements, injected requests, unified flag read) - local sweep and full local e2e as the oracle.
  3. Runtime and media (ADR-0457, ADR-0458) dark behind their flags; schema migration for the metadata catalogue with up and down tested.
  4. Shared screens in Cloud (ADR-0462 tasks 4 to 6), then surfaces and onboarding (ADR-0463).
  5. DSP tiers (ADR-0459) and venue posture (ADR-0460) as evidence lands; control fencing (ADR-0461) before any two-device claim.
  6. Billing v2 (ADR-0464) and migration tooling (ADR-0465) last, nearest the flip.
- **Programme interactions.** SC, AV and BZ continue on hosted assumptions until the browser player is qualified; BZ venue work may then adopt the posture and fencing contracts by reference. No BF task edits those programmes' ADRs; cross-programme adoption is each programme's own decision recorded in its own documents.
- **Governance.** All thirteen ADRs are Accepted (owner, 2026-11-17); acceptance covers the decisions, not the claims - claims wait for gates. Task status flows as everywhere in this repo: implementers tick nothing without evidence; owner-delegated human checks are recorded as such; the README programme section is the index and the ADR-0466 register is the release truth. Changing a decision means editing the owning ADR with the owner's sign-off, not drift in implementing PRs.

## User outcome and acceptance contract

Members experience this as nothing, then an invitation, then a better default that never breaks what they had. Operators of the rollout can answer, at any moment, which step the programme is on, which gate blocks the next one, and how to go back one step with a single flag change.

## Edge cases

- **A gate regresses mid-percentage.** The percentage freezes or reverts by rule change; the register records the regression; no new accounts enter until green again.
- **Labs feedback contradicts a design ADR.** The finding routes to the owning ADR for an owner decision; the rollout does not improvise around its own documents.
- **The flip's release-gate check fails on grandfather verification.** The flip refuses mechanically; the BF-0465-01 audit names the gap; no manual override exists below the owner.
- **A refactor step cannot keep local byte-identical.** The difference is either accepted by the owner as deliberate (recorded in ADR-0462's parity list) or the step does not merge.
- **Another programme ships against the old hosted assumption mid-rollout.** Nothing breaks: hosted paths stay green under their flag; the adoption conversation happens in that programme's documents.

## Rejected alternatives

- **Date-driven rollout.** Dates against open hardware gates manufacture pressure to lower the gates; this programme's history (the abandoned branch) is the cautionary tale.
- **Big-bang flip with a migration window.** Couples every risk at once and needs the forced migration the owner rejected.
- **Feature-branch integration of all BF work** (the PR #64 pattern): one giant unreviewable branch is what this set replaces; work lands dark on `main` behind flags, step by step.
- **Governance by checklist file alone.** Inline ADR checklists plus the README section and the gate register keep decision, tasks and release truth each in one place; a parallel tracker would drift.

## Implementation checklist - 3/6 Implemented; 2/6 In progress; 1/6 Not started; 0/6 independently Verified

1. **BF-0467-01 - Flip guard.** **Acceptance:** A release-gate check refuses turning `cloud.local_first` default on unless the grandfather rule exists, is verified against the detection query, and the register's release-critical gates are green; the refusal names what is missing. **Required verification:** Unit test of the guard, one rehearsed refused flip. **Implementation:** Implemented in `src/selecta/flags/flip_guard.py` with refusal and success coverage in `tests/test_bf_flip_guard.py`. **Independently Verified:** No.
2. **BF-0467-02 - Step ledger.** **Acceptance:** The rollout step, its entry evidence and its rollback are recorded per step in `docs/verification/` as they happen; the current step is always answerable. **Required verification:** Ledger review at each step. **Implementation:** Implemented in `docs/verification/bf-step-ledger.md`; it records the owner's 2026-11-22 decision to ship default on before launch. **Independently Verified:** No.
3. **BF-0467-03 - Local-unchanged oracle in CI.** **Acceptance:** The flag sweep plus full local e2e run as the explicit merge bar for every ADR-0462 refactor PR, called out in the PR template for BF work. **Required verification:** CI configuration review, one refactor PR exercising it. **Implementation:** Implemented by the existing required flag-sweep and browser jobs in `.github/workflows/test.yml`, with the BF-specific obligation now explicit in `.github/pull_request_template.md`; the PR's green run is still required verification. **Independently Verified:** No.
4. **BF-0467-04 - Dashboards before percentage.** **Acceptance:** The per-mode cost dashboard (BF-0464-05) and an error-rate view per flag cohort exist before step 4 begins; the step ledger links them. **Required verification:** Dashboards live with real data. **Implementation:** In progress: the cost dashboard endpoint and generated cohort-error dashboard are present; request metrics carry cohort/status labels, and percentage increases are guarded on exporter configuration plus the owner-reviewed dashboard marker. The marker applies only to the proposed rule change or the latest saved rule change/rollback, so a later rollout-rule edit invalidates an older review. Real hosted and browser-first samples, cost data for both modes, invoice reconciliation, and the owner's green marker are still pending. The ledger remains at Step 1 - dark, so this gate does not authorize rollout. **Independently Verified:** No.
5. **BF-0467-05 - Labs opening.** **Acceptance:** The Labs opt-in path for the beta cohort works end to end (opt in, truthful experience, opt out, feedback captured) and respects every layer (plan, rules, kill switch). **Required verification:** `tests/test_cloud_flag_*` Labs cases, Playwright opt-in spec. **Implementation:** In progress: the member UI is integrated in `web/src/cloud/CloudApp.tsx`; `LocalFirstLabs` provides status, opt-in/out confirmation and feedback; backend service and account routes apply plan, build, rules and kill-switch decisions; backend and component tests are present. Tests have not yet been run in this implementation pass and no green CI evidence is recorded. The owner-controlled Labs cohort opening and the end-to-end opt-in/opt-out/feedback verification remain pending. The rollout ledger remains Step 1 - dark. **Independently Verified:** No.
6. **BF-0467-06 - Owner flip decision.** **Acceptance:** The owner reviews the register and the step ledger and records the decision to flip the default (or not yet); the flip itself happens only after that record. **Required verification:** Owner's recorded decision. **Implementation:** Not started. Needs a person: the owner. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. This ADR is the programme's spine: when in doubt about order, the sequence here wins; when in doubt about readiness, ADR-0466 wins; when in doubt about intent, ADR-0455 wins.
