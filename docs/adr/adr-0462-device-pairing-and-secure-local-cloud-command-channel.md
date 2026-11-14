# ADR-0462 - Device pairing and secure local/cloud command channel

> **Controlling browser-first update — 2026-11-14:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes any mandatory Python/FFmpeg installer, native agent, separate venue computer, or guaranteed background/reboot browser playback in this historical decision. **Cloud runs DSP and plays locally in the supported browser** (including a venue's sole Android tablet or iPad; capable phones also render). Standalone Python Selecta remains independent. [Device/DSP feasibility](selecta-browser-device-capability-matrix.md) · [Full product/repository plan](selecta-browser-first-master-plan.md). Implementation status counts below are an older snapshot and do not certify browser parity; tests and real-device verification remain required.


- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0400, ADR-0401, ADR-0415, ADR-0445; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/playback/`, `src/selecta/identity/`, `web/src/devices/`, `web/src/kiosk/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

Cloud must address a player behind NAT without opening filesystem-capable HTTP services to the internet.

## Decision and invariants

1. Each **browser player** (desktop, phone, iPad, Android tablet) establishes an authenticated outbound HTTPS/WSS session; no native pairing agent or localhost server is necessary.
2. Cloud authorises actor/workspace/role/zone, target browser session, operation ID, generation, recipe revision, TTL and idempotency; browser independently enforces source availability, policy, local output and command scope.
3. Differentiate queued/delivered/accepted/applied/rejected/expired/uncertain. A command accepted by Cloud is **not** proof that the browser rendered sound.
4. Remote controllers cannot read source files or send filesystem paths. Lost/stolen tablets, tokens, duplicated tabs, stale sessions and browser termination require revocation and fencing.
5. Optional standalone/native engine adapters may share a versioned envelope where appropriate but are not mandatory Cloud dependencies.

## Edge cases and rejection semantics

Copied pairing token, revoked staff member, two accounts sharing laptop, network reconnect storm, clock skew, duplicate and stale commands.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Introduce outbound channel alongside old session API with a safe compatibility capability; retire old path after E2E. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Localhost adversarial tests, CSRF/DNS rebind, token revoke/rotate, replay and cross-workspace denial. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0462-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for device pairing and secure local/cloud command channel. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0462-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0462-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0462-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
