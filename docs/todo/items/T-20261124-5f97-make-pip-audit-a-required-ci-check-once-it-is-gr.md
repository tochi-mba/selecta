---
id: T-20261124-5f97
title: Make pip-audit a required CI check once it is green
area: ci
status: open
priority: normal
who: owner
created: 2026-11-24
source: docs/engineering/product-audit.md area L, docs/ci.md
commit:
---

The python-advisories job runs pip-audit and verify reports it but does not require it. Once it has been green, add it to the checks verify requires.
