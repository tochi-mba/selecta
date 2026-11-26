---
id: T-20261126-0ac7
title: Size the derived-data budget per plan from hosted playback files
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: hosted gaps, walkthrough section 11
commit:
---

Eviction keeps derived data within 15 percent of plan storage (storage/eviction.py). Hosted playback files are about 40 MB a song (24-bit FLAC), so a 1,000-song library is 40 GB against a 1.5 to 15 GB budget and eviction will remake playback files for most mixes (15 to 35 s of cpu-light each). The collector now also expires playback files unused for 30 days. Good: a per-plan budget chosen from measured staging libraries, or playback files counted outside the share, with the cost of each choice written down.
