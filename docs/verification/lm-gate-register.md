# Lucy Usage release-gate register (LM-0487-06)

The live register for the release gates of
[ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md) rule 8, with the
measurement, sizing, notice and flag-off gates the same ADR and
[its checklist](../adr/selecta-lucy-usage-implementation-checklist.md) put in front of the
rollout. The [step ledger](lm-step-ledger.md) refers to this register: `lucy.usage_windows` does
not go to 5% of workspaces, or beyond, while a row here is not GO. The steps an operator follows
are in the [rollout runbook](../operations/lucy-usage-rollout-runbook.md).

State on 2026-11-25: nothing is switched on for any member, no measurement has been run, and
every row is NO-GO with no evidence.

## The law of this register

- **Default NO-GO.** Every gate starts NO-GO and stays NO-GO until evidence has been seen and
  reviewed. Nobody changes a row on inference, and no deadline lowers a gate.
- **A test with a faked clock or a faked provider proves the logic, not the product.** Green CI
  is the bar for merging; this register is the bar for release. Gates 2 and 3 need a person with
  real devices and a real browser, and gate 5 needs real invoices. A simulation never changes
  those rows.
- **Unknown stays unknown.** A plan, a screen width or a message with no recorded result is
  unknown, never claimed.
- **Evidence is a record, not a memory.** Each row links a dated file in this folder, a test by
  name with the CI run that ran it, or a commit. A check the owner asked someone to do is
  recorded as owner-delegated.
- **Someone other than the builder.** ADR-0487 rule 8 asks that a person other than the builder
  verifies each gate. Each row names that person. A row with no verifier named is NO-GO.
- **A failed run is a finding, not a retry.** The record keeps the failure and the follow-up
  both.

## Staleness rule

Evidence ages, and a row goes back to NO-GO when what it proved has changed:

- A change to a model's price, a plan's model, a per-turn cap or the allowance table reopens
  gates 4, 5 and 6. `tests/test_lucy_price_baseline.py` fails on such a change until the
  measurement is re-run ([price change procedure](../operations/lucy-price-change.md)).
- A change to the admission check, the ledger or the meter's read model reopens gates 1, 2 and 9.
- A change to the limit wording or to the pages that show it reopens gate 3. A new major version
  of a browser used for gate 3 reopens it for that browser.
- A change to the member notice wording reopens gate 7.

The row says what reopened it and when, in the "Reopened gates" section below.

## How a row changes

1. Produce the evidence the row asks for and write it down in this folder, dated.
2. Someone other than the builder reviews it. For gates 2 and 3 that person repeats the check
   themselves.
3. Change the row in one commit that links the evidence, names the verifier and dates the
   change. A row never changes in the same pull request that builds the thing it gates.

## The gates

| # | Gate | Required evidence | Current result | Evidence |
|---|------|-------------------|----------------|----------|
| 1 | The meter and the admission check read one ledger: what a member is shown as used is the same figure the check that admits or refuses a turn reads | A test that drives turns and compares the meter's figures with the admission check's at each one, by name, with its CI run; reviewed by the verifier | NO-GO - no evidence | none |
| 2 | The race for the last of an allowance across two devices: two devices on one account send at the same moment with room for one turn, and exactly one is admitted | An automated concurrency test on Postgres by name, and a dated record of the same check done by a person on two real devices | NO-GO - no evidence | none |
| 3 | The limit messages of [ADR-0483](../adr/adr-0483-behaviour-at-the-limit-and-truthful-words.md) (one per cause in its rule 3 table) checked in a browser at phone and desktop widths | A dated record with a screenshot of each message at each width, the browser and its version, and the reset time shown agreeing with the meter | NO-GO - no evidence | none |
| 4 | The Lucy evaluation set passes on each plan's lighter model (the model a plan steps down to at its session limit) | The evaluation report for each plan's lighter model, dated, with every case passing | NO-GO - no evidence | none |
| 5 | Four weeks of shadow measurement, reconciled with provider invoices (ADR-0487 rule 2, LM-0487-02) | A dated report in this folder from at least four weeks of shadow data, with the invoice comparison and any difference explained, entered in the [measurement record](lm-usage-measurement.md) | NO-GO - no evidence | none |
| 6 | Sizes set by the owner under the three conditions of ADR-0487 rule 3 (LM-0487-03) | The sizing checklist in the [measurement record](lm-usage-measurement.md) filled in and signed by the owner, each condition shown met, and ADR-0482 and ADR-0485 amended with the figures | NO-GO - no evidence | none |
| 7 | The member notice wording approved by the owner (ADR-0487 rule 11, LM-0487-05) | The approved wording for the in-product notice and the email, with the owner's dated approval | NO-GO - no evidence | none |
| 8 | Flag-off parity proved: with `lucy.usage_windows` off, Lucy behaves exactly as the turn model did (LM-0480-05) | The full Python suite and the cloud Playwright suite passing with the flag off, linked by run | NO-GO - no evidence | none |
| 9 | Each of gates 1 to 8 verified by someone other than the builder | The verifier's name and the date against each of gates 1 to 8 in this table | NO-GO - no evidence | none |

## Reopened gates

None recorded. When the staleness rule fires, list here: the gate, what changed, the date, and
what has to be done again.
