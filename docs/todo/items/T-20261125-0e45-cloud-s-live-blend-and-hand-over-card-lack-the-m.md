---
id: T-20261125-0e45
title: Cloud's live blend and hand-over card lack the move's name and the hand-over bar
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Live blend, 2026-11-25
commit:
---

In Cloud the mix items carry no seam state, so LiveBlend's move name (entering.seam.state.label) is never shown, and Now.tsx TransitionCountdown gets switchAt from seam?.switch_at only, so its hand-over progress bar never draws during a Cloud hand-over. The engine's played SeamRecord (facts.seam.schedule.style) and NowState.blend.window hold the real values. Good: during a Cloud hand-over the live blend names the move that really plays and the hand-over card shows its bar, both from what the engine scheduled.
