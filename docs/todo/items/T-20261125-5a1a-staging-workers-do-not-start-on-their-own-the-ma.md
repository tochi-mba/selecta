---
id: T-20261125-5a1a
title: Staging workers do not start on their own: the maintenance autoscaler has no Modal token
area: infra
status: open
priority: high
who: owner
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit:
---

Modal workers on staging run only when someone starts them by hand: every function has min_containers=0 and the maintenance service's autoscaler is not registered without SELECTA_MODAL_TOKEN_ID and SELECTA_MODAL_TOKEN_SECRET (and SELECTA_MODAL_APP). Until then a hosted upload waits with no worker. Owner step: create a Modal token for the maintenance service and add both values to selecta-maintain-staging on Render (the service is also failing on production: 'Failed service'). Then check an upload starts a container on its own and it scales back to zero.
