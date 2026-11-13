# ADR-0457 - Audio data classification and egress prohibitions

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0397, ADR-0398, ADR-0399, ADR-0404, ADR-0412; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/storage/`, `src/selecta/workers/`, `src/selecta/ai/`, `web/src/cloud/`, `infra/r2/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

Moving DSP locally is insufficient if an upload, proxy, diagnostic, analytics or LLM path can still transfer user audio.

## Decision and invariants

1. Classify originals, PCM, audio clips, stems, exports, reconstrucible waveforms, full lyrics and raw media paths as forbidden cloud payloads; local-only fingerprints and large feature arrays by default.
2. Permit minimal tenant-scoped recipe metadata, optional title/artist, bounded summary features, device availability, schedules and play logs only under documented privacy purposes.
3. Enforce allowlisted typed schemas, bounded payloads, media-route denylist, provenance and outbound telemetry scrubbing; MIME filters alone do not prove no-audio transfer.
4. Production cloud must have no audio-capable storage bucket, signed media URL, hosted decoder/render handler, or arbitrary AI-tool attachment path.

## Edge cases and rejection semantics

Audio bytes disguised as JSON/base64, debug logs containing samples/paths, crash dumps, multipart legacy routes, anonymous guest requests.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Keep an explicit temporary retirement data ledger for pre-existing hosted media; never claim that legacy copies vanish just by disabling new uploads. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Negative API fuzzing, egress capture, dependency scanning, log scrubbing, infrastructure and backup audits. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0457-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for audio data classification and egress prohibitions. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0457-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0457-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0457-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
