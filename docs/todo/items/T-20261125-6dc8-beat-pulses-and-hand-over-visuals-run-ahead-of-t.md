---
id: T-20261125-6dc8
title: Beat pulses and hand-over visuals run ahead of the sound on Bluetooth and AirPlay
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

Nothing in web/src reads AudioContext.outputLatency or baseLatency (grep finds none). The beat bus (web/src/feel/beatBus.ts:246-276) reads the analyser, which sees samples before they reach the speaker, and the grid path and the ambient hand-over travel (feel/useMusicFeel.ts:45-55) follow player songTime, which is the context clock, not what is heard. On Bluetooth headphones (often 150 to 300 ms) the ring, edge, bars and live blend line visibly lead the music. Fix: read context.outputLatency (fallback baseLatency, else 0) in createFrameSource and delay each pulse by it (schedule the element.animate with a delay option equal to the latency) and subtract it from songTime for grid phase and handoverProgress. Owner check afterwards on Bluetooth headphones.
