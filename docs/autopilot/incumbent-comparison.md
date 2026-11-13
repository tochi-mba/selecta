# Incumbent comparison framework (ADR-0438, AV-0438-02)

**Status:** Framework and criteria only. Every fact about another product is **to be verified**
from the provider's own current terms or a hands-on trial, with the date and source recorded. No
prices or capabilities are claimed here; cells stay "to verify" until a person checks them.

## What is compared

The kinds of thing a venue uses today instead of SelectaDJ:

1. Business background-music subscription services (licensed catalogues with schedules).
2. A consumer streaming account played through the venue's speaker.
3. A personal playlist or local files on a laptop or phone.
4. A booked human DJ for some nights.

Name specific providers only once a person has checked their current public terms. Do not rely on
memory or second-hand reports.

## Criteria

| Criterion | How to check | Weight |
|---|---|---|
| Licensed for public performance in the venue's territory | Provider terms; collecting society guidance | Gate |
| Monthly cost to the venue, all in | Provider price page on the date checked | High |
| Musical flow: transitions, energy across the night | Blind mix test (blind-mix-test-protocol.md) | High |
| Unattended reliability: gaps, repeats over six hours | Soak evidence where measurable | High |
| Offline behaviour when the internet drops | Trial with the network unplugged | High |
| Staff steering: how fast a shift worker changes the mood | Timed task in a trial | Medium |
| Guest requests with moderation | Trial | Medium |
| Venue rules: banned songs, explicit lyrics, dayparts | Trial | Medium |
| Multi-zone and speaker support | Provider docs plus trial | Medium |
| Data and guest privacy | Provider privacy terms | Gate |

## Comparison table

| Criterion | Business music service | Consumer streaming | Own playlist | Human DJ | SelectaDJ Autopilot |
|---|---|---|---|---|---|
| Public performance licence | to verify | to verify | to verify | to verify | not cleared (ADR-0434) |
| Monthly cost | to verify | to verify | to verify | to verify | unknown (unit-economics-inputs.json) |
| Transitions | to verify | to verify | to verify | to verify | blind test pending |
| Six-hour reliability | to verify | to verify | to verify | to verify | real soak pending; simulated only |
| Offline behaviour | to verify | to verify | to verify | to verify | simulated only |
| Staff steering | to verify | to verify | to verify | to verify | behind flags, untested with staff |
| Moderated requests | to verify | to verify | to verify | to verify | behind flags, untested with guests |

For each filled cell record the source (URL or trial log id), the date checked and the person who
checked it. Keep the SelectaDJ column honest: it describes what is built and proven on a named
SHA, never what is planned.
