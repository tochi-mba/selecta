# Browser-first Cloud rollout runbook

The operational recipe for the `cloud.local_first` cutover decided in ADR-0456, ADR-0465 and
ADR-0467: how to create the cutover rules in the right order, the missed-grant symptom and its
remedy, and the rollback. The step of record is the
[step ledger](../verification/bf-step-ledger.md); the release truth is the
[gate register](../verification/bf-gate-register.md). Nothing here is run until the ledger says
the programme is entering step 5, and the flip itself happens only after the owner's recorded
decision (BF-0467-06).

## Flag mechanics this recipe relies on (ADR-0414)

- Targeting rules are evaluated in order and the first rule that answers decides; when none
  match, the flag stays as the layers above left it: **on**. So per-account granting is grants
  first, then a trailing catch-all off rule for everyone else, and the order is load-bearing.
- An enabled kill switch turns the flag off for everyone wherever it sits in the list. Never use
  a kill switch as the catch-all: it would turn the grants off too. It remains the emergency
  stop (ADR-0456: a `cloud.hosted_media` kill switch stops uploads and hosted processing for
  everyone, including grandfathered accounts; stored playback is untouched because it is not
  under the flag).
- A cloud flag whose build state is off never reaches the rules at all, so `cloud.hosted_media`
  must be on at the build layer (via `SELECTA_FLAGS`) for its grant rules to run.
- Every rule change needs an author and a reason and writes an immutable version to the flag
  history; rollback of rules restores an earlier version as a new one.

## The cutover, in order

Do these strictly in order. The flip guard (`src/selecta/flags/flip_guard.py`) re-checks the
result mechanically and refuses the flip naming whatever is missing; there is no manual override
below the owner (ADR-0467).

### 1. Turn the grant flag on at the build layer

Add `+cloud.hosted_media` to `SELECTA_FLAGS` in the cloud deployment's environment. This changes
nothing for members by itself once step 2's rules exist; it is what lets the per-account rules
decide. Deploy and confirm with the admin explain endpoint that the flag's build layer reads on.

### 2. Run the grandfather detection query

The grandfathered population is every account that has ever completed an upload (ADR-0465). The
source of truth is the `assets` table: a row exists only because an original was uploaded.
Indicative query (adjust to the schema at the time; the real query ships with BF-0465-01's audit
view and is the version of record):

```sql
SELECT DISTINCT workspace_id FROM assets ORDER BY workspace_id;
```

Export the id list and keep it with the change record: the rule must be enumerable and auditable
(the admin page shows who and why).

### 3. Create the grant rules, grants first

In the admin console (or `selecta.flags.rules.save`), set the `cloud.hosted_media` rules to, in
this order:

1. One or more **WORKSPACES** rules with `on: true` carrying the detection query's workspace ids
   (chunk the list if it approaches the 10,000-id rule limit), each with a note naming the query
   date. Add **USERS** grants only for the individual-account exceptions the audit names.
2. As the **last** rule, the catch-all off rule: a **percentage** rule with `percent: 0` and a
   fixed salt, for example:

   ```json
   {"kind": "percentage", "params": {"percent": 0, "salt": "bf-local-first",
    "note": "catch-all off: hosted media is grant-only below this line"}, "enabled": true}
   ```

   A zero-percent rule with no segment conditions matches every context and answers off, so
   everyone the grants did not name gets no hosted media; and the same rule is later the staged
   dial if a percentage rollout of the grant is ever wanted. Keep the salt stable: changing it
   reshuffles any nonzero rollout.

Save the whole list in one change whose **reason contains the grandfather verification marker**
once step 4 below has passed, exactly: `[grandfather-verified]`. The flip guard reads this marker
from the flag's change history; an unverified save must not carry it.

### 4. Verify the grandfather rule against the detection query

Re-run the detection query and check every returned id is matched by a grant rule (the
BF-0465-01 audit view automates this; until it exists, diff the id lists). Spot-check through the
admin explain endpoint: one grandfathered account answers on by `rule_on`, one fresh account
answers off by `rule_off` from the catch-all, and the impact preview shows no grandfathered
account turning off. Only after this passes, write the marker reason of step 3 (save the same
rules again with the `[grandfather-verified]` reason if the first save predated verification:
history grows, nothing is lost).

### 5. Run the flip guard, then flip `cloud.local_first`

Run the release-gate check (BF-0467-01): `flip_guard.check_flip_now(conn, gates_green=...)` with
`gates_green` answered from the [gate register](../verification/bf-gate-register.md) (every
release-critical row GO). It refuses with named reasons unless the grants exist, the catch-all
off rule is trailing, the marker is recorded, the build layer is on and the gates are green.

With zero refusals **and the owner's recorded flip decision (BF-0467-06)**, flip the default:
add `+cloud.local_first` to `SELECTA_FLAGS` in the cloud deployment's environment and deploy.
Append the step 5 row to the [step ledger](../verification/bf-step-ledger.md) with the evidence
links, and send the one-time cutover notice (BF-0465-04).

## The missed-grant symptom and remedy (ADR-0465)

**Symptom.** A member who has uploaded before reports, after the flip, that the upload surface
has vanished (and upload routes answer 403 `flag_off`). Their stored media still lists, plays and
exports; only adding is gone. That combination is the signature of a missed grant.

**Remedy.**

1. Confirm with the detection query filtered to their workspace that they have a completed
   upload, and with the admin explain endpoint that `cloud.hosted_media` answers off for them at
   the rules layer (`rule_off` from the catch-all).
2. Add their workspace id to a WORKSPACES grant rule above the catch-all (never below it), with
   a reason naming this runbook entry and the support ticket.
3. Re-check through the explain endpoint that they now answer on, and that the SSE reflow
   restored their upload surfaces without a sign-out.
4. Record the miss: the detection query or audit view had a gap, and BF-0465-01's audit is the
   place the gap gets fixed, not just this one account.

## Rollback

Rollback at any step is the flag alone (ADR-0465, ADR-0467): remove `+cloud.local_first` from
`SELECTA_FLAGS` and deploy. Do not touch the `cloud.hosted_media` rules: the grandfather rule is
independent of the flip and keeps hosted accounts working throughout either direction. Append a
dated rollback row to the [step ledger](../verification/bf-step-ledger.md) naming why, and record
any gate regression in the [gate register](../verification/bf-gate-register.md); no new accounts
enter until green again.

## Links

- [Step ledger](../verification/bf-step-ledger.md) - which step the programme is on.
- [Gate register](../verification/bf-gate-register.md) - what blocks the next step.
- [Evidence record template](../verification/bf-evidence-record-template.md) - how hardware
  evidence is recorded.
- Flip guard: `src/selecta/flags/flip_guard.py` (unit tests in `tests/test_bf_flip_guard.py`).
- Egress capture (gate 4): `tools/bf_egress_capture.py`.

## Voluntary migration and reconciliation questions (ADR-0465)

Migration is never a support-side flag change and never authorises deletion. If a member asks to
move from hosted playback to device-local playback, establish these facts in order:

1. **Which export?** Confirm the account export completed and record its manifest/checksum. An
   incomplete archive is not a migration input.
2. **Which device and files?** Ask which device performed the local import and whether browser
   file permission is still live. "Imported" does not mean "available on every device".
3. **What matched exactly?** Reconciliation matches content identity, not title/artist. Report
   matched, unmatched and likely-duplicate recordings separately; never merge a re-encode by
   metadata.
4. **Do recipes resolve?** For each affected recipe, report which recording references resolve
   locally, which remain hosted-only, and which are unavailable. A partial result is not called
   complete.
5. **Is the hosted library untouched?** Verify stored assets still list and play. Do not revoke
   `cloud.hosted_media`, delete objects, or alter retention as part of reconciliation.

If the member stops, the safe outcome is coexistence: device-local files play where available and
stored originals remain readable. Actual deletion stays a separate member-initiated operation
under ADR-0412 and its deletion ledger.
