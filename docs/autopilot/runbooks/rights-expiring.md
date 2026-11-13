# Runbook: Licence expiring

Alert id: `rights-expiring` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

A licence the night's music depends on expires within 7 days (warning) or 1 day (critical). After expiry the rights gate refuses those songs.

## What to check

1. Which licence is it? The venue rights page lists it without song titles in logs.
2. Is a renewal already in progress?

## What to do

1. Tell the venue owner the date.
2. Do not try to keep playing expired content: SelectaDJ will plan around it.

## When to escalate

Critical with no renewal in hand: the owner contacts the supplier.
