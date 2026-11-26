---
id: T-20261125-36b5
title: Ogg FLAC has no audio id
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Audio identity build, 2026-11-25 (docs/engineering/audio-identity.md)
commit:
---

FLAC in Ogg spreads its tags over several header packets (VORBIS_COMMENT, PICTURE), so skipping packet 1 as for Vorbis and Opus is not enough; the a1 rules give it no id and the whole-file hash identifies it. Good: a2 rules that use the mapping header's header-packet count and skip every metadata packet but STREAMINFO, in both implementations, with fixtures.
