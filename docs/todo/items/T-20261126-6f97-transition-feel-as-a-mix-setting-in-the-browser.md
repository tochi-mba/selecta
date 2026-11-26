---
id: T-20261126-6f97
title: Transition feel as a mix setting in the browser
area: editor
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit: 464051e2
---

browserFlags.ts switches mixes.shaping.feel off in a device-music Cloud account; deviceMusicMixes.ts refuses the feel steering action. Feel is a setting of the app's transition maker. Good: the account keeps the feel with the steering, the planner's candidates and the device studio honour it, and mixes.shaping.feel is on in the browser behind cloud.brain.
