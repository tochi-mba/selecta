---
id: T-20261125-5baf
title: The live blend drawing never appeared during a real hand-off in Cloud
area: shell
status: done
priority: high
who: claude
created: 2026-11-25
source: Playback pass in Helium, 2026-11-25
commit: 248841ee
---

During a real transition on /listen (hero lit, Transition in progress, From and Into shown, visualizer moving) no LiveBlend element was in the page: the side panel held only handoff, next-up, listen-queue and view options. web/src/views/LiveBlend.tsx is meant to draw both songs' real waveform peaks crossing with the hand-over progress under the music part. Find why it is not mounted in the Cloud shell (the next song's peaks, the near-seam condition, or where Now.tsx places it) and make it show. Good: the two waveforms cross during the blend, driven by the real progress.
