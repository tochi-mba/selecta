---
id: T-20261124-eb44
title: RemoteListen's first test may time out under load
area: ci
status: open
priority: normal
who: claude
created: 2026-11-24
source: PR #137 CI fixing, 2026-11-24
commit:
---

web/src/devices/RemoteListen.test.tsx 'shows what is playing on the other device, where it has got to and what is next' failed once at findByTestId('remote-title') (default 1 s wait) when run beside CloudApp tests, and passed alone. Good: it passes reliably in the full CI web run; if it flakes there, find what makes the first render slow rather than raising the wait blindly.
