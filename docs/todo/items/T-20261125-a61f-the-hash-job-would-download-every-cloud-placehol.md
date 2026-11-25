---
id: T-20261125-a61f
title: The hash job would download every cloud-placeholder file (OneDrive, iCloud, Dropbox)
area: library
status: done
priority: high
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit: 2e7f75b1
---

engine_store.song_hashes reads every song file once. On a library kept in a synced folder with files on demand, reading a placeholder downloads it, so the pass can pull the whole library to disk. It also meets unplugged drives, files being written by a downloader, and files it may not read. Good: skip files flagged offline or recall on data access (Windows file attributes), skip and retry later on any read error, and prove it on a folder of placeholders before core.engine_store is turned on.
