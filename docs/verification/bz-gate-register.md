# SelectaDJ for Business release-gate register (ADR-0454 BZ-0454-13, BZ-0454-14)

The live register for Gate P (ready for pilots) and Gate S (ready to sell) of
[ADR-0454](../adr/adr-0454-business-edge-cases-stress-and-release-gates.md).
`selecta.business.rollout` reads this table: `python -m selecta.business.rollout` prints the
phase the records allow, both gate verdicts and whether the `business.signups` selling switch
would be refused. The Flags page refuses any `business.signups` rule that could reach more than
named pilot workspaces or users until Gate S is eligible and the
[GO record](bz-go-no-go-record.md) is signed (BZ-0441-09).

## The law of this register

- **Default NOT RECORDED.** Every row starts NOT RECORDED. Only the owner (or a person the owner
  names) changes a row, and only to PASS or FAIL with evidence, their name and the date.
- **Agents never pass a gate.** A PASS row recorded by Claude, Codex or any agent does not count;
  the checker reports it as a problem. Agents may link CI runs in the Evidence cell of a row that
  stays NOT RECORDED.
- **A green CI run is evidence, not a decision.** P2, P3 and P8 can point at CI; the person still
  records the row.
- **Gate S includes Gate P.** Selling also needs BZ-0449-11 (legal gate) and BZ-0447-15 (Stripe
  staging and accountant review) Implemented in their ADRs, and the signed GO record (S8).

## Gate P: ready for pilots

| Gate | Title | Status | Evidence | Recorded by | Date |
|---|---|---|---|---|---|
| P1 | Business code tasks pilots need are Implemented | NOT RECORDED | - | - | - |
| P2 | Every named edge-case test passes on SQLite and PostgreSQL in CI | NOT RECORDED | - | - | - |
| P3 | Business invariants B1 to B9 hold after every business test | NOT RECORDED | - | - | - |
| P4 | ST1 to ST4 pass scaled down and at full size on staging | NOT RECORDED | - | - | - |
| P5 | Real-device soak passes on all three kiosk types | NOT RECORDED | - | - | - |
| P6 | Accessibility: axe, keyboard sweeps, NVDA on S2, S4 and S6 | NOT RECORDED | - | - | - |
| P7 | Security: cross-organisation sweep, kiosk token copy, stolen tablet, offboarding drill | NOT RECORDED | - | - | - |
| P8 | Customer-facing leak tests (B4) pass for every state | NOT RECORDED | - | - | - |
| P9 | Every business feature behind its flag; business.* off returns today's behaviour | NOT RECORDED | - | - | - |
| P10 | Pilot agreement in place and each pilot venue's licence attested | NOT RECORDED | - | - | - |

## Gate S: ready to sell

| Gate | Title | Status | Evidence | Recorded by | Date |
|---|---|---|---|---|---|
| S1 | Legal review passed | NOT RECORDED | - | - | - |
| S2 | Pricing validated against the competitive risk | NOT RECORDED | - | - | - |
| S3 | Scouting pilots ran with zero platform-caused silence | NOT RECORDED | - | - | - |
| S4 | ST5 to ST10 pass on staging | NOT RECORDED | - | - | - |
| S5 | Stripe live-mode readiness reviewed | NOT RECORDED | - | - | - |
| S6 | Support runbook for silent venues and a status page entry | NOT RECORDED | - | - | - |
| S7 | VoiceOver on iPhone and a real screen-reader user on S4 and S6 | NOT RECORDED | - | - | - |
| S8 | GO decision recorded under ADR-0440 | NOT RECORDED | - | - | - |

## Machine evidence an owner can link (none of it passes a row)

| Gate | Command |
|---|---|
| P2, P3, P8 | `uv run pytest tests/test_business_*.py tests/test_bz_*.py -q` |
| P4 (scaled down) | `uv run python tests/load/business_scenarios.py run business_peak --fake` (and the other three) |
| P4, S4 (full size) | `python infra/staging/run.py business_peak` (needs staging) |
| P9 | `uv run pytest tests/test_business_rollout.py -q` (flag sweep) |
