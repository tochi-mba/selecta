# ADR-0461 - Remote control protocol: signed commands, fencing and takeover

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 3/7 Implemented; 3/7 In progress; 1/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF3. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0415 (playback devices and sessions: lease, heartbeat, take-over) and ADR-0419 (single audio owner): unchanged, extended to browser-owned audio. ADR-0414 (targeting), ADR-0416 (Rooms): unchanged. Sibling BF ADRs: ADR-0457, ADR-0460.
- **Source touchpoints:** `src/selecta/playback/session.py` (20 s speaker lease, 5 s heartbeat, `take_over`, `submit_command`), `src/selecta/playback/commands.py`, `src/selecta/playback/api.py`, `src/selecta/playback/zones.py` (all extended, not replaced); `web/src/devices/usePlaybackDevice.ts`, `web/src/devices/PlayingBar.tsx`; existing flag `devices.remote_control` in `src/selecta/flags/cloud.json` (semantics extended).
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md).

## Context and evidence boundary

The session machinery exists on `main` and is tested: one session per account or zone, a 20-second speaker lease renewed by 5-second heartbeats, take-over, reconnect and a command queue (`src/selecta/playback/`), with races covered in `tests/test_cloud_playback_races.py`. What changes with browser-owned audio is the stakes: the speaker is now a tablet in a bar whose tab can be killed by the OS, and the controller is a phone that must never believe a dead speaker is playing. The session's `song_index` today points into the server's asset library; with ADR-0458 the playing device resolves identity locally.

Command signing and fencing beyond the lease do not exist yet. Nothing below is implemented.

## Decision

- **Commands are metadata, signed, scoped and short-lived.** A control command (play, pause, skip, volume, queue change, programme change) carries the issuing identity, the target session, a fencing token, an operation id and a TTL. Controllers need no local audio and never send or receive any. Commands expire rather than replay: a command that outlives its TTL is dropped, never executed late.
- **Fencing on the session.** Every speaker lease carries a fencing token that increments on take-over and reconnect. A device executes only commands fenced to its current token; a stale speaker that wakes up after a take-over finds its token superseded and stops claiming the session instead of double-playing. A failed take-over leaves the old speaker's token valid: the transfer either provably happens or loudly does not, and a dead speaker is reported `uncertain`, never silently replaced by an invented one.
- **ACK means delivered, never audible.** A command acknowledgment proves the device received and applied it to its local state. Only the ADR-0460 posture (sound check, fresh heartbeats) supports any audible claim; controller UI language keeps the two apart.
- **Staleness downgrades.** Heartbeats older than the lease window downgrade reported state to `uncertain` for every controller; recovering devices reconcile through the existing reconnect path, adopting the current fence or surrendering.
- **Offline is survivable.** A playing device that loses the network keeps playing its local programme (sources are local); command and Rooms sync pause; on reconnect, expired commands are dropped, state reconciles, and the member is told what was missed. Cross-workspace isolation and role checks stay exactly as ADR-0414 and the roles model enforce today.

## User outcome and acceptance contract

A member queues the next song from their phone and the tablet across the room changes its deck within a breath, with the phone showing truth: applied, playing as of seconds ago, or uncertain with a reason. Two people grabbing control resolve to exactly one speaker. A crashed tablet never shows as happily playing, and taking over from it takes one clear action.

## Edge cases

- **Take-over race.** Two controllers request take-over simultaneously: the store serialises; exactly one new token wins; the loser sees who won. Extends the existing race tests.
- **Stale speaker resurrection.** A tab suspended mid-set returns after a take-over: its first heartbeat learns the superseded fence; it stops, surrenders, and offers to become a controller.
- **Command for a track missing on the speaker.** The speaker ACKs with a refusal reason (`unavailable_here`); the controller offers alternatives from the availability map (ADR-0458); the queue never silently skips.
- **TTL expiry during offline.** Commands queued while the speaker was offline expire; on reconnect none replay; the controller sees which were dropped.
- **Clock skew.** TTL and staleness computations use server-issued times, never device clocks.
- **Zone versus personal session.** Business zones (`zones.py`) carry the same fencing semantics per zone; one device may hold at most one zone's token.
- **Guest requests during `uncertain`.** Rooms keep accepting requests; planning holds until the speaker is certain again; guests never see internal state words.

## Rejected alternatives

- **Best-effort unsigned commands.** Without fencing, a suspended tab resurrects into double audio in a venue, the worst possible public failure. Rejected.
- **Command replay after reconnect.** Replaying a stale skip or volume change minutes later surprises the operator; expiry with a report is predictable.
- **WebRTC peer-to-peer control.** Adds NAT and TURN operations for no gain; the session store and existing HTTPS/SSE paths already fit the command rate.
- **Treating ACK as proof of playback.** The gap between delivered and audible is exactly where venue trust dies; the two-vocabulary rule is load-bearing.

## Implementation checklist - 3/7 Implemented; 3/7 In progress; 1/7 Not started; 0/7 independently Verified

1. **BF-0461-01 - Command envelope.** **Acceptance:** Signed, scoped, TTL'd command shape with operation ids; verification on the device; expired and out-of-scope commands refused with recorded reasons; no audio or path field exists in the envelope (asserted by test). **Required verification:** Unit tests both sides. **Implementation:** In progress: commands carry a fence, TTL and idempotency key, the speaker checks them against server time (`src/selecta/playback/fencing.py`, `web/src/devices/playbackFencing.test.ts`), and expired or superseded presses are refused with reasons; envelope signing and a test proving no audio or path field exist are not done. **Independently Verified:** No.
2. **BF-0461-02 - Fencing tokens.** **Acceptance:** Lease carries a fence; take-over and reconnect increment it atomically; a stale fence cannot execute commands or claim the session; failed take-over leaves the old fence valid. **Required verification:** Extensions to `tests/test_cloud_playback_session.py` and `_races.py`. **Implementation:** Implemented in `src/selecta/playback/fencing.py`; `tests/test_bf_playback_fencing.py` covers take-over bumps, failed take-over keeping the fence, stale speakers refused and racing take-overs on SQLite and PostgreSQL; passes. **Independently Verified:** No.
3. **BF-0461-03 - Truthful controller state.** **Acceptance:** Controller surfaces distinguish applied / playing-as-of / uncertain / interrupted; staleness downgrades automatically; no surface renders ACK as audible. **Required verification:** Vitest on `web/src/devices`, Playwright with a simulated dying speaker. **Implementation:** Implemented: `web/src/devices/PlayingBar.tsx` and `usePlaybackDevice.ts` distinguish applied, playing-as-of, uncertain and interrupted with staleness downgrades, and the ack route answers `audible: false`; unit tests pass. Playwright with a simulated dying speaker pending. **Independently Verified:** No.
4. **BF-0461-04 - Offline and reconciliation.** **Acceptance:** A playing device continues through network loss; on reconnect it adopts or surrenders the fence, drops expired commands, reports what was missed; local programme state survives. **Required verification:** Playwright offline spec, `tests/test_cloud_playback_*` extensions. **Implementation:** In progress: reconnect, lease expiry and expired-command refusal exist, but the deferred-delivery model (dropping expired presses on reconnect and reporting what was missed) is not built (`docs/integration-notes-bf.md`). **Independently Verified:** No.
5. **BF-0461-05 - Device-resolved programme.** **Acceptance:** Session programme references use ADR-0458 identities; the speaker resolves locally; `unavailable_here` refusals flow to controllers with alternatives. **Required verification:** `test_room_to_play.py` extensions. **Implementation:** In progress: the speaker acks `unavailable_here` (ADR-0458 identities resolved by `web/src/media/resolve.ts`), but session programme references and alternatives flowing to controllers are not finished. **Independently Verified:** No.
6. **BF-0461-06 - Isolation and roles.** **Acceptance:** Cross-workspace command injection impossible (negative tests); role checks on every command type; Rooms guests cannot reach control routes. **Required verification:** `tests/test_cloud_flag_gate.py` and rooms suites extensions. **Implementation:** Implemented: every playback route, the ack route included, is in the tenant-isolation matrix (`tests/test_cloud_tenant_isolation.py`, refused across workspaces), commands require the `devices.remote_control` role check, and guest routes cannot reach control routes; passes. **Independently Verified:** No.
7. **BF-0461-07 - Partition drill.** **Acceptance:** A scripted two-device drill (speaker plus controller, real network partition and take-over during partition) passes on real hardware with the old speaker provably safe. **Required verification:** The ADR-0466 cross-device gate, recorded. **Implementation:** Not started. Needs a person: two physical devices. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The fencing semantics extend ADR-0415 and ADR-0419 without changing their accepted decisions; any future unattended-venue runtime must re-derive its own control contract in a new ADR rather than loosening this one.
