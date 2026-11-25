---
id: T-20261125-be40
title: Admin cover hide tool for catalogue art
area: admin
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.14 asks for an admin tool to hide a catalogue cover (ADR-0478; the takedown path named in T-20261125-3907). There is no catalogue art server module, table or admin route in this checkout yet (src/selecta has no cover hide endpoint), and the Feel work-tools worker may not touch src/selecta. Build it once the catalogue foundation lands: an Admin page row per cover with a deliberate Hide command (reason required, like other admin commands), behind library.art_lookup.
