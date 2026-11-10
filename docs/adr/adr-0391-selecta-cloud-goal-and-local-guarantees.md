# ADR-0391 - Selecta Cloud becomes a goal; local-only guarantees are scoped to local mode

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 2/4 Implemented; 0/4 In progress; 2/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 0. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0025, ADR-0072 and the repeated SaaS non-goal clauses in later programmes (see `docs/adr/README.md`); their statuses are unchanged.
- **Source touchpoints:** `docs/adr/README.md`; `README.md`; `web/src/ui/glossaryTerms.ts`; `web/src/views/Start.tsx`; `web/src/views/LocalBackup.tsx`.
- **Proposal chapter:** [docs/saas/README.md](../saas/README.md).

## Context and evidence boundary

Selecta was built as a local, single-user app, and 212 ADRs list SaaS, accounts and cloud upload as explicit non-goals (for example ADR-0025 and ADR-0072). The owner now wants a subscription cloud edition with three tiers, while keeping the local app. Those non-goals were right for the local programme and must not be silently contradicted.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Selecta Cloud (accounts, cloud storage, subscriptions, remote processing) becomes a goal of the project.
- Every local-only guarantee in earlier ADRs (no accounts, no cloud upload, no telemetry, audio never leaves the PC, 127.0.0.1 only) continues to hold **in local mode** and is scoped to it.
- Cloud mode carries its own guarantees instead: tenant isolation, private storage, honest status, bounded spending, and the privacy commitments in ADR-0412.
- Earlier ADRs keep their statuses; this ADR only scopes their non-goal clauses.

## User outcome and acceptance contract

A local user notices nothing: same first run, same copy, same privacy promises. A cloud user gets an account-based product whose promises are written down separately and tested.

## Rejected alternatives

- Rewriting or superseding each older ADR one by one (hundreds of edits, high risk of drift).
- Dropping the local app (the owner chose to keep both).

## Implementation checklist - 2/4 Implemented; 0/4 independently Verified

1. **SC-0391-01 - Programme entry.** **Acceptance:** `docs/adr/README.md` lists the Selecta Cloud programme and states local guarantees are unchanged. **Required verification:** Doc review. **Implementation:** Implemented. **Evidence:** `docs/adr/README.md`; `docs/saas/README.md`. **Independently Verified:** No.
2. **SC-0391-02 - Guarantee list per mode.** **Acceptance:** A table of local-mode and cloud-mode guarantees exists and is linked from both READMEs. **Required verification:** Doc review. **Implementation:** Implemented. **Evidence:** `README.md`; `docs/adr/README.md`; `docs/saas/README.md#guarantees-by-runtime-mode`. **Independently Verified:** No.
3. **SC-0391-03 - Local copy unchanged.** **Acceptance:** Local-mode user-facing text about privacy is unchanged by cloud work. **Required verification:** Playwright local-mode suite passes unchanged. **Implementation:** In progress; local privacy wording is pinned word for word against a22571d, the last main commit before the programme; the only addition is the lyrics-lookup-off variant of the glossary privacy term, which only drops the LRCLIB sentence; waits for a green CI run of the local suites. **Evidence:** `web/src/localPrivacyCopy.test.ts` (5 passed locally); `web/src/copy.test.ts`. **Independently Verified:** No.
4. **SC-0391-04 - Mode-aware privacy test.** **Acceptance:** `web/e2e/pages.e2e.ts` keeps 'only talks to this computer' in local mode and checks an origin allowlist in cloud mode. **Required verification:** Both e2e modes in CI. **Implementation:** Implemented; the local check stays in `web/e2e/pages.e2e.ts` (Edge E2E job); the cloud origin allowlist check is its cloud-suite twin in `web/e2e-cloud/live.cloud.ts` (Cloud E2E job), because the cloud config only runs e2e-cloud specs; both jobs are required by verify. **Evidence:** `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer'; `web/e2e-cloud/live.cloud.ts` 'the cloud site only talks to its allowlisted origins'; `.github/workflows/test.yml` jobs browser and cloud-browser; CI run 42804446112 (Edge E2E 1/2, 2/2 and Cloud E2E (Linux): success); both rerun locally on 2026-11-10. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
