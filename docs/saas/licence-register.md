*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09. Decision: [ADR-0405](../adr/adr-0405-licence-register-and-s-key-replacement.md).*

> **Accepted local-first target (2026-11-13; implementation not started).** Keep the model/dependency register but review **distribution** of local binaries, bundled FFmpeg/codec/DSP libraries, S-KEY non-commercial status, Demucs weights, lyrics and territorial media rights. Local computation does not remove legal obligations. See ADR-0475. Historic architecture and evidence below remain part of the record. [Current direction](20-local-first-cloud-architecture.md) · [Migration](22-local-first-transition.md).


# Licence register

Every model and key dependency, its licence, and whether cloud mode may use it. This is a living table: add a row before a model or dependency ships in cloud mode, and keep the "Cloud mode" column honest. It is not legal advice; rows marked **Review** need a lawyer's view before paid launch.

Package licences below were read from the installed package metadata on 2026-11-09 (`importlib.metadata` in the project's `.venv`). Model notes come from the code and project pages; see [sources.md](sources.md).

## Models and weights

| Model | Model id | Used for | Where | Licence | Cloud mode |
|---|---|---|---|---|---|
| S-KEY (Deezer) | `skey` | Key detection | `src/selecta/analysis/key.py`, `analysis/skey_model.py` | Weights licensed for **non-commercial research only** (`skey_model.py:5-6`) | **Blocked.** Replace before any paid plan (see [§10.3](10-audio-engine-in-cloud.md#103-model-licences-release-blocker)) |
| Beat This (CPJKU), `small0` / `final0` | `beat_this.small0`, `beat_this.final0` | Beats and downbeats | `src/selecta/analysis/beats.py` | MIT code and weights per the project; training data licences not stated | Allowed after confirming the LICENSE file and model card |
| Demucs `htdemucs` | `demucs.htdemucs` | Stem separation | `src/selecta/stems.py` | Code MIT (package 4.1.0); weights licence not stated; trained partly on research datasets; original repo archived Jan 2025, maintained fork exists | **Review** |
| wav2vec2 `WAV2VEC2_ASR_BASE_960H` (torchaudio) | `torchaudio.wav2vec2_asr_base_960h` | Lyric alignment | `src/selecta/lyrics/align.py` | fairseq code MIT; LibriSpeech training data CC BY 4.0 | Allowed with attribution |
| Claude models (Anthropic API) | - (an API, nothing is loaded) | Lucy | `src/selecta/lucy/providers.py` | Commercial API terms, not a weights licence | Allowed under Anthropic's commercial terms and DPA |

Considered earlier and **not to be used** in cloud mode: Essentia models and library (AGPL / non-commercial models), madmom models (non-commercial), MuQ/SongFormer and ctc-forced-aligner (CC BY-NC), per `docs/research/music-analysis.md`.

## Python dependencies (runtime)

| Package | Version | Licence | Cloud mode notes |
|---|---|---|---|
| pedalboard | 0.9.26 | GPL-3.0 | Server-side use isn't distribution. The local edition stays GPL-3.0-or-later. |
| Rubber Band (via pedalboard) | - | GPL-2.0-or-later, commercial licence available | As above; a commercial licence only matters if a closed build is ever distributed |
| mutagen | 1.48.1 | GPL-2.0-or-later | Server-side use isn't distribution |
| soxr (python-soxr) | 1.1.0 | LGPL-2.1-or-later | Fine as a dynamically linked library |
| torch | 2.15.0+cpu | Apache-2.0, BSD and others | GPU workers use a CUDA build: record its version here |
| torchaudio | 2.11.1+cpu | BSD | |
| demucs | 4.1.0 | MIT | Weights: see models table |
| beat-this | 1.1.0 | MIT | |
| librosa | 1.0.0 | ISC | |
| numpy | 2.5.4 | BSD-3-Clause and others | |
| scipy | 1.18.1 | BSD | |
| soundfile | 0.14.0 | BSD-3-Clause | |
| pyloudnorm | 0.2.0 | MIT | |
| nnaudio | 0.3.4 | MIT | |
| fastapi | 0.162.0 | MIT | |
| uvicorn | 0.54.0 | BSD-3-Clause | |
| httpx | 0.28.1 | BSD-3-Clause | |
| anthropic | 2.6.0 | Apache-2.0 | |
| weftai, weftai-providers | 0.7.0 | MIT | |
| psutil | 7.2.2 | BSD-3-Clause | |
| typer | 0.27.3 | MIT | |
| rich | 15.0.0 | MIT | |

## System tools in worker images

| Tool | Licence | Notes |
|---|---|---|
| FFmpeg | LGPL-2.1-or-later, or GPL if built with GPL components | Record the exact build and its configure flags for each worker image |

## Data sources

| Source | Used for | Status |
|---|---|---|
| LRCLIB | Synced lyrics lookup | Terms and rate limits to confirm with the operators; lyric display needs a licence in a paid product. See [§10.5](10-audio-engine-in-cloud.md#105-lyrics-in-cloud-mode-needs-a-decision) |

## Rules

1. A model or dependency without a row here doesn't ship in cloud mode.
2. A row marked **Blocked** or **Review** blocks the paid launch until resolved.
3. Cloud mode loads models only from the allowlist [`src/selecta/modes/model_allowlist.json`](../../src/selecta/modes/model_allowlist.json), the machine-readable copy of the models table: a row whose Cloud mode starts **Allowed** is `allowed`, **Review** is `review` and **Blocked** is `blocked`. Every loader (`analysis/key.py`, `analysis/beats.py`, `stems.py`, `lyrics/align.py`) calls `selecta.modes.models.require_model(id)` first, which in cloud mode raises `ModelNotAllowed` for anything not `allowed` or not listed, before any weights are read. Local mode is unchanged. `tests/test_cloud_model_allowlist.py` fails when this table and the allowlist disagree. Change both together.
4. The machine-readable register [`src/selecta/modes/licence_register.json`](../../src/selecta/modes/licence_register.json) has one row per package in the runtime closure of `uv.lock` plus the `observability` extra (99 packages on 2026-11-10), which is exactly what the worker image in [`infra/modal/selecta_workers.py`](../../infra/modal/selecta_workers.py) installs, and one per system tool. `python src/selecta/audit/licence_register.py --write` adds rows for new packages (status `review` unless plainly permissive) and keeps hand-written statuses. `tests/test_cloud_licence_register.py` fails when a locked package has no row or a stale version, when the image installs a system tool without a row, or when a weights loader skips `require_model`. The table above lists the notable rows; the JSON is complete.
5. Still to do by a person: compare the register against a built worker image (`pip list` and `ffmpeg -buildconf` inside it) before beta, and record the GPU image's CUDA build.

---

[← sources.md](sources.md) · [Contents](README.md#chapters)
