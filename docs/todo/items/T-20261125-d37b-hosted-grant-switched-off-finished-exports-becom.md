---
id: T-20261125-d37b
title: Hosted grant switched off: finished exports become unreachable
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 8
commit:
---

What happens: with cloud.hosted_media removed, cloud.stored_media keeps the library listed and every original playable and deletable (ADR-0456; tests/test_bf_hosted_jobs.py drains hosted jobs on revocation and resumes them on a new grant), so no music is lost. But GET /api/hosted/exports/{job_id} belongs to cloud.hosted_render and the hosted card is not shown, so an export finished before the switch can't be downloaded until the grant returns, and the Library has no plain Download original. What good looks like: finished hosted exports listed in the Library under cloud.stored_media (read only) until they expire, and a Download original action for each upload, so a customer whose hosted storage ends can take everything with them.
