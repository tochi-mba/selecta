# Runbook: Playing but silent

Alert id: `not-audible` (src/selecta/venueops/health.py, ADR-0436). Written for the person on shift.
Status: draft for the venue pilot. Controls named here (staff screen, roles page) come with the
venue flags, which are off by default and not yet shipped; until then the SelectaDJ contact does
these steps.
Logs you read here are redacted: no tokens, file paths, guest names or (by venue policy) song titles.

## What it means

The player reports playing but the room monitor hears nothing: the status is playing, not audible.

## What to check

1. Is the amplifier on and the venue volume up?
2. Is the speaker output going to the right device?
3. Was the emergency stop pressed?

## What to do

1. Check the physical amplifier and cables.
2. Move the zone to the standby speaker.
3. If neither helps, press Stop so the screen tells the truth, then fix the hardware.

## When to escalate

Silence over one minute with music shown as playing.
