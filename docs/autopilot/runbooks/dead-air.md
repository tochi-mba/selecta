# Runbook: Dead air between songs

Alert id: `dead-air` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

SelectaDJ left a silence between two songs. Warning from 250 ms, critical from 2 seconds.

## What to check

1. Is the next song shown as prepared on the staff screen?
2. Is the buffer-low alert also raised? If so, follow that runbook first.
3. Did a staff member press Pause or Stop? That is not dead air.

## What to do

1. Press Skip to move to the next prepared song.
2. If nothing is prepared, start the offline fallback set from the staff screen.
3. Note the time in the night log.

## When to escalate

Dead air longer than 10 seconds, or three times in one hour: call the venue's SelectaDJ contact.
