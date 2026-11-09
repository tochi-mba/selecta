*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09. Decision: [ADR-0405](../adr/adr-0405-licence-register-and-s-key-replacement.md).*

# Licence register

Every model and key dependency, its licence, and whether cloud mode may use it. This is a living table: add a row before a model or dependency ships in cloud mode, and keep the "Cloud mode" column honest. It is not legal advice; rows marked **Review** need a lawyer's view before paid launch.

Package licences below were read from the installed package metadata on 2026-11-09 (`importlib.metadata` in the project's `.venv`). Model notes come from the code and project pages; see [sources.md](sources.md).

## Models and weights

| Model | Used for | Where | Licence | Cloud mode |
|---|---|---|---|---|
| S-KEY (Deezer) | Key detection | `src/selecta/analysis/key.py`, `analysis/skey_model.py` | Weights licensed for **non-commercial research only** (`skey_model.py:5-6`) | **Blocked.** Replace before any paid plan (see [§10.3](10-audio-engine-in-cloud.md#103-model-licences-release-blocker)) |
| Beat This (CPJKU), `small0` / `final0` | Beats and downbeats | `src/selecta/analysis/beats.py` | MIT code and weights per the project; training data licences not stated | Allowed after confirming the LICENSE file and model card |
| Demucs `htdemucs` | Stem separation | `src/selecta/stems.py` | Code MIT (package 4.1.0); weights licence not stated; trained partly on research datasets; original repo archived Jan 2025, maintained fork exists | **Review** |
| wav2vec2 `WAV2VEC2_ASR_BASE_960H` (torchaudio) | Lyric alignment | `src/selecta/lyrics/align.py` | fairseq code MIT; LibriSpeech training data CC BY 4.0 | Allowed with attribution |
| Claude models (Anthropic API) | Lucy | `src/selecta/lucy/providers.py` | Commercial API terms, not a weights licence | Allowed under Anthropic's commercial terms and DPA |

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
3. Planned enforcement (not built yet): cloud mode loads models only from an allowlist generated from this table, and a CI check fails when a cloud worker image contains a model not listed here.

---

[← sources.md](sources.md) · [Contents](README.md#chapters)
