---
id: T-20261125-37fe
title: Listen keeps the old title and 0:00 until the hand-off for many seconds after a blend ends
area: shell
status: doing
priority: normal
who: claude
created: 2026-11-25
source: Playback pass in Helium, 2026-11-25
commit:
---

After a transition finished, Listen still showed the outgoing song's title and 0:00 until the hand-off with a silent visualizer for roughly ten to twenty seconds before switching to the new song and the next countdown. Good: the hero, the countdown and the visualizer follow the real switch point within a second.
