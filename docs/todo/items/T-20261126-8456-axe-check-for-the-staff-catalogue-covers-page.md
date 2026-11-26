---
id: T-20261126-8456
title: Axe check for the staff Catalogue covers page
area: admin
status: open
priority: normal
who: claude
created: 2026-11-26
source: web/src/shell/mpSurfaceInventory.test.ts
commit:
---

The staff console's Catalogue covers page (web/src/admin/CoversPage.tsx, site.admin.covers) has no automated axe check. It shows only with library.art_lookup on. Good: the cloud e2e stack turns the flag on for staff and web/e2e-cloud/bf-accessibility.cloud.ts walks 'Catalogue covers' with the other console pages, then the inventory entry names that spec instead of a gap.
