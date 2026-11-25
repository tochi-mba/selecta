---
id: T-20261125-5343
title: Engine tables must be covered by account export and account deletion
area: security
status: open
priority: high
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

ratings, analysis and song_overrides now exist in Cloud with a workspace column. Check that the deletion and export paths (persistence/registry.py and their guard tests) really remove and export them, including feature files under the features key in R2.
