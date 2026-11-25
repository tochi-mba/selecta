---
id: T-20261125-3985
title: Hosted Make a Mix page: estimate, button names, button look, leave prompt, seek reads
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: staging re-test with Modal workers after PR 149, 2026-11-25
commit: fbd98d09
---

Small things seen on the hosted Make a Mix page on staging. (1) While transitions render, the card says 'Under a minute left' for several minutes; each blend attempt took 1.5 to 2 minutes. (2) The buttons' accessible names carry their busy words when idle: 'Make another mix Planning...' and 'Export the whole mix Exporting...'; hide the busy label from assistive tech unless busy. (3) 'Make another mix', 'Try the straight changes again' and 'Export the whole mix' read as plain text, not buttons. (4) Reloading the page raised the browser's 'Leave site?' prompt with nothing unsaved. (5) Jumping to another song made about 45 range requests in 20 seconds and one 834 ms pause; check the seek path reads only what it needs.

2026-11-25: (1) done on the server in ffca3dc8: mix_state's estimate is measured per planned move, laid onto the workers seen, and null when it would be a guess already proved wrong (estimate_why, work; walkthrough section 9). The card's words for it are T-20261125-a147. (2) to (5) still open.
