---
id: T-20261125-6763
title: Workspace says Measuring song keys whenever Harmonic matches is on
area: library
status: done
priority: later
who: claude
created: 2026-11-25
source: Import freeze hunt, 2026-11-25
commit: a238aee7
---

CloudShell.tsx passes measuringKeys={browserHarmonic && on('discover.harmonic')}, so the Workspace activity line shows even when every song is measured, while the profiler waits for an import or for music to stop (tonalProfiles.ts now pauses then), and in tabs that do not hold the selecta-tonal-profiler lock. Have startTonalProfiler report its real state (measuring, waiting for import, waiting for music, done) and show that. CloudShell.tsx is at 999 lines, so the wiring needs a line freed first.
