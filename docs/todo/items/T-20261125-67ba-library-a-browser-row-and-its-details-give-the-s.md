---
id: T-20261125-67ba
title: Library: a browser row and its details give the same answer in different words
area: library
status: done
priority: normal
who: claude
created: 2026-11-25
source: Cloud e2e drift fix (aa83), local-first-library spec, 2026-11-25
commit: 61a9cd04
---

state/availability.ts says it is the one answer for the Library row, its details and the Play capability, so none can disagree. Since 02889fe5 the browser row's chip has its own words (LibraryRow.tsx HERE: Ready, Not in this browser yet, Missing) while the details panel's Play line still uses availability.ts (Not on this device, Missing on every device), and a hosted copy and a file on this device both read Ready, with where it plays only in the chip's title. Good: one source of words for row and details, and a visible way to tell a hosted copy from a file here.

2026-11-26: With library.places the browser row says where a song is kept (PlaceChip: on this device, in your cloud library, or both, each with an icon) and, apart from that, a line only when it cannot play here; the details sheet gives each place its own row in the same words. A hosted copy and a file here no longer both read Ready.
