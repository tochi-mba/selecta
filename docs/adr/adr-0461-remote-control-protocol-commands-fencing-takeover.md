# ADR-0461 - Remote control protocol: signed commands, fencing and takeover

> Words: this record keeps the names of its time; [glossary.md](../glossary.md) says what each is called now (ADR-0479).

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 6/7 Implemented; 1/7 In progress; 0/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF3. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0415 (playback devices and sessions: lease, heartbeat, take-over) and ADR-0419 (single audio owner): unchanged, extended to browser-owned audio. ADR-0414 (targeting), ADR-0416 (Rooms): unchanged. Sibling BF ADRs: ADR-0457, ADR-0460.
- **Source touchpoints:** `src/selecta/playback/session.py`, `zone_session.py`, `fencing.py`, `deferred.py`, `envelope.py`, `programme.py`, `commands.py`, and `api.py`; `web/src/devices/usePlaybackDevice.ts`, `PlayingBar.tsx`, and `ControllerNotices.tsx`; the `devices.remote_control` gate.
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md).

## Context and evidence boundary

The current implementing branch contains the server and browser paths for fenced personal and zone playback: signed metadata envelopes, server-time TTL and idempotency, lease fencing, offline command reconciliation, catalogue identities, controller notices, and device hooks. This checklist records implementation visible in source, not passing tests, a real partition run, or independent verification. A browser can keep using its locally resolved programme during a network interruption only while its server-issued lease remains valid; the real-device partition and takeover behavior still needs its hardware run.

## Decision

- **Commands are metadata, signed, scoped and short-lived.** A control command (play, pause, skip, volume, queue change, programme change) carries the issuing identity, the target session, a fencing token, an operation id and a TTL. Controllers need no local audio and never send or receive any. Commands expire rather than replay: a command that outlives its TTL is dropped, never executed late.
- **Fencing on the session.** Every speaker lease carries a fencing token that advances when lease ownership moves to another device. A same-holder reconnect or renewal keeps its current token. A device executes only commands fenced to its current token; a stale speaker that wakes up after a take-over finds its token superseded and stops claiming the session instead of double-playing. A failed take-over leaves the old speaker's token valid: the transfer either provably happens or loudly does not, and a dead speaker is reported `uncertain`, never silently replaced by an invented one.
- **ACK means delivered, never audible.** A command acknowledgment proves the device received and applied it to its local state. Only the ADR-0460 posture (sound check, fresh heartbeats) supports any audible claim; controller UI language keeps the two apart.
- **Staleness downgrades.** Heartbeats older than the lease window downgrade reported state to `uncertain` for every controller; recovering devices reconcile through the existing reconnect path, adopting the current fence or surrendering.
- **Offline is survivable.** A playing device that loses the network keeps playing its local programme while its server-issued lease remains valid (sources are local); command and Rooms sync pause; on reconnect, expired commands are dropped, state reconciles, and the member is told what was missed. Cross-workspace isolation and role checks stay exactly as ADR-0414 and the roles model enforce today.

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

## Implementation checklist - 6/7 Implemented; 1/7 In progress; 0/7 Not started; 0/7 independently Verified

1. **BF-0461-01 - Command envelope.** **Acceptance:** Signed, scoped, TTL'd command shape with operation ids; verification on the device; expired and out-of-scope commands refused with recorded reasons; no audio or path field exists in the envelope. **Required verification:** Unit tests both sides. **Implementation:** Implemented in `src/selecta/playback/envelope.py` and `fencing.py`, with client checks in `web/src/devices/usePlaybackDevice.ts`: canonical HMAC-SHA256 envelopes are scoped to workspace, zone, device and fence; metadata-only fields are enforced when building envelopes; device checks signature, scope, fence and server-time expiry. Test execution and independent verification are not recorded here. **Independently Verified:** No.
2. **BF-0461-02 - Fencing tokens.** **Acceptance:** Lease carries a fence; a transfer to another device advances it atomically; same-holder reconnect preserves it; a stale fence cannot execute commands or claim the session; failed take-over leaves the old fence valid. **Required verification:** Session and race verification, including SQLite and PostgreSQL behavior. **Implementation:** Implemented across `src/selecta/playback/session.py`, `zone_session.py`, and `fencing.py`. Ownership changes advance the fence; same-owner renewal preserves it; command submission, heartbeat takeover and ACK check it under the session lock. Browser commands send the current fence, and playback/zone command API models now require it; direct legacy submissions without a fence are refused as superseded. Device heartbeat compatibility for older clients remains unchanged. No test pass or independent verification is claimed here. **Independently Verified:** No.
3. **BF-0461-03 - Truthful controller state.** **Acceptance:** Controller surfaces distinguish applied / playing-as-of / uncertain / interrupted; staleness downgrades automatically; no surface renders ACK as audible. **Required verification:** Browser tests and a simulated dying-speaker run. **Implementation:** Implemented in `web/src/devices/PlayingBar.tsx`, `ControllerNotices.tsx`, and `usePlaybackDevice.ts`; session confidence and output status drive controller copy, while ACK API responses explicitly return `audible: false`. Test execution and independent verification are not recorded here. **Independently Verified:** No.
4. **BF-0461-04 - Offline and reconciliation.** **Acceptance:** A playing device continues locally through network loss while its server-issued lease remains valid; on reconnect it adopts or surrenders the fence, drops expired commands, reports what was missed; local programme state survives. **Required verification:** Browser offline coverage and the real-device partition run. **Implementation:** Implemented in `src/selecta/playback/deferred.py`, `session.py`, `zone_session.py`, and both browser device hooks. Commands held during a lapsed lease are delivered only if still current, or dropped as expired, stale or superseded; session views and controller notices expose waiting and missed presses. The speaker stops when its server-issued lease expires. Real partition behavior remains pending. **Independently Verified:** No.
5. **BF-0461-05 - Device-resolved programme.** **Acceptance:** Session programme references use ADR-0458 identities; the speaker resolves locally; `unavailable_here` refusals flow to controllers with alternatives. **Required verification:** Browser and playback/Rooms integration coverage. **Implementation:** Implemented in `src/selecta/playback/programme.py` and `session.py`: programmes resolve workspace catalogue IDs to content hashes, unavailable ACKs produce availability-based alternatives, and `web/src/devices/ControllerNotices.tsx` offers those alternatives. Test execution and independent verification are not recorded here. **Independently Verified:** No.
6. **BF-0461-06 - Isolation and roles.** **Acceptance:** Cross-workspace command injection impossible; role checks on every command type; Rooms guests cannot reach control routes. **Required verification:** Tenant-isolation, flag-gate and Rooms route verification. **Implementation:** Implemented in `src/selecta/playback/api.py`: personal playback routes resolve the caller's workspace and device; zone routes check zone membership and the caller's device/kiosk; command routes require `devices.remote_control`; zone ACK authorization is checked inside its mutation transaction. Test execution and independent verification are not recorded here. **Independently Verified:** No.
7. **BF-0461-07 - Partition drill.** **Acceptance:** A scripted two-device drill (speaker plus controller, real network partition and take-over during partition) passes on real hardware with the old speaker provably safe. **Required verification:** ADR-0466 cross-device gate, recorded. **Implementation:** In progress: the procedure is written in `docs/verification/bf-two-device-drill.md`; execution with two physical devices and a real network partition is pending. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The fencing semantics extend ADR-0415 and ADR-0419 without changing their accepted decisions; any future unattended-venue runtime must re-derive its own control contract in a new ADR rather than loosening this one.
