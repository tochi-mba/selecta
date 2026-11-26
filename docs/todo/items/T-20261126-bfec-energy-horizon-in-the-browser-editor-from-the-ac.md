---
id: T-20261126-bfec
title: Energy horizon in the browser editor from the account's measured energy
area: editor
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

browserFlags.ts switches editor.energy_horizon off for a device-music Cloud account. The account now holds each song's measured energy (GET /api/song-facts carries it), but the mix rows the browser gets (account GET /mix or recipe mixes) carry no per-bar energy for MixHorizon. Good: the mix rows carry the energy the horizon draws (from the account's facts), and editor.energy_horizon is on in the browser with cloud.brain and cloud.device_analysis.
