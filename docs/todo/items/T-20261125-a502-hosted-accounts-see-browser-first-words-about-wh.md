---
id: T-20261125-a502
title: Hosted accounts see browser-first words about where music lives
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/hosted-mode-walkthrough.md
commit: fbd98d09
---

A hosted account still sees browser-first copy: the footer says 'Your music files stay on your devices' and Listen shows 'None of your devices with music is open right now'. Say where the songs are for a hosted account.

2026-11-25: the footer is fixed for hosted accounts (footerWords in web/src/cloud/hosted/hostedWords.ts). Listen still says "None of your devices with music is open right now" for a hosted account; that part remains.
