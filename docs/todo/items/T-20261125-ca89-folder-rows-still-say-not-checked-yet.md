---
id: T-20261125-ca89
title: Folder rows still say Not checked yet
area: library
status: done
priority: later
who: claude
created: 2026-11-25
source: Background running and install, 2026-11-25
commit: a238aee7
---

cloud/MusicFolders.tsx STATE.unchecked and rowWords say 'Not checked yet' for a folder that has never been checked, which the no-'not yet' rule forbids. Say what is happening instead (for example 'Checked when SelectaDJ is next idle' or 'Waiting for its first check'), and update MusicFolders.test.tsx.
