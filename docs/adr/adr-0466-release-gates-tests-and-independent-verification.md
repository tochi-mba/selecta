# ADR-0466 - Release gates, test strategy and independent verification

> Words: this record keeps the names of its time; [glossary.md](../glossary.md) says what each is called now (ADR-0479).

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 4/8 Implemented; 3/8 In progress; 1/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF6 (verification), running alongside every other phase. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** none changed. The verification conventions of earlier programmes (evidence ledgers, owner-delegated human checks recorded as such, never as Verified) apply unchanged. Sibling BF ADRs: all; ADR-0467 consumes these gates.
- **Source touchpoints:** `.github/workflows/test.yml` (python, cloud, web, browser, flags, cloud-e2e jobs); `tests/test_cloud_*.py` (148 files; the flag, playback, rooms, storage and jobs families); `tests/e2e_cloud_server.py`; `web/e2e-cloud/` (`flags.cloud.ts`, `playback.cloud.ts`, `storage.cloud.ts`, `apa-cloud-audio-owner.cloud.ts`); `web/playwright.flags.config.ts`; `docs/verification/` (evidence records).
- **Proposal chapter:** [docs/saas/18-test-plan.md](../saas/18-test-plan.md).

## Context and evidence boundary

The repo's testing machinery is strong where servers are concerned: 148 cloud test files sharded three ways in CI with Postgres and SeaweedFS, a per-account flag-refusal pattern already proven for `cloud.uploads` (`tests/test_cloud_flag_gate.py`), 403 `flag_off` asserted across 24 files, around 326 vitest files, and Playwright suites for local (about 140 specs), the every-flag-off sweep and cloud (headless Edge, muted, fake AuthKit, S3 and Stripe). What CI cannot do is exactly what this programme's claims hang on: audible output, six-hour tablet soaks, phone calls against a venue set, physical speaker routes and real network partitions. Muted headless Edge proves logic, never sound.

The abandoned branch's one keepable idea was its gate posture, restated here as this programme's law: the default verdict is NO-GO per gate until observed, reviewed evidence exists.

## Decision

- **Default NO-GO.** Every release-critical gate starts and stays NO-GO until its evidence is observed and reviewed. A passing synthetic suite never flips a hardware gate; a simulation, an accelerated timer or a mocked device never counts; an untested OS and browser tuple stays unknown and unclaimed. Release approvers cannot tick a box on inference.
- **The gates:**
  1. Existing CI fully green on the implementing branch (all jobs, no queued, skipped or cancelled check read as green).
  2. Browser engine truth: the ADR-0457 probe and ADR-0459 harness running real (unmocked) worklet DSP in Chromium, Firefox and WebKit CI engines with recorded numbers.
  3. No-install: a clean browser on a deployed HTTPS build reaches audible playback with no Python, FFmpeg or daemon anywhere.
  4. No audio egress: authenticated network capture over import, analysis, play, mix and export on a default account shows zero audio bytes leaving the device (BF-0457-07).
  5. Audible output: human-confirmed sound checks per reference device and route (ADR-0460), recorded.
  6. Tablet venue soaks: six powered, awake, foreground hours on a real iPad and a real Android tablet, with interruptions exercised (lock attempt, app switch, call, output loss) and recovery observed.
  7. Two-device truth: the ADR-0461 partition and takeover drill, and the ADR-0458 five-of-eight missing-media repair, on real hardware.
  8. Mobile render: short and one-hour-plus exports on a real phone with duration, integrity and peak metrics recorded.
  9. Accessibility: the recorded manual pass (BF-0463-06) plus automated checks.
  10. Security headers and isolation: CSP, COOP and COEP for worklets and WASM verified on the deployed build; migration safety (fresh and upgrade paths) proven in CI.
  11. Migration rehearsal: BF-0465-06 recorded.
- **Evidence format.** Each hardware gate produces a per-physical-device record in `docs/verification/`: device model, OS and browser build, RAM and chipset, engine version, source and codec, output route, dates, hours, who observed, and what was seen. Owner-delegated human checks are recorded as owner-delegated, never as independently Verified; independent verification means someone other than the implementer reproduced the result.
- **Test-suite obligations for implementers.** New per-account gating copies the `test_cloud_flag_gate.py` pattern; every new flag joins `flags.cloud.ts` and the local sweep; job re-pointing extends `test_cloud_jobs_flag_gates.py`; the playback and rooms families grow device-owned-source cases; hosted paths keep their suites green as flag-ON tests; a new browser-local playback Playwright spec covers the runtime end to end. CI remains the merge bar; the gates above are the release bar, and the two are never confused.

## User outcome and acceptance contract

Nothing is promised to members that a person has not seen a real device do. When SelectaDJ says a tablet can run the night, somewhere there is a dated record of that tablet model doing six hours with someone listening. When it says music never leaves the device, there is a capture proving it.

## Edge cases

- **A gate's evidence ages.** A browser major release or OS update invalidates affected tuples back to unknown; the record carries versions precisely so staleness is detectable; re-verification scope is judged per change in the ADR-0467 governance loop.
- **Flaky hardware runs.** A failed soak is a finding, not a retry-until-green: the record keeps the failure and the follow-up both.
- **Partial matrices.** Shipping with gaps is allowed only as explicit unsupported or unknown states in the capability record, never by widening a claim.
- **CI muted audio.** Audio-element and worklet logic tests run muted by necessity; no muted test may assert audibility (lint-level guard on the word in assertions).
- **Evidence for devices the project does not own.** Tuples stay unknown until hardware exists; community or remote evidence needs the same record fields and an identified observer.

## Rejected alternatives

- **Representative-device inference** (testing one iPad and claiming iPads): model, RAM and OS variance is the whole reason for per-tuple records.
- **Synthetic soak acceleration.** Compressing six hours into simulated time measures nothing thermal or OS-lifecycle real; rejected.
- **Treating CI green as release-ready.** CI cannot hear; the two-bar structure exists precisely for that gap.
- **A standing hardware lab requirement before any work.** Gates demand evidence when claims ship, not laboratories up front; the checklist sequences hardware needs late and explicitly.

## Implementation checklist - 4/8 Implemented; 3/8 In progress; 1/8 Not started; 0/8 independently Verified

1. **BF-0466-01 - Gate register.** **Acceptance:** The gates above exist as a live register (doc or page) with per-gate status, evidence links and NO-GO defaults; ADR-0467's rollout steps reference it mechanically. **Required verification:** Doc review; the register's status matches evidence on spot check. **Implementation:** Implemented in `docs/verification/bf-gate-register.md`; every row remains honestly NO-GO. **Independently Verified:** No.
2. **BF-0466-02 - Evidence record template.** **Acceptance:** The per-device record template with all required fields ships in `docs/verification/` with one worked example from a real run. **Required verification:** The worked example. **Implementation:** In progress: `docs/verification/bf-evidence-record-template.md` contains every required field, but a real worked example cannot exist until a person performs the first device run. Needs a person: one real device run. **Independently Verified:** No.
3. **BF-0466-03 - Engine-truth CI harness.** **Acceptance:** Gate 2 runs in CI on all three engines with real worklet execution and recorded numbers, failing on mocks (a tripwire asserts the worklet actually processed). **Required verification:** CI runs with artifacts. **Implementation:** In progress: `web/e2e-cloud/engine-truth.cloud.ts`, `web/playwright.engine-truth.config.ts`, the `e2e:engine-truth` script and the three-engine CI step provide an unmocked AudioWorklet tripwire and artifacts. The application probe itself is not yet the subject of that three-engine spec, and no green CI artifact exists, so this is not complete. **Independently Verified:** No.
4. **BF-0466-04 - Egress capture procedure.** **Acceptance:** Gate 4's capture is scripted and repeatable (tooling, account seeding, pass criteria), producing an archived artifact per run. **Required verification:** Two independent runs agreeing. **Implementation:** Implemented by `tools/bf_egress_capture.py` and `tests/test_bf_no_audio_egress.py`; two independent captures are still required before the gate moves. **Independently Verified:** No.
5. **BF-0466-05 - Soak and drill protocols.** **Acceptance:** Written minute-by-minute protocols for gates 6 and 7 (what to do, what to observe, what to record), consistent with the ADR-0460 qualification programmes. **Required verification:** Doc review, then first execution. **Implementation:** Implemented in `docs/verification/bf-soak-protocol-ipados.md`, `bf-soak-protocol-android.md` and `bf-two-device-drill.md`. Needs a person: hardware in hand for execution. **Independently Verified:** No.
6. **BF-0466-06 - Suite extensions landed.** **Acceptance:** The implementer obligations above are tracked per implementing PR and the named suites show the new cases (gating, jobs, playback, rooms, sweep, browser-local spec). **Required verification:** CI plus review against the list. **Implementation:** In progress on PR #96: BF gating, no-egress, local-media, flip-guard and browser-engine cases exist; the full named-suite cross-check and green CI run are not yet evidence. **Independently Verified:** No.
7. **BF-0466-07 - Staleness policy.** **Acceptance:** The version-invalidation rule (which changes re-open which gates) is written and wired to the register so a browser major bump visibly degrades affected tuples. **Required verification:** Doc review plus one simulated bump. **Implementation:** Implemented in the gate register's staleness and degraded-tuples sections; a simulated bump remains required verification. **Independently Verified:** No.
8. **BF-0466-08 - Independent verification pass.** **Acceptance:** Someone other than the implementer reproduces gates 2, 3, 4 and 11 and signs the records; remaining hardware gates have named owners and dates. **Required verification:** Signed records. **Implementation:** Not started. Needs a person: an independent verifier. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The NO-GO default is not ceremony: it is the mechanism that keeps this programme's public claims inside its evidence, and no later convenience overrides it without the owner rewriting this ADR.
