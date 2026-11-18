# Tier 3 model evaluation protocol (BF-0459-07)

The per-model protocol every Tier 3 candidate in
[ADR-0459](../adr/adr-0459-browser-dsp-tiers-and-musical-parity-honesty.md) must pass before any
feature built on it switches on anywhere: neural beat tracking, neural key, stem separation,
word-level lyric alignment, and the features that depend on them (stem intertwining, word cuts).

The rule this protocol enforces: **no Tier 3 feature ships before its protocol record exists and
every section of that record says PASS.** A record with any section FAIL or unknown keeps the
feature `unsupported_here` everywhere (ADR-0459 honesty rules), whatever percentage or plan the
flags would otherwise allow.

No candidate has been evaluated yet, so no record exists. This document is the protocol and the
record template; the first completed record is the task's required verification.

## Who does what

| Step | Machine-doable | Needs a person |
|------|----------------|----------------|
| 1. Licence review | Gathering the licence texts and model card | The owner's (or counsel's) written licence decision |
| 2. Conversion route | Running the conversion and the numeric equivalence check | Nothing, unless the route needs a paid tool |
| 3. Device measurements | The benchmark page and its log | Holding each physical device, running the soak, reading thermals |
| 4. Quality comparison | Scoring against the Python reference on the golden set | The owner's listening pass, the final musical gate |
| 5. Decision | Assembling the record | The owner signs the record |

Steps run in this order. A licence FAIL stops the evaluation: nothing unlicensed is converted,
benchmarked or shipped.

## 1. Licence review

For the model weights, the inference runtime, and any conversion tool whose output ships:

- Licence name and version, link to the exact text, and the commit or release the weights came
  from.
- Commercial use in a paid SaaS product: permitted, forbidden, or conditional (state the
  condition).
- Redistribution of the weights to members' browsers (the model is downloaded to the device, so
  this is redistribution): permitted or not.
- Attribution, notice or share-alike obligations, and where SelectaDJ would satisfy them.
- Training-data restrictions stated by the model card (for example research-only datasets).
- Verdict: PASS only when commercial use and browser redistribution are both permitted and every
  obligation has a named place where it is met. Anything ambiguous is FAIL until resolved in
  writing.

## 2. Conversion route

- Source format and the exact source checkpoint (hash).
- Target runtime (for example ONNX Runtime Web with WebGPU or WASM, TensorFlow.js, a hand-written
  WASM port), its version, and the conversion commands, scripted and committed.
- Quantisation applied (none, fp16, int8), and why.
- Converted artefact size (download bytes, compressed and uncompressed) and its hash.
- Numeric equivalence: the converted model run on the golden set against the source model in
  Python, reporting the maximum and mean absolute difference of raw outputs and of the derived
  musical result (beat positions in ms, key label, stem SDR, word boundary times in ms).
  Tolerances are written down **before** the run; PASS only within them.
- Runtime fallbacks: what happens on a browser without the preferred backend (fall back to a
  slower backend with its own measurements, or `unsupported_here` with a reason).

## 3. Device measurements, per device class

For every device class the feature would be enabled on (at least: desktop Chromium, desktop
Safari, iPadOS Safari, Android Chrome tablet; plus every class in the
[gate register](bf-gate-register.md) the feature claims), run the benchmark on at least one real
physical device and record it with the
[evidence record template](bf-evidence-record-template.md) device tuple. Per device:

- **Memory:** peak JS heap and peak total tab memory during load and during inference on the
  longest golden-set track; whether the OS killed or reloaded the tab.
- **Runtime:** model load time (cold and warm cache), inference time per track minute (median and
  p95 over at least 10 runs), and its effect on the audio callback: zero audio dropouts and zero
  deadline misses counted by the worker budget (`web/src/dsp/budget.ts`) while a two-deck mix
  plays during inference.
- **Thermal:** a 30-minute soak running inference back to back while a mix plays, recording
  device temperature or the platform's thermal state at start, 10, 20 and 30 minutes, and
  inference time at the same points. PASS needs inference time at 30 minutes within 1.5x of the
  start and no audio dropout; a device that throttles below that is FAIL for this class.
- **Battery** (portable classes only): percentage drop over the soak.
- **Budget fit:** whether the inference fits the benchmark-calibrated budget without shrinking
  the prepared horizon below its floor.

A device class with no physical run is FAIL for that class: the feature stays `unsupported_here`
there. Results from one class never stand in for another.

## 4. Quality comparison

- **Golden set:** the synthetic, owned audio golden set (`tools/bf_golden.py`) plus the format
  oddities ADR-0459 names (variable bitrate, odd sample rates, mono).
- **Reference:** the Python engine's output for the same feature on the same files.
- **Scores**, with thresholds written before the run:
  - beat tracking: F-measure at 70 ms against the reference grid, and the share of tracks with
    half or double tempo errors;
  - key: exact-match and fifth/relative-tolerant accuracy against the reference;
  - stems: SDR per stem against the reference separation;
  - word alignment: median and p95 absolute boundary error in ms against the reference.
- **Confidence semantics:** the converted model's confidence must refuse as the reference does
  (low confidence leads to a fade, never a bad cut); count cases where the browser model is
  confident and wrong.
- **Listening:** the owner listens to mixes built on the browser output beside the same mixes
  built on the reference, blind where practical, and records a verdict. This is the final gate,
  as everywhere in this project.

## 5. Decision

The record ends with one line per device class: ENABLED or `unsupported_here` (with the reason),
the capability record values the browser will report (tier 3, implementation id, version), and the
owner's signature and date. Only device classes marked ENABLED may switch the feature on, and only
behind `cloud.browser_dsp`.

## Record template

Save each record as `docs/verification/bf-tier3-<model-slug>-<yyyy-mm-dd>.md`. Write "unknown"
for anything not measured; an unknown keeps that section at FAIL.

```markdown
# Tier 3 evaluation record: <model name> for <feature>

- **Protocol:** docs/verification/bf-tier3-evaluation-protocol.md at <commit>
- **Candidate:** <model, source repository, checkpoint hash>
- **Feature(s) it would enable:** <e.g. neural beat tracking, word cuts>

## 1. Licence - PASS / FAIL
- Weights licence: <name, link, version>
- Runtime licence: <name, link>
- Commercial SaaS use: <permitted / forbidden / conditional: ...>
- Browser redistribution: <permitted / forbidden>
- Obligations and where met: <...>
- Decision by: <owner or counsel, date, link to the written decision>

## 2. Conversion - PASS / FAIL
- Route and runtime version: <...>
- Commands: <link to the committed script>
- Quantisation: <...>
- Artefact: <bytes compressed / uncompressed, hash>
- Tolerances set before the run: <...>
- Equivalence results: <max / mean abs difference; derived musical differences>

## 3. Device measurements - PASS / FAIL per class
| Device class | Evidence record | Peak memory | Load (cold/warm) | Inference per minute (p50/p95) | Dropouts | 30-min thermal | Battery | Verdict |
|---|---|---|---|---|---|---|---|---|
| <class> | <link> | <MB> | <s / s> | <s / s> | <count> | <start to end> | <%> | PASS / FAIL |

## 4. Quality - PASS / FAIL
- Thresholds set before the run: <...>
- Scores against the reference: <...>
- Confident-and-wrong cases: <count, list>
- Owner's listening verdict: <verdict, date>

## 5. Decision
| Device class | ENABLED / unsupported_here (reason) |
|---|---|
| <class> | <...> |

Capability record values: tier 3, implementation id <...>, version <...>.
Signed: <owner>, <date>.
```
