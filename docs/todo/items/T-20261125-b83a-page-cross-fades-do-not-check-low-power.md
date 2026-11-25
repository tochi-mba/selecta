---
id: T-20261125-b83a
title: Page cross-fades do not check low power
area: shell
status: doing
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit:
---

sceneTransitionsWanted in web/src/shell/sceneTransition.ts checks the flags, the motion choice and reduced motion, but not lowPowerActive(), so a struggling device still gets view transitions. Good: low power turns them off.
