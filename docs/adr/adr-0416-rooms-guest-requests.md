# ADR-0416 - Rooms: Premium guest requests by QR code

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/7 Implemented; 0/7 In progress; 3/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 6B. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** Song request ADRs including atomic bridge consent (ADR-0383); ADR-0415; ADR-0414; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/requests.py`; `src/selecta/request_planner.py`; `src/selecta/routes/song_requests.py`; `web/src/views/Requests.tsx`; new `src/selecta/rooms/`, `web/src/rooms/`, `web/guest/`.
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md#11a2-rooms-premium).

## Context and evidence boundary

The owner wants Premium hosts to share a QR code so anyone at a party can join a room and add song requests. Selecta already plans requests musically (oldest first, one per spot, bridges with consent).

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Premium hosts open one Room at a time from Listen; guests join at `/r/{code}` with no app or account, using an anonymous room-scoped token.
- Guests see now playing and upcoming, search the host's requestable songs (title, artist, length only) and request; requests become `song_requests` rows with `source = room` so the existing planner does the musical work.
- Host controls: join mode, request mode, requestable crate, per-guest and per-room limits, cooldowns, votes, nickname visibility, moderation (approve, pass, remove, ban, lock, new code), big-screen display pairing, automatic end rules.
- Ordering among accepted room requests: approval time, votes, and round-robin across guests; each room has a request-render cap; renders run in the host's interactive lane.
- Guests never receive audio; no free text anywhere (generated nicknames, catalogue picks only); guest data deleted 30 days after the room closes.
- Codes: 8 characters from an unambiguous alphabet, looked up by hash, rate-limited joins, no reuse for 30 days.

## User outcome and acceptance contract

A host puts a QR code on a screen, guests request songs from their phones, and Selecta fits them into the mix while the host stays in charge.

## Rejected alternatives

- Streaming audio to guests' phones (legal and latency problems).
- Free-text suggestions and chat (Online Safety Act exposure).
- Requiring guest accounts.

## Implementation checklist - 3/7 Implemented; 0/7 independently Verified

1. **SC-0416-01 - Room lifecycle and codes.** **Acceptance:** Open, lock, rotate code, end, expiry and no-reuse rules work. **Required verification:** Integration tests. **Implementation:** Implemented; open, lock, rotate code, end, the 12-hour and no-speaker expiry, one open room and 30-day no-reuse rules work. **Evidence:** `tests/test_cloud_rooms_lifecycle.py`, `tests/test_cloud_rooms_codes.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0416-02 - Guest page.** **Acceptance:** Bundle under 100 KB of JavaScript; join, search, request, vote and status states pass on old phones and slow networks. **Required verification:** Playwright mobile emulation plus real phones. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0416-03 - Planner integration.** **Acceptance:** Room requests plan through the existing planner with round-robin across guests and the render cap. **Required verification:** Integration tests. **Implementation:** Implemented; room requests plan through the existing request planner with round-robin across guests, the planner window and the hourly render cap, and wait while no speaker is online. **Evidence:** `tests/test_cloud_rooms_planning.py`, `tests/test_room_to_play.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
4. **SC-0416-04 - Moderation.** **Acceptance:** Approve, pass, remove, ban and lock behave as specified; banned guests' pending requests are withdrawn. **Required verification:** Integration tests. **Implementation:** Implemented; approve, pass, remove, ban (by guest and IP hash) and lock behave as specified, and a banned guest's pending requests are withdrawn. **Evidence:** `tests/test_cloud_rooms_requests.py`, `tests/test_cloud_rooms_guests.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
5. **SC-0416-05 - Display pairing.** **Acceptance:** A paired display shows the QR, now playing and upcoming, and survives code rotation. **Required verification:** Playwright test. **Implementation:** Implemented; a paired display shows the QR, now playing and upcoming, and stays paired through a new room code. **Evidence:** `web/e2e-cloud/display.cloud.ts` 'a paired display shows the room and survives a new code' and `tests/test_cloud_rooms_display.py`, passing. **Independently Verified:** No.
6. **SC-0416-06 - Abuse and scale.** **Acceptance:** 1,000 joins in 10 s, request floods and code brute-forcing pass the Rooms stress scenarios. **Required verification:** Load and security tests. **Implementation:** Not started; **Independently Verified:** No.
7. **SC-0416-07 - Legal points.** **Acceptance:** Terms, guest privacy notice and Online Safety Act view recorded. **Required verification:** Legal review. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
