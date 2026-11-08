# ADR-0331 — Least-privilege tool access, privacy, prompt injection and write consent

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Security. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0072, ADR-0111, ADR-0238, ADR-0253, ADR-0299; statuses and scope unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/routes/system.py`; `src/selecta/db.py`; `web/src/api.ts`.

## Context and source evidence boundary

File names, tags and lyrics are untrusted text; a model's claim that it has permission cannot authorise playback, drafts or destructive operations. A local browser shell still risks outbound data exposure via remote AI. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Use host-enforced read/propose/compute/save/change/play/destructive tiers; validate WeftAI operation annotations and allowlists; isolate each data home and conversation; sanitise content; minimise provider payloads and keep raw audio/paths local by default.

## UI/UX, interaction and truth contract

Requests for consequential writes display exact action/scope, privacy setting is inspectable, and denied permission leaves existing app untouched. No permission fatigue for read-only questions.

**Negative cases:** Malicious ID3 tag/lyrics, tool-result prompt injection, XSS markup, cross-home ref leak, fake user approval message, unsigned write retry, arbitrary file/network access, full lyrics upload, localhost origin exploit.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-331-01 — Threat model all untrusted inputs.** **Acceptance:** Metadata, lyrics, model responses, tool content and URLs classified as data. **Required verification:** Prompt injection scenario corpus. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-331-02 — Enforce host tool allowlists.** **Acceptance:** Model cannot use filesystem, delete original songs or invoke unsupported ops. **Required verification:** Forced function-call adversarial tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-331-03 — Gate write tiers.** **Acceptance:** Compute and write scopes require exact operation arguments and appropriate user consent. **Required verification:** No-approval and spoofed-approval tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-331-04 — Keep raw media private.** **Acceptance:** Paths, original audio, secrets and unrelated catalog excluded from provider requests. **Required verification:** Network capture and canary leak test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-331-05 — Scope results and identities.** **Acceptance:** Conversation, draft/current and home isolation held at operation execution. **Required verification:** Cross-home/cross-turn penetration tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-331-06 — Sanitize rendered messages.** **Acceptance:** Tool labels/Markdown cannot execute HTML/script or counterfeit UI actions. **Required verification:** XSS/rendering tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-331-07 — Provide auditable privacy settings.** **Acceptance:** User can inspect provider data classes, disable Lucy and clear appropriate records. **Required verification:** Privacy comprehension/accessibility review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-331-08 — Verify abuse and denial safety.** **Acceptance:** Rate limits, timeouts, prompt loops and denied operations cannot starve audio. **Required verification:** Resource/adversarial safety regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Proposed; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
