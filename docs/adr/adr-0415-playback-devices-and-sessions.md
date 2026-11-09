# ADR-0415 — Playback devices and one session per account

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/5 Implemented; 0/5 In progress; 5/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 6. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** Audio focus rules in `docs/adr/selecta-3-audio.md`; their statuses are unchanged.
- **Source touchpoints:** `web/src/player.ts`; `web/src/state/tabs.ts`; `web/src/audio/mediaSession.ts`; `web/src/views/Now.tsx`; new `src/selecta/playback/`, `web/src/devices/`.
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md#11a1-devices-and-the-playback-session).

## Context and evidence boundary

A cloud account can be signed in on many devices, but music must play from exactly one, and Rooms need a reliable speaker device. Browser limits matter: iOS suspends Web Audio when the screen locks.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Each signed-in browser is a registered device (limit 10); one playback session per account with server-held state and a sequence number.
- The playing device holds a 20 s lease renewed every 5 s; others are remotes with live, extrapolated position and controls; commands carry idempotency ids and the sequence they were based on.
- 'Play here' moves the lease; the old device fades out; a lost-connection speaker keeps playing from buffer and fades out on reconnect only if someone else took over.
- Honest device guidance: laptops, desktops, Android and on-screen iPads as speakers; iPhones as remotes, with a wake-lock request and a plain warning.
- Only the active device reports listening events.

## User outcome and acceptance contract

No room ever hears two copies of the mix, any device can steer, and moving the music between devices is one tap.

## Rejected alternatives

- Multiple simultaneous playback sessions per account.
- Peer-to-peer device coordination.

## Implementation checklist — 0/5 Implemented; 0/5 independently Verified

1. **SC-0415-01 — Devices.** **Acceptance:** Registration, naming, list and sign-out work; the 11th device signs out the oldest. **Required verification:** Integration and Playwright tests. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0415-02 — Lease and remotes.** **Acceptance:** Commands from many remotes apply once and in order. **Required verification:** Concurrency test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0415-03 — Transfer.** **Acceptance:** 'Play here' moves playback with no double audio. **Required verification:** Playwright multi-context test plus real devices. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0415-04 — Offline speaker.** **Acceptance:** A speaker that loses connection keeps playing; reconnect behaviour matches the rules. **Required verification:** Chaos test on real devices. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0415-05 — Device guidance.** **Acceptance:** iOS speaker warning and wake-lock request shown where relevant. **Required verification:** Manual device test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
