---
id: T-20261125-5ffa
title: Device checks for the feel system (touch laptop, Bluetooth, fast music, RTL)
area: shell
status: open
priority: normal
who: owner
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

Checks only a person with the hardware can do: (1) Touch laptop in Expressive: tap a card with a finger, then lift; does the hover lift and pointer light stay stuck until the mouse moves (styles/feel.css:102-210 hover rules are gated on the primary pointer only)? (2) Bluetooth headphones: play a mix with a clear kick; do the ring round Play and the playing bars visibly lead the beat? (3) Photosensitivity: on Listen with the visualizer on, play a 180+ BPM track and a drum roll; the beat bus is capped at three pulses a second (feel/beatBus.ts:103,224) and the visualizer separately (feel/musicFeatures.ts:23,424), but nobody has watched the two together; record a screen capture and run it through a flash checker such as PEAT. (4) An Arabic or Hebrew title in a scrolled tab strip: does the sliding indicator sit under the right tab (feel/indicator.ts:63 adds scrollLeft, which is negative in RTL)?
