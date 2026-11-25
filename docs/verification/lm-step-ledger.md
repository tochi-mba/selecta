# Lucy Usage rollout step ledger (LM-0487-07)

The live ledger for the rollout order decided in
[ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md) rules 1, 5, 6, 7
and 9. Its job is that three questions always have an answer: which step the programme is on,
what blocks the next one, and how to go back. Evidence moves a step, not a date. What blocks
release is in the [gate register](lm-gate-register.md), and the steps an operator follows are in
the [rollout runbook](../operations/lucy-usage-rollout-runbook.md).

## Current step

**0: shadow metering only (2026-11-25).** `lucy.usage_windows` is granted to no workspace, so
every member is on the turn model and sees no difference. Where `lucy.usage_shadow` is on, each
Lucy turn is also recorded in usage units for measurement. No measurement has been run, no size
has been set, and every gate is NO-GO.

## The steps

| Step | Name | Entry evidence (required to enter) | Exit evidence (required to leave) | Rollback |
|------|------|------------------------------------|-----------------------------------|----------|
| 0 | Shadow metering only | None: this is the starting state. The new ledger is written beside the turn model and nothing a member sees changes | Four weeks of shadow data measured and reconciled with invoices (gate 5); sizes set by the owner (gate 6) | Turn `lucy.usage_shadow` off to stop the recording. Nothing a member sees changes either way |
| 1 | Staff accounts | Step 0 exit evidence (gates 5 and 6 GO); cutover and roll back built and tested (LM-0487-04); the staff workspace ids listed in a named-accounts rule placed first | Every staff account has been through a full week and a weekly reset on the new model; the step's comparison (below) recorded here; no open finding against a gate | Remove the named-accounts rule. Staff accounts are back on the turn model at once with the month's turn counts |
| 2 | 5% of workspaces | Step 1 exit evidence; every gate in the register GO (ADR-0487 rule 8), gate 7 (member notice) included; the notice sent to the members in this step before their cutover | A full week held after the cutover; the comparison recorded here; no gate reopened | Set the percentage to 0, or use the kill switch on `lucy.usage_windows`. Keep the salt |
| 3 | 25% of workspaces | Step 2 exit evidence; at least one week since the previous raise; no gate reopened; the notice sent to the members added | A full week held after the cutover; the comparison recorded here | Lower the percentage to 5 or 0 with the same salt |
| 4 | 100% of workspaces | Step 3 exit evidence; at least one week since the previous raise; no gate reopened; the notice sent to the members added | A full week held after the cutover; the comparison recorded here | Lower the percentage with the same salt, or the kill switch |
| 5 | Clean-up, one full month after 100% | One full calendar month at step 4 with no rollback; the owner's recorded decision to remove the turn model | LM-0487-08 done: the class buckets, the `lucy_turn.*` counters, `ai.allowance.remaining()` and the monthly `TIER_LIMITS` backstop removed with no reader left | None by flag after this step: the turn counters are gone, so going back means restoring code. This is why the step waits a full month |

Rollback at steps 1 to 4 is the flag alone (ADR-0487 rule 7): the turn counters are still
written all the way to step 5, so a workspace taken off the flag is back on the turn model with
that month's counts intact.

## What to compare at each step

At the end of each week held, compare the accounts on the new model with the shadow figures in
the [measurement record](lm-usage-measurement.md), per plan:

| Figure | From | Compared with |
|--------|------|---------------|
| AI cost per active member in the week | The usage report for the week | The shadow figure for the same plan (50th, 90th and 99th percentile member) |
| Share of members who reached the session limit | The usage report for the week | The share the shadow data said would reach it |
| Share of members who reached the weekly limit | The usage report for the week | The share the shadow data said would reach it, and the 1 in 20 bound of ADR-0487 rule 3 |

Write the three figures, the shadow figures beside them and the difference into the ledger entry
for the step. A figure well away from its shadow figure is a finding: the step is held, and the
owner decides whether to go on, go back or change a size before anyone else is affected.

## One salt for every percentage step

Every percentage step uses the **same salt**: `lm-usage-windows`.

A percentage rule puts each workspace in a fixed place from 0 to 9,999, worked out from the
flag's name, the salt and the workspace's id. A workspace is included when its place is below
the percentage. With the same salt, raising 5% to 25% keeps everyone who was already in and only
adds workspaces. With a different salt every workspace gets a new place: most of the first 5%
would be dropped back to the turn model in the middle of a week, and a different set of members
would be switched without the notice they were promised. The admin page's "rollout" action makes
up a new salt when none is given, so the runbook saves the whole rule list with the salt written
in.

## When a step takes effect

A workspace does not change the moment its rule is saved. It switches at the start of a calendar
month in the account's own time zone (ADR-0487 rule 6), so nobody loses part of a month they
were counted in. So:

- Each step takes effect on a 1st: the rule is saved during one month and the workspaces it adds
  switch at the start of the next.
- The week held at each step is counted from that 1st, not from the day the rule was saved.
- Four steps (staff, 5%, 25%, 100%) on four month starts make the rollout about three to four
  months long, after the four weeks of measurement, unless the owner changes the cutover rule.
  ADR-0487 gives about ten weeks as the least the programme can take; with a month start for
  each step it is longer than that.
- Step 5 follows one full month after the 100% cutover.

## Ledger entries

Newest first. Every step change adds a dated row naming the evidence that justified it. A step
is never advanced in the same pull request that produces its entry evidence.

| Date | Entry | Evidence |
|------|-------|----------|
| | | |
