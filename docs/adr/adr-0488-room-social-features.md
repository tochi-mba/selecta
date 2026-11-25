# ADR-0488 - Rooms: five things a room can do together, phone first

- **Decision:** Proposed. The owner approved the build plan on 2026-11-25; accepting this record is the owner's call.
- **Implementation:** 1/12 Implemented; 11/12 In progress; 0/12 Not started.
- **Independent verification:** 0/12 Verified.
- **Programme/date/baseline:** Room Social (RS); 2026-11-25; main `ae460274`.
- **Priority / phase:** P1. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/room-social`.
- **Existing ADR owners:** ADR-0416 (Rooms), ADR-0451 (Rooms for Business), ADR-0422 (nicknames), ADR-0475 (devices and the speaker), ADR-0462 (the browser is the planner), ADR-0390 and ADR-0414 (flags); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/rooms/`; `src/selecta/business/rooms/`; new `src/selecta/roomsocial/`; `src/selecta/playback/` (read only, through its events port); `web/src/guest/`; `web/src/display/`; `web/src/rooms/`; `web/src/business/rooms/`; `web/src/cloud/localFirstRequests.ts`.
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md#11a2-rooms-premium).

## Context and evidence boundary

The owner wants people in a room to do things together, not only send requests one by one. Their own limit, said on 2026-11-25: no open chat, because unidentified people could say anything. ADR-0416 and ADR-0451 already forbid guest free text for the Online Safety Act reason, and the site blocks the camera and microphone everywhere (`web/public/_headers`).

The owner also said many hosts have no television, so nothing may depend on one.

Two facts found in the code on the baseline, not measured in use:

- A party room does not know what is playing. `create_cloud_app` passes `RoomPorts` a catalogue and a planner only, so `now_playing` is `NothingPlaying`. A venue room already reads the zone's playback session (`business/rooms/ports.py`, `SessionPlayback`).
- Guest phones and the big screen read by polling (5 s and 3 s). Only signed-in pages have the event stream.

This ADR records a proposed decision. Nothing in it is implemented or measured yet.

## Decision

**The room plays the DJ.** A phone sends only something from a fixed set: a tap, a vote for an offered song, or a line picked from a list. No typed text, no photos, no camera, no microphone.

**The phone is always complete; a television only adds a shared view.** A screen counts as showing when it is paired and was seen in the last 30 seconds. Every feature starts, runs and finishes on phones alone. Settings that only affect the big screen exist only while a screen is paired; with none, they are absent and the page closes up.

Five features, each behind its own flag, in party rooms and in venue rooms:

1. **Pick the next song** (`rooms.rounds`, `business.rooms.rounds`). Two to four songs the DJ can blend into are offered; each guest has one vote; the winner goes into the mix. In a party room the candidates come from the speaker's browser, which is the planner (ADR-0462), and the winner is added automatically unless the host switches that off. In a venue room the server offers songs the zone may play now under its content rules, and the winner needs no staff approval. A vote starts from a host or staff button, or from a timer that is off until someone sets it.
2. **Keep the songs you liked** (`rooms.keeps`, `business.rooms.keeps`). A heart saves the playing song to a list held only on the guest's phone. Nothing about it is sent to the server.
3. **Reactions that teach the DJ** (`rooms.reactions`, `business.rooms.reactions`). Two kinds: a love for the playing song, and one for the blend between the last two songs. Counts are shown, never who tapped. A room adds to what the DJ learns only when at least two guests and 15% of those online agreed. There is no negative tap.
4. **Dedications from a fixed list** (`rooms.dedications`, `business.rooms.dedications`). A guest attaches one listed line to their own waiting request. The client sends an id and the server holds the words. Lines are chosen so none can be aimed at a stranger; the host can hide any of them.
5. **Tonight in numbers** (`rooms.recap`, `business.rooms.recap`). Totals for the room when it ends (per trading day in a venue). No guest ids, no nicknames, no line about one person; with fewer than three guests the most-loved lines are left out.

Supporting decisions:

- Party rooms read now playing from the playback session, as venue rooms do. Each song the speaker plays is written down as a play on the first look at the room while it is on (the pulse, a guest's page or the host's panel), which keeps Rooms out of the playback code and covers a song started by a command.
- Fast-moving state (tally, counts, the open vote) is one small answer built once a second per room per API instance and read by polling. Guests get no event stream.
- A venue zone can pair a patron screen at `/display` (`business.rooms.display`). The kiosk player is unchanged.
- What the host's features decide for guests is read once per workspace and remembered for five seconds, the same bound as the flag kill switch (ADR-0414).
- Retention: reactions, votes, vote options and plays are deleted 30 days after the room ends, with the rest of the guest data. The recap and the crowd marks hold no guest data and stay with the host's workspace; they leave with the account export and with deletion.

## Why this stays inside ADR-0416's rule

ADR-0416 allows "generated nicknames, catalogue picks only". Each new input is the same kind of thing: a vote is a pick among songs the service offered, a reaction is a tap on a song the service is playing, and a dedication is a pick from a list the service wrote. A guest cannot make another guest read words of their own choosing. The open legal reviews (SC-0416-07, BZ-0451-11) should cover these features before either product is sold more widely; that is filed for the owner in `docs/todo`.

## User outcome and acceptance contract

At a party or in a bar, people scan the code and the room chooses songs together, shows what it loves, sends a birthday line, and leaves with the songs it liked. The host sees what the night was. All of it works with phones only, and a television, where there is one, makes it bigger.

## Rejected alternatives

- Open chat, typed dedications or typed names (ADR-0416, and the owner's own limit).
- Photo snaps on the big screen: the camera is blocked site-wide, there is no image handling, and photos of guests who may be children are a new kind of data.
- An event stream for guests: polling a small shared answer survives weak venue Wi-Fi and needs nothing per connection.
- Features that need a television: many hosts have none.
- A negative reaction: absence of a love is the signal, and a boo button invites pile-ons.
- Matching individual guests by taste: that would profile guests, which 11A.2 rules out.

## Implementation checklist - 1/12 Implemented; 0/12 independently Verified

1. **RS-0488-01 - Now playing and plays in party rooms.** **Acceptance:** Guest page, big screen and host panel name the loaded song and say when it is paused; each song the speaker starts is one play row. **Required verification:** Integration tests. **Implementation:** Implemented; `rooms/session_now_playing.py` reads the playback session and `rooms/plays.py` writes a play on the first look at a song. The session reader itself has no test against a real session yet. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'each song is one play' and 'a paused song reads as paused'. **Independently Verified:** No.
2. **RS-0488-02 - The phone-first screen rule.** **Acceptance:** `screen` is true only while a paired screen was seen in the last 30 s; big-screen settings are absent with no screen paired; every feature completes with no screen. **Required verification:** Integration tests and a browser test with and without a paired screen. **Implementation:** In progress; a screen counts only while paired and seen in the last 30 s, and the big-screen settings group is rendered only while a screen is paired (`web/src/rooms/RoomSocial.tsx`). Needs a person: a real room with phones, and a browser walk with and without a screen. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'a screen counts only while it is paired and has just looked'. **Independently Verified:** No.
3. **RS-0488-03 - Pulse, tap limits and host feature decisions.** **Acceptance:** One query set a second per room per instance serves every phone; tap limits hold for a party on one address; a flag switched off reaches guests within 5 s. **Required verification:** Integration tests. **Implementation:** In progress; the pulse is made once a second per room (`rooms/pulse.py`), taps have their own windows (`rooms/limits.py`) and host flags are decided together and kept 5 s (`rooms/host_features.py`). The cache, the windows and the 5 s bound have no test of their own yet. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25) reads every feature through the pulse. **Independently Verified:** No.
4. **RS-0488-04 - Keep the songs you liked.** **Acceptance:** Hearts save on the phone only, survive a reload and the room ending, and can be copied; storage that is blocked is said once. **Required verification:** Unit and browser tests. **Implementation:** In progress; `web/src/guest/social/keeps.ts` and the heart, list, Copy and Share in `social.ts`. No unit or browser test yet. Needs a person: a real room with phones, and a browser walk with and without a screen. **Evidence:** `tsc` clean on 2026-11-25. **Independently Verified:** No.
5. **RS-0488-05 - Reactions.** **Acceptance:** One love and one blend tap per guest per play; counts on phones; bursts on a live screen; a ban removes the guest's taps. **Required verification:** Integration and browser tests. **Implementation:** In progress; server done and tested, phone and screen views built but not yet seen in a browser. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'a love counts once per guest', 'a late tap counts', 'a ban takes taps back'. **Independently Verified:** No.
6. **RS-0488-06 - Crowd marks teach the DJ.** **Acceptance:** A room counts only past the two-guest and 15% threshold; the planner ranks a crowd-loved blend above an otherwise equal one; an owner's own rating always wins. **Required verification:** Integration tests with fixtures. **Implementation:** In progress; crowd marks are kept with the two-guest and 15% threshold and steer the songs a vote offers (`web/src/rooms/roundCandidates.ts`). Mix making does not read them (to-do T-20261125-b9ce). **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'one guest alone teaches the planner nothing'. **Independently Verified:** No.
7. **RS-0488-07 - Pick the next song in party rooms.** **Acceptance:** Start by button and by timer; one vote per guest; a pick needs at least two voters (owner decision 2026-11-25: one vote ends as "Only one vote came in, so the DJ carries on", and the timer waits for two guests); lazy close agrees across instances; the winner is added automatically and said only once the speaker confirms; every edge case in the plan has a test. **Required verification:** Integration and browser tests. **Implementation:** In progress; server done and tested; the phone card, the screen panel, the host's button and settings and the speaker's part (`web/src/rooms/useRoomRounds.ts`) are built but not yet seen in a browser. The winner waits while the host's tab is hidden (to-do T-20261125-4891). **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'the room votes and the winner goes to the planner', 'nobody voting or the leader gone', 'a tie is broken the same way', 'the timer asks once'. **Independently Verified:** No.
8. **RS-0488-08 - Dedications.** **Acceptance:** Only listed ids are accepted; shown on phones and a live screen while the song plays; host can hide lines and clear one. **Required verification:** Integration and browser tests. **Implementation:** In progress; server done and tested, phone and screen views built but not yet seen in a browser. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'a dedication is a listed line on your own request and shows once'. **Independently Verified:** No.
9. **RS-0488-09 - Tonight in numbers.** **Acceptance:** Built once when the room ends; totals only; host, guest and screen views; survives the 30-day purge. **Required verification:** Integration and browser tests. **Implementation:** In progress; server done and tested; the host card, the guest's ended screen and the screen view are built but not yet seen in a browser. **Evidence:** `tests/test_cloud_rooms_social.py` (17 passed on SQLite, 2026-11-25): 'the recap is built once, totals only, and outlives the purge'. **Independently Verified:** No.
10. **RS-0488-10 - Venue rooms.** **Acceptance:** The five features under `/api/venue-rooms`, with content rules applied to vote options, staff start and cancel, and a per-day recap. **Required verification:** Integration and browser tests. **Implementation:** In progress; `business/rooms/social.py`, `social_votes.py` and their routes, the venue guest page and the manager's controls. Not yet seen in a browser (to-do T-20261125-90cf). **Evidence:** `tests/test_business_rooms_social.py` (10 passed, 2026-11-25); `tests/test_business_client_routes.py` (10 passed). **Independently Verified:** No.
11. **RS-0488-11 - Patron screen for a venue zone.** **Acceptance:** `/display` pairs to a zone, shows branding and the join code, and follows the 30 s rule. **Required verification:** Integration and browser tests. **Implementation:** In progress; a screen pairs to a zone and follows the 30 s rule. Not yet seen in a browser. **Evidence:** `tests/test_business_rooms_social.py` (10 passed, 2026-11-25): 'a patron screen pairs to a zone and only counts while it looks'. **Independently Verified:** No.
12. **RS-0488-12 - Flags, retention, export and the flag sweeps.** **Acceptance:** Every route has a flag owner; each flag off leaves no words, routes or gaps on the guest page, the screen and the host panel; purge, export and deletion cover the new tables. **Required verification:** Flag sweep, audit and integration tests. **Implementation:** In progress; eleven flags own every new route (`tests/test_flags.py` passed, `docs/flags.md` regenerated), and the purge covers the new tables. The cloud flag sweep has not been run with each new flag off, and the account export does not yet include crowd marks and recaps. **Evidence:** `tests/test_flags.py` (2026-11-25); the purge cases in both social test files. **Independently Verified:** No.

## Governance

Proposed on 2026-11-25. The owner chose the five features, both room kinds, automatic winners, the button plus timer, and a branch of its own. Older ADRs keep their statuses; this one only links to them.
