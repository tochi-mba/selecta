---
id: T-20261125-c52a
title: Onboarding Connect: covers pour in as files are checked
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.1: during the Connect step the real song count rolls (built) and covers should pour in as files are checked. The import does not hand the spine any file art yet (media/tags.ts reads it; ImportSnapshot carries only names and counts). Good: the snapshot carries the last few checked songs' embedded art blobs, and the step shows them arriving, real covers only (ADR-0478), nothing generated in their place.
