# Runbook: Paired device fault

Alert id: `device-fault` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

One or more paired devices (tablets, speakers) report faults: low disk, crashes, lost pairing.

## What to check

1. Which device? The staff screen names it.
2. Is it a device that should still be paired?

## What to do

1. Restart the device.
2. If it is lost or stolen, revoke it at once from the roles page; its next command is refused.
3. Re-pair a replacement.

## When to escalate

Three or more devices faulting at once, or a device you cannot revoke.
