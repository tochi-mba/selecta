---
id: T-20261125-ebda
title: Signal for the first hand-off heard, for the install moment
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Background running and install, 2026-11-25
commit: 88b4cd03
---

The 'played' install moment (cloud/installMoments.ts) uses three minutes of this tab playing (accountTabs tabBusyHere().playing) as a stand-in for 'the first hand-off was heard', because the playback files were off limits. Once the player emits a seam-played event the moment can listen for it directly.
