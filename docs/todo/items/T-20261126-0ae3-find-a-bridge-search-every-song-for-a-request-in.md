---
id: T-20261126-0ae3
title: Find a bridge (search every song) for a request in a device-music Cloud account
area: shell
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit: ff1fa1d8
---

In a device-music Cloud account a bridge is offered only with the place the account finds for a request (request_planning.plan, agreed through POST /api/requests/{id}/bridge). The Desktop's Find a bridge (POST /api/requests/{id}/bridges, search every song for one or two that lead to the request) and Hear it ahead (/hear) have no Cloud route: the search reads every song's arrays per call and the preview renders on the server. Good: a Cloud bridge search over stored song facts, bounded like request_planning.WINDOW, through the engine store with the caller's workspace, behind requests.bridges with cloud.brain; the browser's Requests panel offers its options (the device then makes the chain's transitions, as for any placement); /hear answered by the device studio's clip for the pair.
