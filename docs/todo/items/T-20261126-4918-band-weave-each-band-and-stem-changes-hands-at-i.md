---
id: T-20261126-4918
title: Band weave: each band and stem changes hands at its own bar
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-26
source: ADR-0479 phase 8; docs/research/transition-craft-2.md
commit:
---

Phase 8 named band_weave first and it was never built. DJs bring in highs, then mids, and trade the bass last; real mixes are better explained by per-band gains than one fader (Kim et al., NIME 2021; Robinson and Brown, arXiv 2301.13380). Good: a recipe in src/selecta/planner_core/recipes/ that searches each band's (and, with stems, each stem's) switch bar against the real audit, expressible in the existing TransitionScript so the browser renders it unchanged, behind a move flag that is off until the owner has listened, with a listening row in docs/engineering/one-brain-listening.md.
