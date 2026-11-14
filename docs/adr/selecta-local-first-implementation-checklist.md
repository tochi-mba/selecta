# Selecta local-first cloud refactor implementation checklist (ADR-0455 to ADR-0485)

**Task status (recounted from the task lines by `src/selecta/audit/checklist_summary.py`):** 136 tasks: 0 Implemented, 0 In progress, 136 Not started, 0 Needs a person, 0 Superseded. 0 name a person-only step. 0 ticked. 0 independently Verified.

**Decision:** Browser-first Cloud and iPad/Android venue correction accepted 2026-11-14, [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md). **Implementation status:** This checklist is an audit of acceptance evidence, not a claim that PR #64 has no code. Existing Python local-first work does not prove *browser* capability; no browser-native device tests independently verified. **Baseline:** PR #64 `f6ed738af07f3532635c0135a6f4fe39c01d44a0`.

Tick only after *actual browser-mode* application changes, required tests, and independent verification evidence exist. The 120 earlier LF tasks are interpreted under ADR-0485 and must not be completed by an installed/native Cloud agent alone. There are **no deployed customers** to preserve legacy hosted-audio entitlements; preserve valid developer data, standalone parity and legal/operational safeguards. Add `Evidence:` with exact source SHA/test/CI link. Historic completed cloud work stays historically recorded even where its *future architecture* is superseded.

See [Browser/device research](selecta-browser-device-capability-matrix.md), [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md), [Roadmap](selecta-local-first-roadmap.md), [Source](selecta-local-first-source-map.md), [Parity](selecta-local-first-overlap-and-parity.md), [UX matrix](selecta-local-first-ui-state-matrix.md), [Release gates](selecta-local-first-release-gates.md).

## [ADR-0455 - Local-first cloud charter and preservation boundary](adr-0455-local-first-cloud-charter.md)

- [ ] **LF-0455-01 - Source and route inventory.** **Acceptance:** trace every existing capability and cloud media path to owning code and tests. **Required verification:** reviewed source map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0455-02 - Boundary-enforced contracts.** **Acceptance:** no production cloud upload, stream or media-render path remains; negative tests cover alternate encoding, logs and AI tools. **Required verification:** unit, integration and network egress tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0455-03 - Preservation ledger.** **Acceptance:** each existing user-facing capability is kept or has an approved equivalent, migration and evidence. **Required verification:** complete parity matrix. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0455-04 - Independent gate.** **Acceptance:** legal and product review, two-device proof, local regression suite and rollback drill signed off before cloud audio retirement. **Required verification:** release-gate evidence. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0456 - Runtime topology and device capability model](adr-0456-runtime-topology-and-device-capability-model.md)

- [ ] **LF-0456-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for runtime topology and device capability model. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0456-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0456-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0456-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0457 - Audio data classification and egress prohibitions](adr-0457-audio-data-classification-and-egress-prohibitions.md)

- [ ] **LF-0457-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for audio data classification and egress prohibitions. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0457-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0457-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0457-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0458 - Canonical recording identity and local media bindings](adr-0458-canonical-recording-identity-and-local-media-bindings.md)

- [ ] **LF-0458-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for canonical recording identity and local media bindings. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0458-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0458-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0458-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0459 - Portable mix recipes and missing-media reconciliation](adr-0459-portable-mix-recipes-and-missing-media-reconciliation.md)

- [ ] **LF-0459-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for portable mix recipes and missing-media reconciliation. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0459-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0459-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0459-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0460 - Immutable recipe revisions and render compatibility](adr-0460-immutable-recipe-revisions-and-render-compatibility.md)

- [ ] **LF-0460-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for immutable recipe revisions and render compatibility. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0460-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0460-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0460-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0461 - Local engine packaging, update and platform support](adr-0461-local-engine-packaging-update-and-platform-support.md)

- [ ] **LF-0461-01 - Define browser-first Cloud runtime contract, separate standalone Python. Research per-browser iPad/Android/desktop capabilities.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Reviewed capability matrix and no-install UX. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0461-02 - Implement actual browser playback/Web Audio runtime; no companion Python service, daemon or dedicated venue computer.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Clean device browser E2E and audible output. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0461-03 - Test iOS/Android/browser interruptions, battery/thermal, codecs, permissions, lost output, tab suspension and storage eviction.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Real-device Android and iPad browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0461-04 - Publish browser support profiles and independent venue sign-off; keep native standalone packaging separate.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Documented model/OS/browser results and release-gate sign-off. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0462 - Device pairing and secure local/cloud command channel](adr-0462-device-pairing-and-secure-local-cloud-command-channel.md)

- [ ] **LF-0462-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for device pairing and secure local/cloud command channel. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0462-02 - Implement browser session authentication, scoped remote commands, expiration, idempotency and fenced playback ACK.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Android/iPad player and remote phone E2E. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0462-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0462-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0463 - Device-local job scheduler and resource safety](adr-0463-device-local-job-scheduler-and-resource-safety.md)

- [ ] **LF-0463-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for device-local job scheduler and resource safety. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0463-02 - Port DSP/local workload scheduling to browser workers, WASM and AudioWorklet; enforce mobile budget.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Actual browser realtime callback and render tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0463-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0463-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0464 - Local artifact provenance, caches and exports](adr-0464-local-artifact-provenance-caches-and-exports.md)

- [ ] **LF-0464-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for local artifact provenance, caches and exports. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0464-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0464-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0464-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0465 - Local exports and offline data ownership](adr-0465-local-exports-and-offline-data-ownership.md)

- [ ] **LF-0465-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of local exports and offline data ownership. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0465-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0465-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0465-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0466 - Playback ownership, takeovers and network partitions](adr-0466-playback-ownership-takeovers-and-network-partitions.md)

- [ ] **LF-0466-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of playback ownership, takeovers and network partitions. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0466-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0466-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0466-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0467 - Offline-first venue execution and restart recovery](adr-0467-offline-first-venue-execution-and-restart-recovery.md)

- [ ] **LF-0467-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of offline-first venue execution and restart recovery. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0467-02 - Implement local file/browser DSP/speaker playback on a sole iPad or Android tablet venue, with offline while active.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Powered awake six-hour real tablet soak, no separate install. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0467-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0467-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0468 - Multi-zone local audio routing and device resource isolation](adr-0468-multi-zone-local-audio-routing-and-device-resource-isolation.md)

- [ ] **LF-0468-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of multi-zone local audio routing and device resource isolation. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0468-02 - Implement tested browser output routing, default one zone on tablets, safe explicit multi-zone only if supported.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Physical Android/iPad/desktop output routing tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0468-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0468-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0469 - Control-plane commands and offline synchronization protocol](adr-0469-control-plane-commands-and-offline-synchronization-protocol.md)

- [ ] **LF-0469-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of control-plane commands and offline synchronization protocol. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0469-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0469-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0469-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0470 - Personal plans without hosted audio and compute quotas](adr-0470-personal-plans-without-hosted-audio-and-compute-quotas.md)

- [ ] **LF-0470-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of personal plans without hosted audio and compute quotas. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0470-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0470-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0470-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0471 - Business billing, zones, seats and locally provisioned media](adr-0471-business-billing-zones-seats-and-locally-provisioned-media.md)

- [ ] **LF-0471-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of business billing, zones, seats and locally provisioned media. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0471-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0471-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0471-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0472 - Lucy cloud planning with device-local tool execution](adr-0472-lucy-cloud-planning-with-device-local-tool-execution.md)

- [ ] **LF-0472-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of lucy cloud planning with device-local tool execution. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0472-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0472-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0472-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0473 - Rooms and guest requests resolved against the speaker device](adr-0473-rooms-and-guest-requests-resolved-against-the-speaker-device.md)

- [ ] **LF-0473-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of rooms and guest requests resolved against the speaker device. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0473-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0473-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0473-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0474 - Venue catalogues, lawful local provisioning and rights](adr-0474-venue-catalogues-lawful-local-provisioning-and-rights.md)

- [ ] **LF-0474-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of venue catalogues, lawful local provisioning and rights. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0474-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0474-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0474-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0475 - Music and software licensing release gates](adr-0475-music-and-software-licensing-release-gates.md)

- [ ] **LF-0475-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0475-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0475-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0475-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0476 - Personal cloud UX and device-aware information architecture](adr-0476-personal-cloud-ux-and-device-aware-information-architecture.md)

- [ ] **LF-0476-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0476-02 - Replace Install Engine flow with browser file access, audio unlock, local DSP readiness and speaker tests.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** iPad/Android new-venue onboarding E2E. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0476-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0476-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0477 - Missing-media repair, Studio and transition editor UX](adr-0477-missing-media-repair-studio-and-transition-editor-ux.md)

- [ ] **LF-0477-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0477-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0477-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0477-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0478 - Business HQ, staff and kiosk UX migration](adr-0478-business-hq-staff-and-kiosk-ux-migration.md)

- [ ] **LF-0478-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0478-02 - Support full business playback on a sole iPad or Android tablet plus phone remote control.** **Acceptance:** validated browser-native Cloud behavior on applicable device classes and no mandatory Python/native install. **Required verification:** Real browser hardware business E2E. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0478-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0478-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0479 - Local agent fleet health and privacy-safe operations](adr-0479-local-agent-fleet-health-and-privacy-safe-operations.md)

- [ ] **LF-0479-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0479-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0479-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0479-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0480 - Cloud data migration and hosted-media sunset](adr-0480-cloud-data-migration-and-hosted-media-sunset.md)

- [ ] **LF-0480-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0480-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0480-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0480-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0481 - Hosted audio infrastructure and secrets retirement](adr-0481-hosted-audio-infrastructure-and-secrets-retirement.md)

- [ ] **LF-0481-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0481-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0481-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0481-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0482 - Local-first testing and release verification matrix](adr-0482-local-first-testing-and-release-verification-matrix.md)

- [ ] **LF-0482-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0482-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0482-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0482-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0483 - Feature flags, plan compatibility and rollout](adr-0483-feature-flags-plan-compatibility-and-rollout.md)

- [ ] **LF-0483-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0483-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0483-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0483-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0484 - Independent release gates, parity and go-no-go](adr-0484-independent-release-gates-parity-and-go-no-go.md)

- [ ] **LF-0484-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0484-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0484-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0484-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## [ADR-0485 - Browser-first Cloud and iPad/Android tablet venue runtime](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md)

**Controlling matrix:** [cross-device and DSP research](selecta-browser-device-capability-matrix.md). **All tasks Not started and not independently verified**; earlier native LF implementations are insufficient evidence.

- [ ] **LF-0485-01 - Browser audio runtime and architecture.** **Acceptance:** AudioWorklet real-time renderer, workers/WASM off audio thread, foreground lifecycle and no local API dependency. **Required verification:** Desktop Chrome/Safari/Firefox and actual Android/iPad browser audio E2E. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-02 - Cross-device capability probe.** **Acceptance:** Versioned per-browser OS/codec/output/source/worker/GPU/RAM/storage/foreground checks; no UA-only assumptions. **Required verification:** Capability harness, low-memory and unsupported states. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-03 - Browser decoder and import.** **Acceptance:** Local MP3/AAC/FLAC/WAV handling, unsupported codec and file permissions, never cloud bytes. **Required verification:** iPad Files, Android Files/SD/USB and desktop formats; no-audio network capture. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-04 - Core DSP parity.** **Acceptance:** WebAudio crossfade, EQ, filter, limiter, timing, seams and real speaker playback against Python references. **Required verification:** Synthetic golden audio render, audible listening, underruns on every device tier. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-05 - Beat/key/features portability.** **Acceptance:** Browser implementations with confidence and provenance; no claim PyTorch/Beat This already runs. **Required verification:** Offline reference error metrics and per-hardware performance. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-06 - Time stretch and advanced effects.** **Acceptance:** Pitch-preserving stretch, drift warp, timbre, reverb, loudness and CPU budget where supported. **Required verification:** DSP quality, overrun and parity tests, adaptive fallback. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-07 - Neural-model feasibility.** **Acceptance:** Beat This, neural key, Demucs/HTDemucs, wav2vec2 word alignment evaluated as separate opt-in browser models. **Required verification:** License, model conversion, operator/backend support, RAM/thermal and quality benchmarks. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-08 - Device-specific music import.** **Acceptance:** Browser-dependent file/folder picker/handle, reauth/relink and missing source; no Spotify/Apple DRM extraction. **Required verification:** Chrome Android, Samsung Internet, Firefox Android, Safari iOS 18.4+, desktop tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-09 - Quota-safe local caches/export.** **Acceptance:** OPFS/IndexedDB durability/eviction, atomic artifacts, local FLAC encoder and validated downloads. **Required verification:** Storage-pressure, eviction, interrupted export, checksum tests. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-10 - Android browsers and OEM lifecycle.** **Acceptance:** Chrome/Samsung Internet/Firefox/Edge differentiation, Doze, audio focus, notifications, screen lock, Samsung DeX, permission and vendor task killing. **Required verification:** Real Samsung/Pixel/Lenovo/budget Android device matrix. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-11 - iPad/iPhone Safari and PWA lifecycle.** **Acceptance:** Safari, Home Screen, screen-lock, silent output, wake lock, picker, AirPlay/BT/USB-C, user gesture. **Required verification:** Real A-series and M-series iPads/iPhones including sound check. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-12 - Venue audio/output hardware.** **Acceptance:** One-zone default tablets, BT/USB/HDMI/system outputs, Cast/AirPlay limitations, no silent route claims. **Required verification:** Physical speaker and disconnect tests across Android/iPad/desktop. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-13 - No-install tablet venue readiness.** **Acceptance:** Single iPad OR Android tablet imports files, taps Start, provides source/output/transition readiness and serves guests. **Required verification:** Six-hour powered awake venue soak each OS; no second computer. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-14 - Remote control and single ownership.** **Acceptance:** Phone-to-tablet control, fenced session takeover, expired commands, offline/suspended unknown state. **Required verification:** Two-browsers + phone integration, partitions and concurrency. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-15 - Truthful adaptive UX.** **Acceptance:** Features unsupported_here vs preparing vs ready; heavy DSP/stems available only on measured devices, responsive/a11y. **Required verification:** Real-user touch, TalkBack/VoiceOver, 320px, model fallback states. **Implementation:** Not started. **Independently Verified:** No.
- [ ] **LF-0485-16 - Independent cross-platform release/rights gate.** **Acceptance:** Legal, SaaS no-media egress, licensing, parity ledger, privacy, Android/iOS browser qualification and explicit unattended limitations. **Required verification:** Reviewed device benchmark artifacts, CI, sound proof, go/no-go. **Implementation:** Not started. **Independently Verified:** No.
