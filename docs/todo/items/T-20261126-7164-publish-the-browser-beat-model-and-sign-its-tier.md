---
id: T-20261126-7164
title: Publish the browser beat model and sign its Tier 3 record
area: devices
status: open
priority: normal
who: owner
created: 2026-11-26
source: docs/engineering/device-beats.md
commit:
---

The browser can run the Desktop's beat tracker (Beat This small0 in ONNX, web/src/dsp/analysis/beatThis/), proved identical to the Desktop on the golden songs, but no browser uses it until three owner steps are done. (1) Publish the model file: on this PC, build/beat-this/beat-this-small0.onnx (10,527,297 bytes, SHA-256 221565e9ab7c825bac98266b618ff3b78df0a6bf3f67272b90f0a86da14f1ac4; rebuild it byte for byte with python tools/beat_this_onnx_export.py, which checks the hash against web/src/dsp/analysis/beatThis/artefact.json). Serve it from SelectaDJ's own site on staging and production at /models/beat-this/web-beatthis-small0-1/221565e9ab7c825bac98266b618ff3b78df0a6bf3f67272b90f0a86da14f1ac4.onnx with Content-Type application/octet-stream and Range support (the repo is public and holds no weights, so it cannot go in web/public; a Cloudflare route or Worker over R2 at /models/* works). Check with curl -I that it answers 200 with that length. (2) Run section 3 of docs/verification/bf-tier3-beat-this-2026-11-26.md on the physical device classes and give the licence decision in section 1, then sign the record. (3) Then set BEATS_LICENCE_RECORD in web/src/dsp/analysis/beatThis/model.ts to 'bf-tier3-beat-this-2026-11-26' and turn cloud.device_analysis on where wanted. Good: a browser with the flag on fetches the file once, the capability roster shows neural_beats ready on fast devices, and songs are re-measured with web-dsp-1+web-beatthis-small0-1.
