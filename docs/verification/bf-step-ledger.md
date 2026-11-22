# Browser-first Cloud rollout step ledger (BF-0467-02)

The live ledger for the `cloud.local_first` rollout order decided in
[ADR-0467](../adr/adr-0467-rollout-order-refactor-sequence-and-governance.md). Its job is that the
current step is always answerable: which step the programme is on, which gate blocks the next
one, and how to go back one step with a single flag change. Gates, not dates, advance steps; the
release truth lives in the [gate register](bf-gate-register.md) and the operational recipe in the
[rollout runbook](../operations/bf-rollout-runbook.md).

## Current step

**Default on (2026-11-22).** The owner chose to ship the browser-first flags default on before launch: there are no customer accounts, so nothing needs grandfathering and Steps 2 to 4 are skipped. Hosted media is a staff grant (`cloud.hosted_media`, `rules_default: false`). The ADR-0466 gates still apply to launch itself.

## The steps

| Step | Name | Entry evidence (required to enter) | Exit evidence (required to leave) | Rollback |
|------|------|------------------------------------|-----------------------------------|----------|
| 1 | Dark | None: this is the starting state. All runtime, media, DSP and shell work lands behind its flags, default off | The flag sweep green per merge proving hosted Cloud byte-identical for everyone; admin preview working for staff accounts | Nothing to roll back: no behaviour changed for anyone |
| 2 | Internal | Step 1 exit evidence; admin previews on the owner's and staff accounts only | The [gate register](bf-gate-register.md) filling from internal use; gates 1 to 4 green | Clear the staff previews; everyone is back to step 1 |
| 3 | Labs beta | Gates 1 to 4 green in the register; the Labs opt-in path verified end to end (BF-0467-05: opt in, truthful experience, opt out, feedback captured, every layer respected) | Labs feedback reviewed; findings routed to owning ADRs; no open truthfulness finding | Close the beta cohort by rule change; opted-in members fall back to the hosted experience |
| 4 | Percentage | Step 3 exit; the per-mode cost dashboard and error-rate view per flag cohort live with real data (BF-0467-04), linked here when they exist; stable-hash rollout rules ready | The percentage watched through the dashboards with no gate regression; any venue-posture claim stays behind the hardware gates regardless of percentage | Freeze or lower the percentage by rule change; a gate regression mid-percentage freezes new entries until green again, recorded in the register |
| 5 | Default on | Every ADR-0466 release-critical gate green; the grandfather rule verified in place (BF-0465-01); `cloud.hosted_media` rules created before the flip; the flip guard (`src/selecta/flags/flip_guard.py`) returns no refusals; the owner's recorded flip decision (BF-0467-06) | The cutover notice sent to grandfathered accounts (BF-0465-04); the missed-grant remedy path quiet | Revert `cloud.local_first` to off by flag change alone; the grandfather rule is independent of the flip and keeps hosted accounts working in either direction |
| 6 | Rollback (standing rule, any step) | Always available | Not a step to exit: at any step, rollback is the flag alone (ADR-0465) | The flag alone; the register records why, and no new accounts enter until green again |

## Dashboards for step 4 (BF-0467-04)

Step 4 may not begin until both dashboards are live with real data and the owner records them
green; the admin flag change path enforces this mechanically
(`src/selecta/flags/flip_guard.py`, `check_percentage_step_now`).

| Dashboard | Where | State |
|-----------|-------|-------|
| Per-mode cost (BF-0464-05) | `GET /api/admin/economics/cost-per-mode?month=YYYY-MM`; CLI `tools/bf_unit_economics.py cost-per-mode` | Built; no real data yet (needs the Labs beta population); invoice reconciliation pending ([measurement record](bf-unit-economics-measurement.md)) |
| Error rate per flag cohort | `infra/observability/generated/dashboards/local_first_cohort_error_rate.json`; `selecta_api_requests_total{cohort,status_class}` | Built and wired to live cohort decisions; not live until the API exporter is configured and real `hosted` and `browser_first` samples are reviewed ([dashboard runbook](../operations/bf-cohort-error-dashboard.md)) |
| Readiness (both, plus the marker) | `GET /api/admin/flags/cloud.local_first/percentage-readiness` | Answers not ready today |

## Ledger entries

Newest first. Every step change appends a dated row naming the evidence that justified it; a step
is never advanced in the same PR that produces its entry evidence.

| Date | Entry | Evidence |
|------|-------|----------|
| 2026-11-17 | Programme enters **Step 1 - dark**. This PR adds the governance plumbing only (this ledger, the [gate register](bf-gate-register.md), the protocols, the flip guard and the egress capture tool); no flag changed, no behaviour changed for anyone, every gate NO-GO | The ADR set (ADR-0455 to ADR-0467) accepted by the owner 2026-11-17; register created with all rows NO-GO |
