# The device studio: what a browser can really do (2026-11-25)

SelectaDJ Cloud can play music that stays on the member's device. Today that path is a light
live mixer. This note records why it sounds worse than the Desktop engine, what browsers can run
in late 2026, and what that allows. Sources are tagged [S] primary or measured, [A] project page
or vendor, and (summary) where only a search summary was read.

## 1. Why it sounds worse today

Read from the code at `main` (f5b6a4ab):

| Cause | Where | Effect |
|---|---|---|
| Each seam is planned from a 60 s tail and a 60 s head, just before it is needed | `web/src/dsp/seamProvider.ts` | No downbeats, sections, energy, key or vocals in planning |
| Bars are every 4th beat from the first detected beat; phrases every 32nd | `web/src/dsp/seamScript.ts` | Bar and phrase lines are arbitrary against the music |
| Exits sit at the end of the song, entries at second 0 | `seamScript.ts` `phraseExit`, `entryWanted` | Every song plays to its end and the next starts on its intro |
| Planning starts 45 s before a song ends | `web/src/engine/scheduler.ts` `LOAD_NEXT_WITHIN` | A 16-bar blend at 120 BPM must start 50 to 34 s before the end, so many are "prepared too late" and become a 3 s fade |
| A few missed worker deadlines end beatmatching for the visit | `web/src/dsp/budget.ts` | One slow moment costs the whole session |
| No per-song loudness gain | `web/src/engine/scheduler.ts`, `graph.ts` | Songs jump in level; Desktop plays every song at -14 LUFS |
| Song order is alphabetical between a chosen start and end | `web/src/cloud/localFirstMixes.ts` | No pairing by tempo, key, energy or timbre |
| The offline export plays no seams | `web/src/engine/render.ts` | An exported file would not match what was heard |
| Stems can never switch on | `dsp/stems/model.ts` (`STEM_MODEL_ARTEFACT = null`), `localFirstPlayer.ts` | No vocal ride, strip and land, or studio |

None of these is a limit of the browser. They come from deciding late, with little knowledge.

## 2. What runs in a browser now

### Beats and downbeats: the same model Desktop uses

- Beat This is the Desktop and worker beat tracker (`analysis/beats.py`, checkpoint `small0`).
  A TypeScript port runs it in the browser through ONNX Runtime Web, with pre and post
  processing, a streaming reader for long files, WebGPU by default and WASM as the alternative
  ([jgorset/beat-this](https://github.com/jgorset/beat-this)) [A, page read]. It ships the 83 MB
  `final0` export; community exports of `small0` are about 10 MB
  ([songbird-models](https://huggingface.co/ashudesai/songbird-models)) [A, summary].
- Code and published weights are MIT, per the project and its ports. The licence register
  already marks both checkpoints allowed (`modes/model_allowlist.json`).
- One WebGPU export of the large model ran about 12 times slower on WASM than on WebGPU
  ([musetric](https://huggingface.co/musetric/beat-this-onnx)) [A, summary]. No timing for
  `small0` on WASM was found; it must be measured on a laptop and a tablet.

### WebGPU and ONNX Runtime Web

WebGPU ships in Chrome and Edge, in Safari 26 on macOS, iOS and iPadOS, and in Firefox 141 on
Windows ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers)) [S]. ONNX Runtime
Web still calls its WebGPU backend experimental and lists unsupported operators
([npm](https://www.npmjs.com/package/onnxruntime-web)) [S]. Multi-threaded WASM needs
SharedArrayBuffer and so cross-origin isolation; Safari has not shipped `credentialless`, so a
signed-in app that embeds third-party sign-in should not depend on threads [A, summary].

### Stems

- HTDemucs runs in browsers through ONNX Runtime Web; one build reports about 3 times real time
  on WebGPU, and one model card warns that full fp16 damages drums and bass
  ([demucs-web](https://github.com/timcsy/demucs-web),
  [htdemucs-web-onnx](https://huggingface.co/monteslu/htdemucs-web-onnx)) [A, summary].
- Its weights are the problem, not its speed. The code is MIT, but the author has said the
  pretrained weights were provided for scientific purposes, and the training data includes
  MUSDB18, most of which forbids commercial use
  ([AudioShake](https://audioshake.ai/post/can-demucs-be-used-commercially-musdb18-model-weights-licensing)) [A, a vendor with an interest, summary].
- Spleeter's code and pretrained models are distributed under MIT, and it was trained on
  Deezer's own catalogue ([JOSS paper](https://joss.theoj.org/papers/10.21105/joss.02154.pdf)) [S, summary].
  One conversion page notes an unanswered question on Deezer's tracker about the weights. Its
  quality is below Demucs (about 6 to 7 dB vocal SDR against about 8 to 9 in the published
  tables, [music-analysis.md](music-analysis.md)).
- Owner decision, 2026-11-25: ship a commercially clean separator now, keep Demucs behind its
  licence gate.

The browser stem pipeline exists but assumes HTDemucs: 44.1 kHz time-domain audio in and out,
7.8 s segments, four named stems (`web/src/dsp/stems/`). A spectrogram-mask model at another
sample rate needs an adapter that does the STFT, the mask and the inverse STFT in the worker.

### Time-stretch

Desktop stretches with Rubber Band through pedalboard. Rubber Band has WebAssembly builds under
the GPL ([rubberband-wasm](https://www.github.com/Daninet/rubberband-wasm)) [A, summary], which
this GPL repo may ship. Signalsmith Stretch has an official WASM and AudioWorklet release under
MIT ([npm](https://npmjs.com/package/signalsmith-stretch)) [A, summary]. No published head to
head was found. The browser's own WSOLA (`web/src/dsp/stretch.ts`) is kept as the fallback.

### Offline rendering

Nothing forces a browser to mix live. A worker can render a seam clip faster than real time with
zero-phase filters, as `render/dsp.py` does, then measure it as `audit/checks.py` does. The
scheduler already plays a pre-rendered clip that hands back to the native song (the stretched
entry clip), and since 2026-11-25 the hosted timeline player
(`web/src/cloud/hosted/timelinePlayer.ts`) plays server clips cut at cue points on one clock.

### Decode and memory

The engine decodes whole files to PCM and keeps three songs (about 10.6 MB per stereo minute
each). WebCodecs decodes raw frames, not files, so streaming decode means writing a demuxer
([W3C issue](https://github.com/w3c/webcodecs/issues/366)) [S, summary]. Whole-file decode stays
for now; planning at song start costs about 50 MB more held early.

### Lyrics

LRCLIB is listed as open, keyless and CORS-enabled, but it has started restricting clients and
disallows parallel requests [A, summary]. Cloud already has one global, database-backed rate
limit for it (`usage/rate_limit.py`). Whether lyrics may drive analysis in a paid product is a
legal question that ADR-0406 leaves open. Vocal spans measured from a voice stem need no lyrics.

## 3. What this allows

1. **Know the whole song, once.** Run Beat This and the feature extraction on every song in the
   background, on the profiler that already decodes each song for its key profile
   (`web/src/cloud/tonalProfiles.ts`), and keep the result by content hash
   (`web/src/media/derived.ts`).
2. **Let the real planner decide.** Send those numbers (never audio) to the account, so the
   Python planner chooses the order, the cues, the move and the length, as it does on Desktop.
   The owner approved saving song facts to the account on 2026-11-25.
3. **Render ahead, then audit.** Render each seam clip in a worker as a script, measure it, and
   try the next candidate when a check fails. Play native song, clip, native song.
4. **Stems on the device** with the clean separator, on the windows a seam needs only.

The browser then ports deterministic audio code and one small repair rule. It never scores or
invents a transition, so there is one planner to maintain.

## 4. Limits that stay

- Audio starts from a gesture and stops when the tab is hidden or the device sleeps (ADR-0457).
- Tablets may be too slow for Beat This on WASM or stems without WebGPU; facts made on one
  device serve every device of the account, and a device that cannot render keeps the live path.
- Results from a device are the member's own claim: schema-checked, private to the workspace,
  never shared across accounts (ADR-0469).
- The browser renderer is its own implementation with its own id (ADR-0459). Its match with the
  Python engine is measured with golden fixtures and judged by the owner's ears, never assumed.

## 5. To measure before trusting any of this

- `small0` on WASM and WebGPU: seconds per minute of audio on a laptop, an iPad and a phone.
- The clean separator's sound in a vocal ride against Demucs, by the owner.
- Rubber Band WASM against the Python render on the golden set.
- Seam render time in a worker for a 16-bar blend with stems.
