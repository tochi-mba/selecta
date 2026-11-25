# Lucy Usage rollout runbook

The procedure for moving workspaces from Lucy's monthly turn model to the session and weekly
allowance, as decided in
[ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md). This is a
procedure, not an alert runbook. The step of record is the
[step ledger](../verification/lm-step-ledger.md); what blocks release is the
[gate register](../verification/lm-gate-register.md).

State on 2026-11-25: the programme is at step 0, shadow metering only. Nothing here beyond
"Stop shadow recording" is to be run until the ledger says the programme is entering step 1.
Several controls this procedure needs are not built yet; each such step says so and gives no
command.

## Flag mechanics this relies on

- **`lucy.usage_shadow`** is an operations switch, on in the build. While it is on, every Lucy
  turn in Cloud is also recorded in usage units, beside the turn model, and no member sees a
  difference. The code reads it from the build's flags (`SELECTA_FLAGS`), not from targeting
  rules, so a rule or a kill switch on the Flags page does not stop the recording.
- **`lucy.usage_windows`** is a grant flag (`rules_default: false`): the build ships it on so
  that a rule can grant it, and a workspace that no rule grants is off. No catch-all off rule is
  needed. Rules are read in order and the first rule that answers decides.
- **Decided per workspace, by its owner.** The flag is decided once for the whole workspace, so
  every member gets the same answer. To decide it, the workspace's owner stands in for whoever
  is asking, with the owner's plan and account age but with no staff roles. So a rule that uses
  the "staff" segment never matches here, even for a staff member's own workspace. Staff
  accounts are granted by workspace id.
- **The cutover time per workspace.** Being granted the flag is not enough. A workspace is on
  the new model only when it is granted the flag **and** its cutover time (`cutover_at` in its
  `lucy_usage_state` row) has passed. A granted workspace with no cutover time, or one in the
  future, stays in shadow on the turn model.
- **A percentage rule answers for everyone.** It says on for the workspaces inside the
  percentage and off for the rest. Any rule placed after it is never reached, so the staff rule
  goes first.
- Every rule change needs a reason and writes a new version to the flag's history. A change
  that moves more than 10% of accounts waits as a delayed action and is carried out when due, so
  the 25% and 100% steps do not take effect the moment they are saved.

## Stop shadow recording at once

Use this if the shadow recording itself causes trouble (for example database load). It changes
nothing a member sees.

1. Add `-lucy.usage_shadow` to `SELECTA_FLAGS` in the cloud deployment's environment and deploy
   or restart the API. The flags are read when the process starts.
2. Confirm with the admin explain endpoint (`GET /api/admin/flags/explain/{user_id}`) that
   `lucy.usage_shadow` reads off at the build layer. New turns then write nothing to
   `lucy_usage_ledger`.
3. Write the stop and the restart dates in the
   [measurement record](../verification/lm-usage-measurement.md): the four weeks of data must be
   four weeks with the recording on.

With the shadow switch off every workspace is on the turn model alone, including any that were
on the new model, so this is also a stop for the whole programme.

## Step 1: put staff accounts on

Entry evidence is in the step ledger. Then:

1. List the workspace ids of the staff accounts taking part. Use the workspace id, not the
   user id.
2. Save the rule list for `lucy.usage_windows` through the admin Flags page, or
   `POST /api/admin/flags/lucy.usage_windows/change`, with the `set_rules` action and a reason:

   ```json
   {"action": "set_rules", "reason": "LM step 1: staff accounts",
    "params": {"rules": [
      {"kind": "workspaces", "params": {"ids": ["<workspace id>"], "on": true,
       "note": "LM step 1: staff accounts"}, "enabled": true}
    ]}}
   ```

   This is a WORKSPACES rule and it is placed first. Do not use a segment rule with
   `"staff": true`: it does not match when the owner stands in for the workspace (see above).
3. Check one staff workspace with `GET /api/admin/flags/explain/{user_id}`, giving the
   workspace owner's user id: `lucy.usage_windows` should read on, decided by rule 1
   (workspaces).
4. Set the cutover: see "How cutover happens" below.
5. Add a dated row to the step ledger.

## Steps 2 to 4: raise the percentage

Do not raise the percentage unless all three hold:

- the [gate register](../verification/lm-gate-register.md) is green (every row GO);
- at least one full week has passed since the previous raise took effect, and that step's
  comparison is recorded in the step ledger;
- the members being added have had their notice (see "Member notice" below).

A guard in the admin change path that refuses a raise when these do not hold is **not built
yet**. Until it is, the operator checks the three by hand and names the ledger entry in the
change's reason.

To raise, save the **whole** rule list with `set_rules`, staff rule first and the percentage
rule last, changing only the percentage:

```json
{"action": "set_rules", "reason": "LM step 2: 5% of workspaces, ledger entry <date>",
 "params": {"rules": [
   {"kind": "workspaces", "params": {"ids": ["<workspace id>"], "on": true,
    "note": "LM step 1: staff accounts"}, "enabled": true},
   {"kind": "percentage", "params": {"percent": 5, "salt": "lm-usage-windows",
    "note": "LM rollout: 5, then 25, then 100"}, "enabled": true}
 ]}}
```

- **Same salt every time: `lm-usage-windows`.** The salt fixes each workspace's place in the
  rollout. With the same salt, 25% contains everyone who was in the 5%. A new salt reshuffles
  everyone: most of the first group would be dropped back mid-week and a different group
  switched without notice.
- Do not use the Flags page's "rollout" action for this. It adds its rule in front of the staff
  rule, which would switch off the staff accounts outside the percentage, and it makes up a new
  salt when none is typed in.
- The steps are 5, then 25, then 100. Step 1's check (explain on one workspace inside and one
  outside the percentage) applies each time.
- Add a dated row to the step ledger for each raise.

## How cutover happens

A workspace switches at the start of a calendar month in the account's own time zone (ADR-0487
rule 6), so nobody loses part of a month they were counted in. Its first week opens at the
cutover with nothing used. In practice a rule saved during one month takes effect on the 1st of
the next, and the week each step is held for is counted from that 1st.

- **The job that gives each granted workspace its month-start cutover time is not built yet**
  (LM-0487-04). The code can hold a cutover time for a workspace, but nothing sets one. Until
  the job exists, granting the flag changes nothing for anyone: a granted workspace stays in
  shadow.
- **Cutting one account over now, for testing, is not built yet** as an operator control. Do
  not edit the `lucy_usage_state` table by hand in production.

## Member notice

Paid members are told in the product and by email before their cutover what changes and that
the price does not (ADR-0487 rule 11). **The notice is not built yet** and its wording is not
approved (gate 7). No paid member's workspace is to be cut over before both are done, so step 2
cannot start.

## Rollback

Rollback at steps 1 to 4 is the flag alone (ADR-0487 rule 7). Choose the smallest that fits:

| To do this | Change |
|------------|--------|
| Take one workspace off | Add a WORKSPACES rule with `"on": false` naming it, placed first, with `set_rules` |
| Go back one step | Save the rule list with the lower percentage and the same salt. If it moves more than 10% of accounts it waits as a delayed action, so it is not instant |
| Take everyone off now | The Flags page's kill switch on `lucy.usage_windows` (the `kill_switch` action). It is instant and wins over every rule, staff rule included |

What happens: once the rule change is live, the workspace is back on the turn model from its
next Lucy turn. The monthly turn counters were written all along, so that month's counts are
intact and nothing is lost or given back twice. What members see: the monthly Lucy turns they
had before, with this month's use already counted, in place of the session and week meters
(which are themselves not built yet, ADR-0484). Their conversations are untouched. The
faked-clock tests that prove cutover and roll back (LM-0487-04) are not written yet.

After a rollback, add a dated row to the step ledger saying why, and record any gate it reopens
in the gate register. Nobody new is added until that gate is green again. Once step 5
(clean-up) is done the turn counters no longer exist, and rollback by flag is no longer
possible.

## What to watch

- **Cost and limits per plan:** `GET /api/admin/economics/lucy-usage?days=7` (or
  `uv run python tools/lucy_usage_report.py --db <read-only url> --days 7`). Compare AI cost per
  active member and the shares reaching the session and weekly limits with the shadow figures,
  as the step ledger sets out.
- **Spend:** the [spend ceiling alert](spend-ceiling.md). A platform ceiling hit during a step
  is a reason to hold the step.
- **Lucy's health:** the admin AI routing page, for a deployment that is failing or disabled.
- **Members:** support reports of Lucy stopping sooner than expected, a limit message that does
  not match the meter, or a reset time that looks wrong. Each is a finding against a gate.
- **Emergency:** if Lucy's spend is running away, the
  [emergency controls](emergency/README.md) apply as they always have, on either model.

## Links

- [Step ledger](../verification/lm-step-ledger.md) - which step the programme is on.
- [Gate register](../verification/lm-gate-register.md) - what blocks the next step.
- [Measurement and sizing record](../verification/lm-usage-measurement.md) - the shadow figures
  each step is compared with.
- [Price change procedure](lucy-price-change.md) - what to do when a price, a plan's model, a
  cap or the allowance table changes during the rollout.
- [Lucy Usage checklist](../adr/selecta-lucy-usage-implementation-checklist.md) - the LM-0487
  tasks.
- The code that decides a workspace's model: `src/selecta/ai/usage_mode.py`.
