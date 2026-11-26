---
id: T-20261125-62fb
title: Maskable app icons reuse the plain PNGs
area: branding
status: done
priority: later
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit: 217da733
---

web/public/manifest.webmanifest lists maskable PNG entries that point at the same files as the any-purpose icons, so launchers crop the mark. Good: proper maskable PNGs with safe-zone padding.
