---
id: T-20261125-43c3
title: A mix in a background tab, a sleeping laptop or a changed output can miss its seam
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Browsers slow timers in hidden tabs (to once a minute after five minutes), so seam preparation may start late even with cloud.seam_lead. Closing the lid, switching to Bluetooth (new sample rate and latency) and two tabs playing the same account are also unchecked. Good: seams are scheduled on the audio clock well ahead, a wake from sleep resumes cleanly, and a second tab hands over or refuses.
