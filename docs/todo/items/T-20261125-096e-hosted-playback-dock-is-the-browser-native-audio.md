---
id: T-20261125-096e
title: Hosted playback dock is the browser native audio widget
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit: 217da733
---

web/src/cloud/CloudTransportDock.tsx lines 106 to 115 render audio controls in a plain card. Good: the shared transport with cover, hue and play state. No beat effects there, because that audio cannot be measured safely (ADR-0477).
