---
id: T-20261125-a09c
title: Lazy pages: a real hairline progress under the context bar
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.0 'lazy pages': a hairline under the context bar instead of a blank swap while a page's code loads. Not built because there is no real progress to show: a looping or self-filling line would fabricate progress (ADR-0477 rule 4, ADR-0146). Good: routeChunks/sceneTransition report real bytes or a real loaded-of-total count for the chunk, and the shell draws a hairline that follows only that, hidden under Still.
