---
id: T-20261125-0c43
title: Feel: right-to-left pages slide the wrong way and the speaker pulse runs backwards
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

styles/feel-scene.css:31-34 sets forward to arrive from the right and back from the left with no :dir(rtl) flip, and styles/feel-rooms.css:169-171 moves the speaker-moved pulse with translateX(-100%) to 0 while its dot sits at inset-inline-end, so in an RTL page it travels away from the new speaker. Other sheets already flip (feel-components.css:31-34). Fix: multiply --feel-scene-from-x by a --feel-dir of -1 under :root:dir(rtl) (or [dir=rtl]), and flip the pulse keyframes the same way.
