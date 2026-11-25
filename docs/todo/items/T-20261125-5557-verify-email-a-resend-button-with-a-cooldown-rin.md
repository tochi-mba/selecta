---
id: T-20261125-5557
title: Verify email: a Resend button with a cooldown ring
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.1 asks the verify-email gate (web/src/cloud/Gate.tsx VerifyEmail) for a resend action whose cooldown shows as a ring emptying over the real wait. There is no endpoint to resend the verification email today (WorkOS hosted sign-in sends it; src/selecta has no resend route). Good: a server route that asks WorkOS to resend, rate limited, returning the real seconds until the next resend is allowed; the gate shows Resend email with a ring that empties over exactly that time (no ring under Still), and says when it was sent.
