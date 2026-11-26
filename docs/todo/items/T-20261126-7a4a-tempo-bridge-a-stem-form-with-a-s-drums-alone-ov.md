---
id: T-20261126-7a4a
title: Tempo bridge: a stem form with A's drums alone over the bridge
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-26
source: Transition craft II (One brain phase 8), feat/one-brain-5
commit:
---

move.tempo_bridge strips A with EQ only (low band down, mids down, a highpass), which works in every studio. With stems, the research's form is A's drums stem alone over the 16 bridge bars. The planner core may not import render/stem_seam.py (tools/planner_core_pure.py), and the browser studio steps over any script with a stem part, so the stem form needs: a stem lane shape the core can build (Part.from_source with a drums SourceRef), the Desktop studio separating that window, and a reel showing it beats the EQ form. Same flag.
