---
id: T-20261125-be40
title: Admin cover hide tool for catalogue art
area: admin
status: done
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit: b14c0bc4
---

Plan 3.14 asks for an admin tool to hide a catalogue cover (ADR-0478; the takedown path named in T-20261125-3907). The server side was already built when this item was filed: the `catalog_art` table carries the hide flag, reason, time and staff member, `POST /api/admin/catalog/art/{art_id}/{command}` (hide and unhide, reason required, `legal.takedowns.manage`, audited as `legal.catalog_art.hidden` and `.unhidden`) lives in src/selecta/catalog/routes.py, and the image route refuses a hidden image at once (browsers may keep their copy for up to an hour, `private, max-age=3600`). What was missing was the console page and a way for staff to find an image: `GET /api/admin/catalog/art?q=` (same permission, owned by admin.console) and the Admin page Catalogue covers, which lists each cover with its image, source and state and hides or unhides it with a reason, shown only while library.art_lookup is on.
