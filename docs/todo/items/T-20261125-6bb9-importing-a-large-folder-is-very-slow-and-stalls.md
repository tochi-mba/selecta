---
id: T-20261125-6bb9
title: Importing a large folder is very slow and stalls the page
area: library
status: open
priority: high
who: claude
created: 2026-11-25
source: Browser pass in Helium, 2026-11-25
commit:
---

Checking C:/Users/tochi/Music (2,467 files) in the Cloud app reached 19 files in about three minutes on the owner's PC, and the page stopped answering for stretches of more than five seconds. Find where the time goes (hashing, tag and picture reading, registration calls, the art queue added by ADR-0478) and keep the page responsive. Good: steady progress with the page usable throughout.
