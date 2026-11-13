# Runbook: Little audio ready ahead

Alert id: `buffer-low` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

Fewer than 20 seconds (warning) or 5 seconds (critical) of audio are ready ahead of the playhead, so a gap is close.

## What to check

1. Is the venue's internet working? Check another device.
2. Is render-lag raised too?
3. Is the speaker's disk full (device-fault)?

## What to do

1. Switch to the offline fallback set (it plays from the speaker's own disk).
2. Hold the current genre so the planner picks songs that are already cached.
3. When the network is back, return to the plan.

## When to escalate

Critical for more than two minutes, or the fallback set is empty: escalate.
