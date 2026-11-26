---
id: T-20261125-ae07
title: Install offers in two tabs overwrite each other's memory and can repeat a dismissed offer
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit: 54579e03
---

web/src/cloud/installMoments.ts:138 reads selecta.install.moments once when the watcher starts and every later write (writeMemory, 119-121) writes that tab's whole copy. Two open tabs: a Not now in tab A is invisible to tab B, which can still show the same moment, and B's next write erases A's dismissal, so the two-dismissals rule (MAX_DISMISSALS) can be reset. Fix: re-read memory in look() before deciding and merge on write (union of shown and dismissed, earliest firstSeen), or listen for the storage event; also mark offeredThisVisit across tabs with a BroadcastChannel so two tabs never offer in the same minute.
