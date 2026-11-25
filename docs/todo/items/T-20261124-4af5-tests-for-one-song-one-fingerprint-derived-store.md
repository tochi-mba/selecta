---
id: T-20261124-4af5
title: Tests for one song, one fingerprint: derived store, memo rule, reuse words, song versions
area: library
status: done
priority: high
who: claude
created: 2026-11-24
source: ADR-0469 amendments 1 and 2 (features first, tests last)
commit: fd694047
---

Vitest for web/src/media/derived.ts, fingerprints.ts (memo hit and miss, remembered mark, sample check), reuseWords, songVersions.ts (grouping, best version, primaryOf for old mix ids). Pytest for src/selecta/local_media/versions.py (length rule, idempotent regroup, removed primary) and the rooms catalogue offering primaries only. A guard test that no listing selects local_songs outside versions.listed_songs.
