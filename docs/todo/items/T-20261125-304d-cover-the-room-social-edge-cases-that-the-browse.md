---
id: T-20261125-304d
title: Cover the room social edge cases that the browser walk did not reach
area: rooms
status: open
priority: normal
who: claude
created: 2026-11-25
source: browser walk of feat/room-social, 2026-11-25
commit:
---

Edge cases reasoned about but not run: a host switching votes off while one is open; the room reaching its 12 hour limit mid-vote; two host devices pressing Let the room pick at once in a browser; a guest in two tabs; a phone with storage blocked keeping songs; a winner whose file is gone when the speaker tries to add it; the host skipping the song during a vote; 100 phones on one Wi-Fi address tapping hearts. Good looks like one test or browser spec for each, or a note of which existing test covers it.
