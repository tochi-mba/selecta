# Browser-first Cloud release-gate register (BF-0466-01)

The live register for the eleven release-critical gates of
[ADR-0466](../adr/adr-0466-release-gates-tests-and-independent-verification.md). The
[ADR-0467 step ledger](bf-step-ledger.md) references this register mechanically: a rollout step
may not advance while a gate it depends on is not GO, and the `cloud.local_first` flip guard
(`src/selecta/flags/flip_guard.py`) takes its `gates_green` answer from this register.

## The law of this register

- **Default NO-GO.** Every gate starts NO-GO and stays NO-GO until observed, reviewed evidence
  exists. Nobody ticks a box on inference, and no deadline lowers a gate.
- **Synthetic passes never flip hardware gates.** A green CI suite, a simulation, an accelerated
  timer or a mocked device never changes a row that needs hardware or a human observer. CI is the
  merge bar; this register is the release bar; the two are never confused.
- **Unknown stays unknown.** An OS and browser tuple without a recorded result is unknown, never
  claimed. Shipping with gaps is allowed only as explicit unsupported or unknown states in the
  capability record, never by widening a claim.
- **Evidence is a record, not a memory.** Each hardware gate links a per-physical-device record in
  this folder, written from the [evidence record template](bf-evidence-record-template.md).
  Owner-delegated human checks are recorded as owner-delegated, never as independently Verified.
  Independent verification means someone other than the implementer reproduced the result.
- **A failed run is a finding, not a retry.** The record keeps the failure and the follow-up both.

## Staleness rule (BF-0466-07)

Evidence ages. A browser major release or an OS update returns every affected tuple to
**unknown**: the gate row that depended on those tuples degrades back to NO-GO for the affected
tuples, and the register says which. This is why every evidence record carries exact versions
(OS build, browser engine and version, SelectaDJ engine version): staleness must be detectable by
comparing versions, never argued from impressions. The scope of re-verification after a given
bump (full re-run, or a targeted subset) is judged per change in the ADR-0467 governance loop and
recorded next to the degraded rows. A SelectaDJ engine change that touches the audio path reopens
gates 2, 5, 6, 7 and 8 for re-judgement the same way.

## How a row changes

1. Run the written procedure for the gate (linked per row) and produce the evidence artifact or
   record.
2. Someone other than the implementer reviews it (for gates 2, 3, 4 and 11, reproduces it).
3. Change the row in one commit that links the evidence, names the reviewer, and dates the change.
   A row never changes in the same PR that implements the thing it gates.

## The gates

| # | Gate | Required evidence | Current result | Evidence |
|---|------|-------------------|----------------|----------|
| 1 | Existing CI fully green on the implementing branch (all jobs; no queued, skipped or cancelled check read as green) | The branch's full CI run, every job green, linked by run id | NO-GO - no evidence | none |
| 2 | Browser engine truth: the ADR-0457 probe and ADR-0459 harness running real (unmocked) worklet DSP in Chromium, Firefox and WebKit CI engines with recorded numbers | CI runs in all three engines with artifacts recording sample rate, scheduling misses and the anti-mock process counter (`web/e2e-cloud/engine-truth.cloud.ts` is the harness seed; it must run on all three engines, not only the cloud suite's Edge) | NO-GO - no evidence | none |
| 3 | No-install: a clean browser on a deployed HTTPS build reaches playback with no Python, FFmpeg or daemon anywhere | A recorded walkthrough on a clean machine or profile against the deployed build, per the evidence record template | NO-GO - no evidence | none |
| 4 | No audio egress: authenticated network capture over import, analysis, play, mix and export on a default account shows zero audio bytes leaving the device (BF-0457-07) | Two independent runs of the scripted capture (`tools/bf_egress_capture.py`) agreeing, each archiving its JSONL request log and pass artifact | NO-GO - no evidence | none |
| 5 | Audible output: human-confirmed sound checks per reference device and route (ADR-0460), recorded | One evidence record per device and output route, with a named human observer confirming the check tone | NO-GO - no evidence | none |
| 6 | Tablet venue soaks: six powered, awake, foreground hours on a real iPad and a real Android tablet, with interruptions exercised and recovery observed | Completed runs of the [iPadOS soak protocol](bf-soak-protocol-ipados.md) and the [Android soak protocol](bf-soak-protocol-android.md), one evidence record per device | NO-GO - no evidence | none |
| 7 | Two-device truth: the ADR-0461 partition and takeover drill, and the ADR-0458 five-of-eight missing-media repair, on real hardware | A completed run of the [two-device drill](bf-two-device-drill.md), one evidence record per device pair | NO-GO - no evidence | none |
| 8 | Mobile render: short and one-hour-plus exports on a real phone with duration, integrity and peak metrics recorded | Evidence records with the export durations, checksums, duration validation and peak metrics per device | NO-GO - no evidence | none |
| 9 | Accessibility: the recorded manual pass (BF-0463-06) plus automated checks | The manual pass record plus the automated run's artifact | NO-GO - no evidence | none |
| 10 | Security headers and isolation: CSP, COOP and COEP for worklets and WASM verified on the deployed build; migration safety (fresh and upgrade paths) proven in CI | Header capture from the deployed build plus the CI migration runs, linked | NO-GO - no evidence | none |
| 11 | Migration rehearsal: BF-0465-06 recorded | The recorded real-account export, re-import and reconciliation rehearsal, hosted library proven untouched | NO-GO - no evidence | none |

## Degraded tuples

None recorded. When the staleness rule fires, list here: tuple, what bumped, which gates reopened,
re-verification scope decided, date.
