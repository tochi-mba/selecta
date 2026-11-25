---
id: T-20261125-7a7a
title: Import chip expands into the import card
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.2 'Banners': the import chip's See progress should carry the chip into the import card on More > This device as a shared element (navigate with share, a data-vt name on both ends). The chip already rolls its real count and fills a real bar (web/src/cloud/ImportChip.tsx); the destination card is in cloud/ImportStatus.tsx, outside the shell worker's files.
