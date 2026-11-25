---
id: T-20261125-b9c3
title: Hosted songs status should carry each song's title and artist from its tags
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

GET /api/hosted/songs sends only the upload's file name, so the hosted card reads title and artist from it (displayNames). A song whose name is not 'Artist - Title' shows its file name. Good: the server reads the tags at probe time and sends title and artist; the card already uses them when present (hostedWords.songNames).
