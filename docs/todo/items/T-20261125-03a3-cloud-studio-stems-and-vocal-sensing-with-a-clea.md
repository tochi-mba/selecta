---
id: T-20261125-03a3
title: Cloud studio: stems and vocal sensing with a clean separator, so blends survive
area: storage
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0479 and the owner's plan approval, 2026-11-25
commit:
---

On the server every planned blend falls back to an echo or a cut because nothing knows where the vocals are (docs/engineering/hosted-mode-walkthrough.md). The owner chose on 2026-11-25 to ship a commercially clean separator now and keep Demucs behind its licence gate. Good looks like: a stems handler for the gpu pool with the clean model, vocal spans fed to the audit, and blends that pass. ADR-0479 phase 6. Related: T-20261125-c77c.
