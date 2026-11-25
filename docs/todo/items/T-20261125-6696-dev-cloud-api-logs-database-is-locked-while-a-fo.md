---
id: T-20261125-6696
title: Dev Cloud API logs database is locked while a folder is imported
area: infra
status: open
priority: normal
who: claude
created: 2026-11-25
source: Browser pass in Helium, 2026-11-25
commit:
---

During a folder import the dev stack's API (SQLite) logged sqlite3.OperationalError database is locked on BEGIN IMMEDIATE 66 times in a few minutes, and the app showed the service is not answering banner. Two browsers were signed in at once. Good: registrations queue or retry without surfacing as an outage; confirm PostgreSQL in staging does not show the same.
