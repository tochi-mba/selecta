---
id: T-20261125-66f1
title: Hosted mix export polls with no end
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Dead-end audit, 2026-11-25
commit:
---

web/src/cloud/hosted/HostedMix.tsx exportMix loops while the export job is not ready or failed, with no deadline and no stop on unmount: a job stuck in queued shows its state for ever and keeps polling after the page is left. Good: a deadline that says the export is taking longer than expected with a Check again button, and the loop stops when the component unmounts. Also the event stream (cloud/events.ts) awaits the token before its silence timer starts, so a token call that never settles leaves the stream connecting with no fallback to polling.
