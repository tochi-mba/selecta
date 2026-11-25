---
id: T-20261125-c9ae
title: Catalogue lookups keep sending song details after the person turns lookups off
area: security
status: open
priority: high
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

src/selecta/catalog/service.py:195-210 checks allowed(user) only when a lookup is queued (enqueue_for_songs). The job itself, run_lookup (service.py:363-407) via handle_job (413-430), checks only the global flag before it sends artist, title, album and length to MusicBrainz. A Library page queues up to 200 jobs per read (MAX_SONGS_PER_ASK), so a person who switches 'Look up covers and details on the web' off still has every queued job, and every failed lookup's retry (RETRY_ERROR_MAX_S, 7 days), leave the server afterwards. Nothing checks whether the song was since deleted or the account closed either. queue_cover_fetch (433-440, from PUT /catalog/songs/{id}/choice) never checks the setting at all. Fix: carry the asking user and workspace in input_ref, and in run_lookup/handle_job skip unless at least one live, non-deleted song link for that key belongs to a user who still allows lookups (or record consenting users on the lookup row); on set_allowed(False) cancel that user's queued catalog.lookup jobs. Add a test: queue, turn off, run job, assert no MusicBrainz call.
