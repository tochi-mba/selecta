---
id: T-20261126-a246
title: The browser does not render a Cloud request's seams ahead, so placements never become ready
area: shell
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-requests.md
commit: d1f2eb9a
---

A Cloud account's request look (POST /api/requests/consider?device_id=) plans each placement from song facts and lists seams_needed (pair and planner settings); a placement is ready for a device once that device has reported passing seams for every pair (PUT /api/seams/{key}), and POST /api/requests/insert then puts it in as one write. The browser does not call these yet: requests kept with the account are joined by hand (Add next). Good: when a request waits and the mix plays, the browser studio renders the listed seams ahead of the music (as it renders the mix's own), reports them, and offers or joins the placement through /requests/insert, falling back to Add next. Also decide whether worker-rendered seams count for uploaded music (the hosted session's studio id).
