---
id: T-20261125-7491
title: A Desktop file whose audio changed keeps its old analysis
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Audio identity build, 2026-11-25 (docs/engineering/audio-identity.md)
commit:
---

A file replaced in place (same path, new audio) keeps its analysis row: the scan only refreshes tags, and analysis runs only for songs with no analysis or an older version. Measurements and corrections then describe audio that is gone. With library.audio_identity the hash job can tell: a new audio id that differs from the old one. Good: when the hash job finds a different audio id for a row that had one, mark the analysis stale so it runs again, keeping corrections only after the member confirms.
