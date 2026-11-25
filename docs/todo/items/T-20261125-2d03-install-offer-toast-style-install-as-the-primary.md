---
id: T-20261125-2d03
title: Install offer toast: style Install as the primary action and tell Not now from a timeout
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Background running and install, 2026-11-25
commit: a238aee7
---

cloud/installMoments.ts shows its offer through showToast with actions [Install, Not now]. Toast action buttons all look alike, so Install is not drawn as primary, and the toast's close button or its 15 s timeout cannot be told apart from Not now (only Not now and a dismissed browser prompt count toward the two-dismissal rule; every shown moment is spent either way). Add an optional primary flag and an onDismiss to ToastAction in ui/toasts.tsx. Also, every toast is recorded in Activity, so the offer appears there once.
