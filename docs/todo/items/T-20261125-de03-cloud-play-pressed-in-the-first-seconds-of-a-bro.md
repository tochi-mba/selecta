---
id: T-20261125-de03
title: Cloud: Play pressed in the first seconds of a browser's first visit finds no device to play on
area: devices
status: done
priority: high
who: claude
created: 2026-11-25
source: copy-drift agent, nothing-lost.cloud.ts offline-play spec, 2026-11-25
commit: 51aff3f0
---

A browser's first visit registers its device after the shell's startup availability sweep. LocalFirstShell now reports again on DEVICE_REGISTERED, but until the holdings read that follows lands (about a second, or the 15 s poll when the event stream is slow), whereToPlay sees this device with no songs and Play says 'None of your devices with music is open right now.' and does nothing. Good: this device's own playable songs count for it before the server has heard, or Play waits for the report. nothing-lost.cloud.ts waits for the holdings answer before pressing Play (heldOnADevice); drop that wait once this is fixed.

2026-11-25 (devices-rooms agent): fixed in 51aff3f0. Until this device has reported, whereToPlay gets no situation, so Play plays here as before (LocalFirstShell, the useWhereToPlay situation). The heldOnADevice wait in nothing-lost can now go.
