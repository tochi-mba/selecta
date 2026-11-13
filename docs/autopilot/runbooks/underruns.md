# Runbook: Speaker ran out of audio

Alert id: `underruns` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

The playing speaker's audio buffer emptied mid-song, heard as clicks or stutter.

## What to check

1. Is the speaker on Wi-Fi with a weak signal?
2. Is another heavy job (analysis, stems) running on the same machine?

## What to do

1. Move the zone to the standby speaker if one is paired.
2. Pause background analysis for the rest of the night.
3. Prefer a wired connection for the playing speaker.

## When to escalate

Five or more underruns a minute that moving speakers does not fix.
