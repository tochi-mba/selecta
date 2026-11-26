---
id: T-20261126-9d4d
title: Hosted card and Workers page: show the new server fields
area: admin
status: open
priority: normal
who: claude
created: 2026-11-26
source: hosted gaps, walkthrough section 11
commit:
---

Server fields added compatibly: GET /api/hosted/songs and prepare answer allowance_used {kind, limit, used, resets_at, why} when songs wait for tomorrow's analysis allowance (each such song's status.reason already says it); a too-long song is status failed with its reason and can_retry false. POST /api/hosted/mixes/render answers allowance_used when a hand-off was refused for the day's transition time (each seam's why says it). GET /api/stored/exports lists finished exports with links, open without the hosted grant (a Library list for d37b). The Workers page read (admin hosted_status) has pieces.collector {ran, at, dry_run, deleted, deleted_bytes, playback_expired, playback_bytes, failed, kept_unknown}, pieces.alert_mail {configured, setting} and pieces.gateway.refused_builds [{pool, worker_build, gateway_build, at}]. Good: the card shows allowance_used plainly with when it resets; the Library lists stored exports and has Download original (GET /api/assets/{id}/playback-url?download=true); the Workers page shows the three pieces with what this means / what to do.
