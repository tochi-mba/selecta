---
id: T-20261126-1ed4
title: The browser renderer's filter sweep runs about 20 full-length filters and is its slowest stage
area: devices
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-render.md (timings measured under node)
commit:
---

web/src/dsp/render/filters.ts sweepFilter reproduces src/selecta/render/dsp.py sweep_filter exactly: a bank of up to about 20 zero-phase filters, each run forwards and backwards over the whole clip. Under node on the development laptop a 30 s filter-sweep clip took 8.4 s to render (3.6 times faster than real time) where a plain blend of 21 s took 1.4 s. A tablet will be slower. Good: the same samples in less time, for example by running each bank member only over the stretch where the sweep uses it plus enough settling time, checked against the golden fixtures to the same 1e-6 tolerance before it replaces the exact path.
