# Venue operator interview guide (ADR-0438, AV-0438-01)

**Status:** Guide ready. No interviews have been held. Running them is a person step; nothing in
this file is a finding.

## Who to talk to

- 8 to 12 independent venues: lounges, cocktail bars, cafés, small restaurants and shops that play
  music for at least four hours a day.
- The person who decides what plays (owner or manager) and, separately, one member of floor staff
  who changes the music during a shift.
- Exclude venues with a contracted resident DJ every night, chains whose music is set centrally,
  and anyone with a commercial relationship with SelectaDJ or REX Technologies.

## Before the session

1. Consent: explain the purpose, that the session is recorded only with permission, that notes are
   pseudonymised (V01, V02 ...) and that the venue can withdraw at any time. Record consent in the
   session log, not in this repository.
2. Do not demo SelectaDJ first. Ask about today's music before showing anything, so answers are not
   anchored to the product.
3. Bring the one-page pilot outline (pilot-plan.md) for the end only.

## Questions (45 minutes)

**Today's music (15 min)**

1. Walk me through last Friday: who chose the music, when it changed and why.
2. What do you play it from (service, device, speaker)? What does it cost you a month, all in?
3. When did the music last go wrong? What happened in the room, and what did staff do?
4. How often does someone on shift touch the music? What do they change?
5. Do guests ask for songs? How do you handle it today?

**Licensing and rules (10 min)**

6. Which public performance licences do you hold, and who arranged them?
7. Are there songs, words or styles you never want played? Who decides?
8. Volume: who sets it, and has it ever been a problem with neighbours or staff?

**Needs and limits (15 min)**

9. If the music ran itself for a whole evening, what would you need to see to trust it?
10. What would make you switch it off on the spot?
11. Who on staff should be allowed to stop, skip or steer it?
12. What would you pay a month for music that is right for the room all night? What would be too
    much? (Ask after questions 1 to 11; record the words, not just the number.)

**Close (5 min)**

13. Would you try a supervised pilot of two to three nights? What would stop you?

## Recording findings

Use one row per venue in the interview log, kept outside the repository:

| Field | Notes |
|---|---|
| Venue code | V01 ... |
| Type, size, hours of music a day | |
| Current source and monthly cost (as stated) | |
| Last failure and its effect | |
| Trust requirements (q9) | |
| Deal breakers (q10) | |
| Steering roles (q11) | |
| Willingness to pay (q12, verbatim) | |
| Pilot interest (q13) | |

Summarise themes only after all interviews are done, counting how many venues said each thing.
Findings feed `docs/autopilot/unit-economics-inputs.json` (price) and the pilot shortlist.
