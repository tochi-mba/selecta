# Runbook: Two speakers own one zone

Alert id: `lease-conflict` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

More than one speaker thinks it holds the zone's lease, so two may play at once.

## What to check

1. Listen: are two speakers audibly playing different things?
2. Which speaker shows the newest lease on the staff screen?

## What to do

1. From the staff screen, fence the stale speaker (this bumps the lease epoch; the stale one's commands are then refused).
2. If audio still doubles, power off the stale speaker.

## When to escalate

A conflict that returns after fencing: stop the zone and escalate.
