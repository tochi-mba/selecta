---
id: T-20261125-03a3
title: Cloud studio: stems and vocal sensing with a clean separator, so blends survive
area: storage
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0479 and the owner's plan approval, 2026-11-25
commit:
---

On the server every planned blend falls back to an echo or a cut because nothing knows where the vocals are (docs/engineering/cloud-library-walkthrough.md). The owner chose on 2026-11-25 to ship a commercially clean separator now and keep Demucs behind its licence gate. Good looks like: a stems handler for the gpu pool with the clean model, vocal spans fed to the audit, and blends that pass. ADR-0479 phase 6. Related: T-20261125-c77c.

2026-11-26, the browser side (stem moves in a device-music account, cloud.browser_stems) waits on the same thing: what the owner must supply is the commercially clean separator itself: which model, its licence record id (to go in dsp/capability.ts STEMS_LICENCE_RECORD and PASSED_TIER3_RECORDS once the Tier 3 record passes), and its ONNX weights published at the content-hashed path dsp/stems/model.ts stemArtefactUrl names (STEM_MODEL_ARTEFACT is null today, so no browser downloads or runs a separator). No model is downloaded or chosen by Claude. With those, Claude sets the artefact, and the stem prefetcher, the stem moves and mixes.shaping.stem_moves turn on behind cloud.browser_stems as already wired.
