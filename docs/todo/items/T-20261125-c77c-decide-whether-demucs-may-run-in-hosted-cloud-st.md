---
id: T-20261125-c77c
title: Decide whether Demucs may run in hosted Cloud (stems)
area: legal
status: open
priority: high
who: owner
created: 2026-11-25
source: docs/engineering/cloud-library-walkthrough.md
commit:
---

Hosted mode cannot split stems: Demucs htdemucs is 'review' in docs/saas/licence-register.md, so require_model refuses it in cloud mode and every stem move (vocal ride, strip and land, intertwined stems, word moves) is skipped on the server. Decide the licence (legal advice), then mark it allowed; the walkthrough has the per-window CPU time and the GPU cost per song.

2026-11-25: the owner decided the product side. Cloud stems (cloud library and device) ship with a commercially clean separator now (MIT weights trained on licensed music), and Demucs stays behind its licence gate (ADR-0479, decision 2). So stem moves in Cloud no longer wait on this item: that work is T-20261125-03a3. What stays open here is only the lawyer's answer on whether Demucs itself may ever run in Cloud.
