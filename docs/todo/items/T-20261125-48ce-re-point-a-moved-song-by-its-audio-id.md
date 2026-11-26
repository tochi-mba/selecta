---
id: T-20261125-48ce
title: Re-point a moved song by its audio id
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Audio identity build, 2026-11-25 (docs/engineering/audio-identity.md)
commit:
---

On Desktop a moved or renamed file is forgotten at its old path and added as a new song at the new one, losing its analysis link, corrections and ratings. relink.py moves a whole folder by hand; nothing matches single files. The scan would need each new file's audio id (a full read) and the old row's stored one, and must never re-point when the old file still exists, when two rows share the audio id, or when the old row is in use elsewhere. Good: a new path whose audio id matches exactly one row whose path is gone re-points that row, inside the scan's one transaction, behind library.audio_identity, with tests for every refusal.
