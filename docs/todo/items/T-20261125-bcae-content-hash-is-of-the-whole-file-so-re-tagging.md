---
id: T-20261125-bcae
title: Content hash is of the whole file, so re-tagging a song makes it a new song in Cloud
area: library
status: doing
priority: high
who: either
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Cloud keys a song by the SHA-256 of its file. Editing a tag (title, artwork, a rating written by another player) changes the bytes, so the song loses its facts, corrections and seam history and is measured again. The same recording as MP3 and as FLAC is also two songs. Good: decide whether identity should be a hash of the audio only (tags skipped), and if so add it beside the file hash before any Cloud data depends on it.
