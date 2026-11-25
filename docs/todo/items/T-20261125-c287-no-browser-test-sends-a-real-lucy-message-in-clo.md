---
id: T-20261125-c287
title: No browser test sends a real Lucy message in Cloud
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: Found while fixing T-20261125-89f0; tests/e2e_cloud_server.py
commit:
---

The cloud browser suite fills the turns meter through /test/usage and never runs a Lucy turn, because the test server has no scripted model. The routes are covered in Python (tests/test_lucy_cloud_limits.py), but nothing checks in a browser that the meter moves on the page after a message, or that the limit words render. Good: a scripted provider on the test server (app.state.lucy_cloud_provider) and one spec that sends a message and reads the meter.
