# Runbook: Planner or model slow

Alert id: `model-slow` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

The planner or an analysis model is answering slowly (warning 5 s, critical 20 s).

## What to check

1. Is the venue's internet slow?
2. Is the machine overheating or busy?

## What to do

1. SelectaDJ falls back to the rule-based next-song choice; confirm the staff screen says so.
2. Extend the current section rather than steering hard until it recovers.

## When to escalate

Critical for more than fifteen minutes.
