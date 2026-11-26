---
id: T-20261126-cbbc
title: Two vocal ride seam tests run demucs for five to six minutes
area: ci
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/verification/engine-store-flag-on-sweep.md
commit:
---

tests/test_mix_mixes.py::test_a_seam_says_what_was_tried_before_what_it_landed_on (354 s here, flag on) and tests/test_mix_render.py::test_a_render_is_remembered (over 280 s) render a vocal ride between songs with no lyrics; it falls back through stem_arrange, which runs demucs on real synthetic audio. They pass on CI but cannot run on this machine inside 280 s, so they are left to CI. In a group run each showed F just before the time limit cut the report, and the reason was lost; alone the first passed. Good looks like: both prove the fallback order without separating stems (a fake separator or a fallback list without stem_arrange), finish in seconds, and pass alone and in a group.
