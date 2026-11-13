# Rights-cleared multi-night venue pilot plan (ADR-0438, AV-0438-05)

**Status:** Plan only. No pilot has been run. A pilot needs owner approval, rights clearance
signed off under ADR-0434 and a venue's written agreement; all are person steps.

## Preconditions (all must hold before night one)

1. Rights: written clearance for every song and model used in the venue's territory, including
   cached and rendered media (ADR-0434). Without it, no pilot.
2. Build: one exact release candidate SHA, with `python -m selecta.venueops.rollout` reporting no
   order or status problems, and tests/test_apb_rollout.py (flag-off rollback) passing on it.
3. Soak: a six-hour real-time soak on the pilot's speaker type
   (docs/autopilot/six-hour-soak-protocol.md) with a passing evidence file from
   `python -m selecta.venueops.soak --realtime --pid <server pid>`.
4. Safety: staff trained on emergency Stop and Pause; the venue's own music source stays
   connected and ready as the manual fallback.
5. Agreement: the venue knows it is a pilot, can stop at any moment, and agrees what is recorded.

## Shape

- 2 to 3 venues, 3 nights each, over about two weeks.
- Night 1 supervised: a SelectaDJ person on site all evening.
- Night 2 on call: staff run it, a SelectaDJ person reachable within 10 minutes.
- Night 3 unattended: staff run it alone.
- Flags on only at pilot venues: `autopilot.venue_mode` and the venue.* flags the venue needs.

## What is measured

| Measure | Source |
|---|---|
| Gaps, overlaps, repeats | Play log judged with `python -m selecta.venueops.soak --plays <log> --out <dir>` |
| CPU, memory, handles on the venue device | Soak harness `--realtime --pid` |
| Staff interventions (stop, skip, steer) and why | Staff dashboard log plus a short end-of-night form |
| Guest requests: made, played, declined and told | Request log |
| Manager's verdict: keep, change, stop | End-of-pilot interview (operator-interview-guide.md q9 to q13) |

## Stop rules

Stop the night and switch to the venue's own source on any P0 blocker from
docs/adr/selecta-autopilot-release-gates.md: unlicensed media, a wrong or missing song,
overlapping speakers, an uncommanded gap longer than two seconds, an inaccessible Stop, or any
data leak. Record the time, what happened and the SHA.

## After the pilot

Summarise per venue and per night. Results feed the GO/NO-GO record
(docs/autopilot/go-no-go-record.md) as evidence for the human checks gate; they never tick a
checklist line by themselves.
