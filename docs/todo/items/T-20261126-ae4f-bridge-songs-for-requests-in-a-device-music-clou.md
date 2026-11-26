---
id: T-20261126-ae4f
title: Bridge songs for requests in a device-music Cloud account
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

The browser shell switches requests.bridges off (web/src/cloud/browserFlags.ts): a request joins when the member adds it, and no bridge song is offered. The account already plans bridges (POST /api/requests/{id}/bridge in cloud_brain/requests_routes.py), but the browser's request family (localFirstRequests.ts) never calls it and the bridge's seams would need the device studio to make them (see T-20261126-a246). Good: with cloud.brain and cloud.account_mixes, the Requests panel offers the account's bridge, the device studio makes its transitions ahead, and requests.bridges is on in the browser.
