# ADR-0396 - Worker gateway and worker pools

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/7 Implemented; 0/7 In progress; 6/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0394, ADR-0395; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/gateway/`, `src/selecta/workers/`, `services/` Dockerfiles, Modal app definitions.
- **Proposal chapter:** [docs/saas/04-queue-and-scheduling.md](../saas/04-queue-and-scheduling.md#4a6-workers-and-the-claim-protocol).

## Context and evidence boundary

Capacity must grow by starting more workers, on more than one provider, without exploding database connections or trusting worker clocks.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Workers hold no database or storage credentials; they use a worker gateway (`register`, long-poll `claim`, `heartbeat`, `progress`, `complete`, `fail`) with short-lived pool-scoped tokens, and touch storage only through signed URLs from their claim.
- The gateway is a separate deployment from the customer API (same image), so worker traffic can't starve customers. Long-polls never hold a database connection; wake-ups use `LISTEN/NOTIFY` on a direct connection with jittered, partial wake-ups and a periodic re-check.
- The claim response carries the attempt's signed input URLs, attempt-scoped output slots, lease, fencing token and the flag decisions the job needs.
- Pools by capability: cpu-light, cpu-heavy, gpu (stems), export. Exports run in their own pool. Speculative attempts can be preempted across accounts by waiting interactive work and never take a pool's last free slot.
- Worker placement follows data transfer: every output upload is egress from the worker's host. Beta runs all workers on Modal in an EU region (CPU and GPU); a reserved CPU pool on Hetzner shared-vCPU servers is added when steady load justifies it; workers do not run on Render (25 GB included egress, $0.15/GB beyond).
- Autoscaling (run by the maintenance leader) uses outstanding estimated work-seconds over target drain time and p95 wait, with per-pool min/max, daily spend ceilings, and a warm worker in the seam and stems pools only while someone is listening.

## User outcome and acceptance contract

Adding a worker means starting a container with pool settings and a credential; nothing else changes.

## Rejected alternatives

- Workers connecting to Postgres directly (connection storms, credentials everywhere).
- Push dispatch to fixed worker addresses.

## Implementation checklist - 1/7 Implemented; 0/7 independently Verified

1. **SC-0396-01 - Gateway endpoints.** **Acceptance:** All six endpoints exist with token auth and idempotency. **Required verification:** Integration tests. **Implementation:** Implemented; standalone `selecta gateway` service, scoped tokens, fenced lifecycle routes and signed object URLs. **Evidence:** `tests/test_worker_gateway_api.py`, `src/selecta/gateway_cloud.py`, `src/selecta/work/gateway_api.py`; **Independently Verified:** No.
2. **SC-0396-02 - Worker image.** **Acceptance:** Linux image with ffmpeg, torch CPU and pinned models runs analysis and renders end to end. **Required verification:** Staging smoke test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0396-03 - GPU pool.** **Acceptance:** Demucs windows run on Modal with CPU fallback when GPU capacity is absent. **Required verification:** Staging test; timing recorded. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0396-04 - Scale-out.** **Acceptance:** Throughput rises monotonically with worker count to a documented bottleneck. **Required verification:** Worker scaling benchmark 1→32. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0396-05 - Spend ceilings.** **Acceptance:** A pool stops scaling at its ceiling and alerts. **Required verification:** Staging test with a low ceiling. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0396-06 - Gateway isolation.** **Acceptance:** A worker storm on the gateway leaves customer API p95 unchanged. **Required verification:** Load test. **Implementation:** Not started; **Independently Verified:** No.
7. **SC-0396-07 - Egress measured.** **Acceptance:** Bytes uploaded per job type are recorded and match the cost model. **Required verification:** Phase 0 benchmark and staging metrics. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
