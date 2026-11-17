# ADR-0459 - Browser DSP tiers and musical parity honesty

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 0/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF2 (musical core). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0418 (cloud intelligent mixing parity): superseded in part for default (local-first) accounts by this ADR; intact for hosted-flag accounts. The standalone engine ADRs (0006, 0007, 0069, 0093, 0140, 0373) are unchanged and remain the musical reference. Sibling BF ADRs: ADR-0457, ADR-0460, ADR-0466.
- **Source touchpoints:** new `web/src/dsp/` (core, analysis, transitions, workers); reference implementations `src/selecta/analysis/beats.py`, `src/selecta/analysis/key.py`, `src/selecta/analysis/features.py`, `src/selecta/render/dsp.py`, `src/selecta/render/engine.py`, `src/selecta/render/script.py`, `src/selecta/seams.py` (all unchanged, read as the golden reference); `src/selecta/flags/cloud.json` (new `cloud.browser_dsp`).
- **Proposal chapter:** [docs/research.md](../research.md) and the engine chapters of [docs/saas/10-audio-engine-in-cloud.md](../saas/10-audio-engine-in-cloud.md).

## Context and evidence boundary

The real engine is Python: Beat This and PyTorch for beats, a neural checkpoint for key, librosa/SciPy feature extraction, pedalboard time-stretch, Demucs stems, FFmpeg decode, and the seam renderer. None of that runs in a browser because the UI is React; `torch`, `demucs`, `librosa` and `pedalboard` have no magic Safari builds. What is honestly portable, per the 2026-11-14 research: Web Audio graphs with AudioWorklet everywhere that matters; JS/WASM FFT, mel, MFCC, chroma and segmentation; loudness, true peak and limiting as ports with golden tests; scripted transitions as ahead-of-time windows. What is conditionally portable: neural beat and key models, high-quality time-stretch, stem separation and word alignment, each needing model conversion, per-device memory/thermal/runtime evidence and licence checks.

No browser DSP exists on `main`. Every parity claim below is defined by measurements that have not been run.

## Decision

- **Three tiers, flag `cloud.browser_dsp` beyond baseline.**
  - **Tier 1 - baseline, every qualified player:** decode, two-deck playback, crossfade, EQ and filters, loudness/true-peak limiter, prepared fades. This is what "can play" means; a device that cannot do Tier 1 is a controller (ADR-0460).
  - **Tier 2 - measured devices:** lightweight beat/onset/tempo and key estimates, scripted beatmatched seams in bounded ahead-of-time windows, bounded pitch-preserving time-stretch, reverb/echo/energy effects within a CPU budget, seam preparation in workers with a short prepared horizon.
  - **Tier 3 - per-device benchmark plus model licence:** neural beat tracking, neural key, stem separation, word-level lyric alignment and the features built on them (stem intertwining, word cuts). Each Tier 3 feature needs recorded per-device memory, thermal and runtime evidence and a licence check before it can switch on anywhere.
- **Honesty rules.**
  - A lighter method is a *different verified implementation or an explicit reduced capability*, never silently "the same feature". The interface and the capability record both say which implementation produced a result.
  - `unsupported_here` is a first-class state with a reason, not an error.
  - Confidence is carried with every analysis result; a low-confidence beat grid refuses beatmatched seams rather than cutting badly.
  - No cloud compute quietly fills a device gap for default accounts (restates BF-0455-04).
- **Parity is measured, not asserted.** The Python engine renders a golden set from synthetic owned audio: beat grids, keys, LUFS, true peak, seam timings and rendered seams. The browser engine renders the same set; the comparison harness scores them, and listening tests on supported desktop and tablet close the loop. The owner's listening judgement stays the final musical gate, as everywhere in this project.

## User outcome and acceptance contract

On a capable device a member gets mixes that sound like SelectaDJ: beatmatched where the analysis is confident, graceful fades where it is not, loudness-safe always. On a weaker device they get fewer tricks, told plainly, never a worse-sounding imitation of a trick the device cannot afford. Nothing ever claims to be the neural engine's output when it is the lightweight estimate.

## Edge cases

- **Confident-looking nonsense.** A lightweight tempo estimate that is exactly double or half the truth: the seam scripter treats half/double-time ambiguity as low confidence and falls back to fades (the known steady-beat cases from the request-chain work).
- **Thermal collapse mid-set.** Benchmark-calibrated budgets shrink the prepared horizon and effect count before the callback starves; the member sees the simplified state, audio never glitches as the first symptom.
- **A Tier 3 model downloaded mid-set.** Model loading never competes with the audio callback; activation waits for a seam boundary.
- **Imported analysis cache from another device.** Results carry the implementation and version that produced them; a device never serves another tier's cached result as its own capability.
- **Format oddities.** Variable bitrate, odd sample rates, mono files: resample and channel-map through tested paths; golden set includes them.
- **Licence refusal.** A Tier 3 model whose licence fails review simply never ships to browsers; the feature stays `unsupported_here` everywhere rather than shipping unlicensed.

## Rejected alternatives

- **Porting the Python stack wholesale to WASM.** PyTorch, librosa and pedalboard are not browser libraries; pretending otherwise produced the abandoned branch's false readiness. Ports are per-algorithm with golden tests.
- **Server-side analysis for default accounts.** Breaks the no-audio contract; rejected.
- **One quality bar for all devices.** Forcing Tier 1-only everywhere wastes capable desktops; forcing Tier 2 everywhere lies on budget phones. Tiers with honest labels are the design.
- **Calling browser output "the same mix" as native.** Until the harness and listening tests say so for a given tier and device class, it is not claimed.

## Implementation checklist - 0/8 Not started; 0/8 independently Verified

1. **BF-0459-01 - Tier contract and flag.** **Acceptance:** The tier model is encoded (capability record per feature: tier, implementation id, version, confidence semantics, `unsupported_here` reasons); `cloud.browser_dsp` registered; `docs/flags.md` regenerated. **Required verification:** Unit tests on the capability record. **Implementation:** Not started. **Independently Verified:** No.
2. **BF-0459-02 - Tier 1 engine.** **Acceptance:** Decode, two-deck crossfade, EQ/filters, loudness/true-peak limiter and prepared fades run in the ADR-0457 runtime with golden LUFS/peak/clip tests against the Python reference. **Required verification:** CI harness on three browser engines with recorded numbers. **Implementation:** Not started. **Independently Verified:** No.
3. **BF-0459-03 - Lightweight analysis.** **Acceptance:** JS/WASM onset/tempo/key/feature estimates with confidence, versioned schema, half/double-time ambiguity treated as low confidence; accuracy vs the golden set recorded, not asserted. **Required verification:** Harness scores checked into evidence. **Implementation:** Not started. **Independently Verified:** No.
4. **BF-0459-04 - Scripted seams.** **Acceptance:** The seam script semantics port for bounded ahead-of-time windows; low confidence falls back to fades; seam timing parity vs reference within the recorded tolerance; `leave_after` (30 s settle rule) honoured. **Required verification:** Golden seam renders plus the owner's listening pass. **Implementation:** Not started. Needs a person: the owner listens. **Independently Verified:** No.
5. **BF-0459-05 - Bounded time-stretch.** **Acceptance:** Pitch-preserving stretch within ratio and window limits via WASM DSP; naive playbackRate pitch shifts are never used for musical stretch; quality acceptance from listening plus transient-smearing measurements. **Required verification:** Harness plus listening pass. **Implementation:** Not started. Needs a person: the owner listens. **Independently Verified:** No.
6. **BF-0459-06 - Worker scheduling and horizon.** **Acceptance:** Analysis and seam preparation run in workers under a benchmark-calibrated budget that never steals callback time; the prepared horizon degrades before audio does; deadline misses are counted and surfaced. **Required verification:** Scheduling tests with synthetic load, device-lab soak numbers. **Implementation:** Not started. **Independently Verified:** No.
7. **BF-0459-07 - Tier 3 evaluation protocol.** **Acceptance:** A written per-model protocol (conversion route, memory/thermal/runtime measurements per device class, licence review, quality comparison) that any Tier 3 candidate must pass; no Tier 3 feature ships before its protocol record exists. **Required verification:** Doc review plus the first completed record. **Implementation:** Not started. **Independently Verified:** No.
8. **BF-0459-08 - Honest labelling sweep.** **Acceptance:** Every surface that shows analysis or mixing results names the implementation tier where it differs from native; no copy anywhere claims native parity for an estimate; a copy audit test enforces the banned claims list. **Required verification:** Vitest copy audit, manual review. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The owner's listening judgement is the final gate on any claim that a browser seam or stretch "sounds right" (BF-0459-04, BF-0459-05); automated parity numbers alone never flip those tasks.
