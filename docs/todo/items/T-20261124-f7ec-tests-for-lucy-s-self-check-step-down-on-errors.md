---
id: T-20261124-f7ec
title: Tests for Lucy's self-check, step-down on errors, music-only suggestions and the walkthrough fixes
area: lucy
status: done
priority: normal
who: claude
created: 2026-11-24
source: Staging fixes 2026-11-24 (owner: code first, tests last)
commit: 8a261f4d
---

Built in a6307d71, b3ff4719, c7c9d584, 9dde4176 without tests. Good: tests with a fake provider for report_failure (log line, one alert an hour), cloud_health.check with a stubbed client, the step-down chain on a 5xx, music_artists leaving out spoken-word artists, the Cloud save dialog facts and the pill after a save.
