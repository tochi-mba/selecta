---
id: T-20261125-1110
title: Live blend: the outgoing lane is flat when a mix resumes at a song's very end
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Playback re-check, 2026-11-25
commit: 88b4cd03
---

Reopening Listen restored All Day Sucker at 5:05 of 5:05. Pressing Play went straight into the hand-over and the live blend drew the outgoing song as a flat dotted line across the whole lead-in, though the strip above showed it loud until about 4:58. The next hand-over (Amen into Another Star, reached with Jump to the transition) drew both lanes correctly. Likely the seam time reported there is past the song's own length, so every bar reads beyond the peaks. Check now.seamAt against detail.duration in web/src/views/LiveBlend.tsx and clamp.
