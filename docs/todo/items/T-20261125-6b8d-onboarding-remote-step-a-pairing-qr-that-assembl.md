---
id: T-20261125-6b8d
title: Onboarding Remote step: a pairing QR that assembles
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.1 says the onboarding Remote step's QR assembles. The step (web/src/cloud/onboarding/steps.tsx RemoteStep) only points to Devices; no pairing code or QR is created during onboarding. Good: the step offers a real pairing QR from the devices pairing API, drawn with the rooms feel-qr-wave arrival (opacity only, so it scans as drawn), with Skip kept.
