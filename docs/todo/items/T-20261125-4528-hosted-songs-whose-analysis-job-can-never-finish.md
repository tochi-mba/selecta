---
id: T-20261125-4528
title: Hosted: songs whose analysis job can never finish stay 'about 1 minute left' forever
area: storage
status: done
priority: high
who: claude
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit: 8339751b
---

Two analyse.song jobs queued on staging before the output-namespace fix (31b88a2d) can never finish: their input_ref has no 'output', and the idempotency key stops a fresh job being made for the same song. The hosted card keeps saying '2 of 5 songs done, 3 to go. About 1 minute left.' Good: preparing songs replaces a job whose input_ref lacks a declared output (or any job that has failed for good) with a fresh one, and the card says plainly when a song could not be analysed, with a Try again button, and never shows an estimate that is not moving.
