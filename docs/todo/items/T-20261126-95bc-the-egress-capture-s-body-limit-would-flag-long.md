---
id: T-20261126-95bc
title: The egress capture's body limit would flag long songs' measurements
area: security
status: open
priority: normal
who: claude
created: 2026-11-26
source: tools/bf_egress_capture.py
commit:
---

The no-audio-egress capture flags any request body over 256 kB. A song's measurements (PUT /api/song-facts/{id}) are about 30 kB for a normal song but reach about 0.8 MB for a long one, all numbers and never audio. A capture run with cloud.device_analysis and cloud.brain on would flag them. Good: the capture allows PUT /api/song-facts bodies up to the route's 4 MB limit as application/json, and asserts they carry only the schema's fields (factsWire.ts FACTS_FIELDS).
