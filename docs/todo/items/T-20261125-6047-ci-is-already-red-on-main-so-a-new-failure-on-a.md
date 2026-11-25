---
id: T-20261125-6047
title: CI is already red on main, so a new failure on a One brain pull request can hide
area: ci
status: open
priority: high
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Three failures come from main and were left alone on purpose. The owner asked that tests are not run locally, so CI is the only check, and a red run no longer means anything by itself. Each push also cancels the run before it. Good: before each merge, the failing test names on the pull request are compared with the failing names on main, and only the same set is accepted.
