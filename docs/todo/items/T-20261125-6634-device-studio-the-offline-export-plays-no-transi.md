---
id: T-20261125-6634
title: Device studio: the offline export plays no transitions
area: local-app
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0479 and the owner's plan approval, 2026-11-25
commit:
---

web/src/engine/render.ts joins songs end to end with a 30 ms crossfade and plays no seam, no loudness gain, and the export panel was never built (localExport is null in web/src/cloud/CloudShell.tsx). Good looks like: an exported file sounds like what was played. ADR-0479 phase 5.
