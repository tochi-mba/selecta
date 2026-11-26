---
id: T-20261126-fdde
title: Hosted stems: a stems.window handler with a licence-cleared separator, so uploaded-music mixes can blend
area: storage
status: open
priority: normal
who: either
created: 2026-11-26
source: docs/engineering/cloud-library-walkthrough.md section 12 (one brain, Phase 6)
commit:
---

No handler serves stems.window (catalogue only) and no separator may run in Cloud: Demucs stays behind its licence gate (modes/model_allowlist.json, ADR-0405); the owner chose a commercially clean separator (Spleeter class, MIT weights trained on licensed music). Until then a hosted seam with cloud.hosted_brain runs the planner core with analysis.vocal_sense bound off, so with no lyrics it can play only cut_on_one, echo_out and reverb_wash (workers.engine_core). What the handler must provide. Input (input_ref): source_key and source_sha256 of the stored original, start and duration of one window (at most 46 s, the windows seam_making.windows_for names; one window per side per hand-off, never the whole song), model (the allowlisted id, added to model_allowlist.json with its licence as allowed), objects [source_key], output {kind: stems, input_hash}. input_hash = sha256 of sorted JSON {source_sha256, start, duration, model, stems: STEMS_VERSION}. Work: normalise as engine_handlers.normalise, separate on the gpu pool (cpu fallback), require_model(model) first. Outputs, published under derived kind stems: vocals.flac, drums.flac, bass.flac, other.flac (44.1 kHz, 24-bit, the window's exact samples, their sum matching the input), and a result {keys, checksums, singing_spans: [[start, end], ...] in song seconds from the vocal stem, as analysis.vocal_sense.singing_spans measures}. Server side then: hosted_render asks for the windows of each hand-off before its seam.render, names their keys in the seam job's objects and each side's stems, and the worker (workers.engine_core) passes the spans to audit(vocal_spans=...), binds analysis.vocal_sense on, and resolves stem parts through a render.sources.SourceResolver over the downloaded files, so long blends, vocal rides and stem moves can be offered. Done when a hosted pair with no lyrics gets an 8 or 16 bar blend that passes the audit on a real worker, and the separator's licence is on the register.
