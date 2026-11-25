---
id: T-20261125-fec9
title: Check main-thread cost of the ambient hand-over travel on a slow computer
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit: 54579e03
---

During a hand-over web/src/feel/hue.ts travelAmbient (93-100) writes --ambient-hue on the fixed full-viewport .ambient-layer every 70 ms, and styles/feel-music.css:101 gives that registered property a transition, so the whole-screen radial gradient repaints continuously for the length of the hand-over (often 8 to 30 s), alongside the beat bus and, in Cloud, the waveform book making peaks on the main thread (cloud/sharedWaveforms.ts fromDecoded). Low power lite turns ambient off only after two slow windows. Check with a performance trace on a 4x CPU throttle in the Cloud player through a real hand-over: any long tasks or dropped audio, and paint cost of the layer. If it is costly, step the hue without the CSS transition during travel, or animate opacity between two pre-tinted layers instead.
