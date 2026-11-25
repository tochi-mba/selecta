---
id: T-20261125-6d59
title: Shared Meter track barely shows on raised cards
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted polish, walkthrough 8.1
commit:
---

ui/Meter's .meter-track is --surface-control, which on a --surface-raised card is under 1.5:1 in both themes (the export and analysis bars on the hosted card, and every Meter on a card). The hosted player's bar now uses color-mix(in srgb, var(--border-strong) 75%, var(--border)) (3.2:1 light, 4.5:1 dark). Good: one track token in foundation.css with 3:1 against every surface a Meter sits on.
