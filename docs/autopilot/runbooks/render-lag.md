# Runbook: Transitions not ready in time

Alert id: `render-lag` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

Transitions are being needed before they finish rendering (warning at 30 s late, critical at 120 s).

## What to check

1. Is the render machine busy or asleep?
2. Is model-slow raised too?

## What to do

1. Let SelectaDJ use plain crossfades until the queue drains (automatic in the fallback path).
2. Avoid manual takeover changes that force new renders.

## When to escalate

Critical for more than ten minutes.
