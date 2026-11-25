---
id: T-20261125-1343
title: The browser stops watching folders without saying so when permission lapses
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Chrome asks again for folder permission in a new session unless the member chose to allow it always; Firefox and Safari cannot pick a folder at all; a private window has no device storage; Safari clears site storage after seven days without a visit unless the app is installed. Also untested: one watched folder inside another, the same folder added twice, a folder renamed or on an unplugged drive, 50,000 files. Good: each case has a plain message and a next step, and nested folders do not double songs.
