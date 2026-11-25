---
id: T-20261125-5322
title: Cloud flag sweep: open the business pages and check each business flag reflows
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: flags.cloud.ts sweep rebuild, PR #137
commit:
---

The Cloud reflow sweep (web/e2e-cloud/flags.cloud.ts) only opens the personal-account pages (home, listen, library, uploads, billing, settings). The SelectaDJ for Business flags (business.*) have real pages under /b/{org} (console, venue view, staff controls, people, billing, rooms, content controls) that only organisation members reach, so the sweep records them as covered elsewhere (business.cloud.ts) rather than checking each one closes up when switched off. Good: the registry names a cloud.business_* surface for each, the sweep seeds an organisation person (POST /test/business/seed) and switches each business flag off for that person, checking the page reflows with no trace.
