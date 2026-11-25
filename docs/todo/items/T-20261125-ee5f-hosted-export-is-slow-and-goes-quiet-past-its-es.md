---
id: T-20261125-ee5f
title: Hosted export is slow and goes quiet past its estimate
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/hosted-mode-walkthrough.md
commit:
---

A 12-song hosted export (export.render, render.setmix) was still running after 33 minutes on a loaded dev machine, and the card shows no time once past its estimate. Measure on a real worker; show progress (song n of 12) and say when it runs long.
