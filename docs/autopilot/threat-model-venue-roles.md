# Threat model: venue roles and devices (ADR-0435, AV-0435-01)

Scope: a SelectaDJ venue night with owner, manager, staff, guest and paired device roles, as
implemented in `src/selecta/venueops/roles.py` (flag `venue.roles`), the venue memory in
`venue_memory.py` and safe loudness in `safe_gain.py`. Method: STRIDE per asset. Status: draft
from source review; an independent security review is a person step.

## Assets

- Control of the night (steering, pause, emergency stop, manual takeover, policy).
- Device tokens for wall tablets and speakers.
- Guest data (per-night tokens, nicknames, request counts).
- Learned venue memory and the venue salt.
- The room's loudness (hearing safety and neighbours).

## Trust boundaries

1. Guest phone to the venue server (untrusted, anonymous).
2. Staff phones and paired devices to the venue server (authenticated by role or device token).
3. Venue server to speakers (fenced leases, ADR-0429).
4. Venue server to the cloud (out of scope here; see the Cloud ADRs).

## STRIDE

| Threat | Example | Mitigation in code | Remaining risk / person step |
|---|---|---|---|
| Spoofing | A guest sends a staff command | `authorize` checks the role table; a guest may only `request_song` | Role assignment itself (who is staff) needs the venue's sign-in; review it |
| Spoofing | A stolen tablet keeps steering | Device tokens are hashed; `revoke` is read by the very next `authorize` | Staff must notice the loss; device-fault runbook says revoke at once |
| Tampering | A device grants itself more commands | Grants are fixed at pairing and capped by the pairer's role; checked on every call | None known in code |
| Tampering | Guests flood votes to repaint the venue | One vote per guest token per subject per night; guest weight 0.3; per-night and total caps | A coordinated group with many phones still counts; caps bound the effect |
| Repudiation | Staff deny pressing emergency stop | Commands return the acting role for the audit log (`authz.audit`) | Wiring commands into the audit log is part of the staff command work |
| Information disclosure | Guest identities leak from memory | Raw ids are hashed with night and salt; the salt is not written to the memory file; `minimise_guest` keeps five fields | Nicknames are guest-chosen and could be real names; logs redact them (`health.redact`) |
| Information disclosure | Logs leak tokens, paths or titles | `health.redact` / `redact_text` on top of `authz.audit.scrub` | Every log call site must use it; check during review |
| Denial of service | A device spams skip_next | Each command is authorised; rate limits belong to the staff command layer | Rate limiting not built here |
| Denial of service | A revoked speaker keeps playing | Fenced leases refuse its commands (ADR-0429) | Hardware power-off remains the last resort |
| Elevation of privilege | Staff change policy or reset learning | Only owner and manager have `change_policy`, `reset_learning` | None known in code |
| Elevation of privilege | Any role turns on camera or microphone crowd sensing | `FORBIDDEN_FOR_ALL`: no role, not even the owner, has it | A future feature would need a new ADR |
| Safety | Autopilot makes the room suddenly louder | `SafeGain`: step, per-minute and ceiling caps, no rises during emergency stop or when the limiter is working hard | A real-room listening and level check is a person step |

## Person steps

- Independent security review of this model and of `roles.py`.
- Real-device test: pair a tablet, revoke it, confirm the next tap is refused.
- Real-room level check of the safe gain caps with a sound level meter.
