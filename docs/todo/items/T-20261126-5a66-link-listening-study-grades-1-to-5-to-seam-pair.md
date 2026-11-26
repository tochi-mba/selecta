---
id: T-20261126-5a66
title: Link listening-study grades (1 to 5) to seam pair facts so calibration can use them
area: local-app
status: done
priority: later
who: claude
created: 2026-11-26
source: docs/engineering/calibration.md
commit: 43205942
---

2026-11-26: 2026-11-26: ratings.seam_key exists (lib0006seams, es0479seam01) and eval.ratings.save_rating(..., seam_key=) fills it with core.engine_store on, so a grade can be joined to seams.pair. Still to do: nothing that records grades knows a seam key (the listening study's rendered conditions are files of their own, and the reel keeps ratings in the browser); good looks like the study's register step naming each condition's seam key and calibration reading grades joined to seam facts.

2026-11-26: A listening condition that is a seams.key, or whose manifest names one (listening_methods.seam_key, lib0010listening), joins its 1 to 5 grades to that seam (engine_store.listening.seam_grades); selecta calibrate counts them beside Good and Bad. move-trial renders in memory, so its trials name no seam.
