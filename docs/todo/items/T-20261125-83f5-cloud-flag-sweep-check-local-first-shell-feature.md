---
id: T-20261125-83f5
title: Cloud flag sweep: check local-first shell features (browser Harmonic, Lucy) reflow when off
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: flags.cloud.ts sweep rebuild, PR #137
commit:
---

cloud.browser_harmonic (Make a Mix Harmonic matches) and lucy.cloud_conversation (Lucy in the browser) render only inside the local-first shell (CloudShell.tsx), which the Cloud e2e build turns off (tests/e2e_cloud_server.py). Their registry surfaces are local names (discover.harmonic, lucy), so the Cloud sweep records them as covered elsewhere instead of checking the shell closes up with each off. Good: the sweep can open local-first shell pages for a person with cloud.local_first selected (as localFirst.ts does), the registry names their cloud.* surfaces, and the per-flag reflow test covers both.
