---
id: T-20261125-cc4b
title: Check catalogue cover keys against storage layouts and lifecycle rules
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25 (ADR-0478 catalogue)
commit:
---

Catalogue covers are stored in the derived bucket under catalog/v1/art/, outside the key layouts documented in the storage keys module. Good: the layout is documented, and no deletion sweep or bucket lifecycle rule can remove or orphan them by accident.
