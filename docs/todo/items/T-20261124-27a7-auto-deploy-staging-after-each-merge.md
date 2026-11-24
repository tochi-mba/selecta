---
id: T-20261124-27a7
title: Auto-deploy staging after each merge
area: infra
status: open
priority: high
who: either
created: 2026-11-24
source: owner asked 2026-11-24
commit:
---

The deploy job is skipped because SELECTA_CREDENTIAL_BROKER_URL is not set. Simplest: a Render deploy hook URL saved as a GitHub secret and called after the image is built. Needs the owner's go-ahead to change Render and GitHub settings.
