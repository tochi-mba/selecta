# Product audit

A living record of what could go wrong for a person using SelectaDJ (paying or not), what happens
today, and what was done about it. One row per case. Started as the paying-customer audit
(2026-11-24) and widened to the whole repo the same day.

**Status words.** *Handled before*: the code already did the right thing (file and line given).
*Fixed now*: changed in this audit, with the commit and the test that covers it. *Needs the owner*:
a decision, a setting in Stripe, WorkOS or Cloudflare, legal text, or money. *Other agent*: the
case sits in the device and room agent's or the Lucy agent's area and was handed to them.
*Not reviewed*: listed so it is not forgotten; nobody has looked yet. A row is never marked fixed
unless its test was run; where a fix was not checked in a browser the row says so.

## Counts

Rows that name each status (a row can name two, such as a fix that also needs an owner setting):

| Status | Rows |
|---|---|
| Fixed now | 16 |
| Handled before | 17 |
| Needs the owner | 9 |
| Other agent | 7 |
| Not reviewed | 13 |

## The seven named gaps

| # | Area | What could go wrong | What happened before (file:line) | Status | Commit and test |
|---|---|---|---|---|---|
| 1 | Billing | A failed renewal, a cancellation, a bank asking for 3D Secure, or the drop to Free were invisible in the app | `billing/stripe_sync.py:232-243` decided `past_due_grace`, `cancel_at_period_end`, `past_due_expired`; `/api/account` (`api_cloud.py:700-714`) sent none of it; nothing in `web/src` read it | Fixed now (flag `billing.standing`). Not checked in a browser | e9f2ee0a, ebbe6af9; `tests/test_cloud_billing_standing.py` (9), `web/src/cloud/BillingStanding.test.tsx` (3) |
| 2 | Billing | No email for payment failed, plan ending, plan ended, plan started; risk of two emails for one event | `notify/templates.py` had job, quota, deletion, venue mail only | Fixed now; `docs/saas/08-billing.md` §8.6 says which emails are Stripe's. **The owner must turn off Stripe's failed-payment and cancelled-subscription customer emails** | e9f2ee0a; `tests/test_cloud_billing_emails.py` (6) |
| 3 | Plans | A drop to Free deleted every export older than 7 days at the next hourly sweep, with no warning | `storage/export_expiry.py:90-104` used the newest snapshot's retention from the moment it changed | Fixed now: the new plan's retention runs again from the day of the move; Plan & billing says so | 6a75d208; `test_a_drop_to_free_gives_free_retention_again_from_the_drop` |
| 3 | Plans | Storage over Free's 10 GB after a downgrade | `usage/quota.py` read-only state; `OverQuota.tsx` banner; email `over_quota` says nothing is deleted | Handled before | `tests/test_cloud_over_quota.py` |
| 3 | Plans | Exports per month over the new limit | `usage/meters.py:130-136` blocks new exports and the meter says when it resets | Handled before | existing meter tests |
| 3 | Plans | `library_soft_cap_songs` (15,000 to 3,000) | Read nowhere outside `billing/plans.py`; no effect | Handled before (nothing to do); the owner may want it removed from the catalogue or enforced | none |
| 3 | Plans | Rooms open when Premium ends; devices over a limit | `src/selecta/rooms/**`, devices | Other agent (device and room) | handed over |
| 3 | Plans | Lucy turns over the new tier mid-conversation | `src/selecta/lucy/**` | Other agent (Lucy) | handed over |
| 3 | Plans | Stems: Standard or Premium FULL to Free PREVIEW, stems already made | not traced | Not reviewed | |
| 4 | Deploys | A tab opened before a deploy fails to fetch a page file and shows a blank page or a raw error | `lazy()` in `App.tsx`, `RuntimeApp.tsx`, `CloudApp.tsx`, `LocalFirstShell.tsx`, `business/shell/pages.tsx`, `routeChunks.ts` had no catch | Fixed now: one retry, then "SelectaDJ has been updated" with Reload; `vite:preloadError` handled; per-session marker stops a reload loop; nothing reloads by itself, so music keeps playing. A quiet "A new version is ready" line when nothing is playing. Not checked in a browser | 163fc997; `web/src/ui/staleBuild.test.tsx` |
| 5 | Errors | No frame around the whole app: a crash above the page frames left a blank page. Page frames had no Reload, no reference, no support | `ui/controls.tsx:94-115`, `main.tsx` | Fixed now: an outer frame in `main.tsx`; every frame offers Try again, Reload and Contact support with a reference (`R-XXXX-XXXX`, also in the console line); the error text is never shown; a frame below the player leaves the player playing | 163fc997; `staleBuild.test.tsx` "a page that stops drawing", `controls.test.tsx`, `LocalFirstShell.test.tsx` L1 |
| 6 | Support | "SelectaDJ support can bring your account back" with no address anywhere | `cloud/AccountData.tsx:160`, `cloud/authConfig.ts:75`, `CloudApp.tsx:535` | Fixed now: `web/src/support.ts` holds the one address. **The owner must confirm `support@selectadj.app` exists and is read.** Help and support in the account menu and More; Contact support on error frames, billing problem notices, the closed-account and account-problem pages, prefilled with the reference and browser facts (no personal data) | e9f2ee0a, 064a0d97; `BillingStanding.test.tsx`, `staleBuild.test.tsx`, `LocalFirstShell.test.tsx` (menu items) |
| 7 | Security | Only frame-ancestors, object-src and base-uri were set | `web/public/_headers` | Fixed now as **report-only**: a full CSP checked against a production build (one inline script, allowed by hash), Permissions-Policy, HSTS. **The owner moves it to enforced after a week without reports** and may add a report endpoint | 9d8683ba; `web/src/securityHeaders.test.ts` |

## Areas A to J

| Area | What could go wrong | What happens (file:line) | Status | Commit and test |
|---|---|---|---|---|
| A | A deep link opened signed out is lost when the person signs **up** instead of in | `CloudApp.tsx:622` called `signUp()` with no state; sign-in kept `returnTo` | Fixed now | 1fb0dc64 merge of the K/A commit; `web/src/cloud/CloudApp.deepLink.test.tsx` |
| A | Email not verified | `CloudApp.tsx:625` `VerifyEmail` gate | Handled before | existing gate tests |
| A | Sign-in cancelled, pop-up blocked, second tab mid sign-in, back after sign-in | AuthKit redirect (no pop-up); `authConfig.ts:51-56` `followReturnTo` only follows same-origin paths | Not reviewed in a browser | |
| A | Invitation for a different email | `business/JoinOrganisation` | Not reviewed | |
| A | Firefox, Safari, iPhone: no folder access | `BrowserDiagnostics.tsx:60` says "This browser cannot remember a folder, so songs are chosen each visit" | Handled before (wording honest); fallback not checked on real devices | |
| B | Double click on Continue | `Billing.tsx` button `disabled={!ready}` while busy; server idempotency key per press (`billing/api.py:63-66`) and `checkout_in_progress` (`api.py:233-236`) | Handled before | `tests/test_cloud_billing_checkout_in_progress.py` |
| B | Back from Stripe; two tabs; closed tab before returning; slow webhook | `checkout.ts` phases `confirming`, `slow`, `cancelled`; `after_cancel` lets a cancelled Checkout start again | Handled before | `Billing.inProgress.test.tsx`, `test_cloud_billing_checkout_in_progress.py` |
| B | Paying while already paid | `api.py:194-195` `subscription_exists` | Handled before | `test_checkout_is_refused_while_the_workspace_already_pays` |
| B | The plan picker started on Premium, so Continue without looking cost more | `Billing.tsx:186` | Fixed now: starts on Standard, Monthly; the button and hint name the plan and price | `Billing.test.tsx` "checkout consent" |
| B | Card declined, 3D Secure on the first payment | Stripe Checkout shows it; `incomplete` now shows "Your bank wants you to confirm your payment" | Fixed now (gap 1) | `test_a_first_payment_waiting_on_the_bank_names_the_plan` |
| B | Prices shown without VAT wording while Checkout has `automatic_tax` on (`billing/webhooks.py:536-538`): if the Stripe prices are tax-exclusive a UK consumer pays more than the page said | `Billing.tsx:18-21` | **Needs the owner**: confirm each Stripe price is `tax_behavior=inclusive`, then add "Prices include VAT" | |
| B | A non-owner opens Billing | Server refuses with `billing_not_permitted` (`api.py:131-136`); the notice tells a member the owner can update payment details | Handled before (server); fixed now (notice wording) | `BillingStanding.test.tsx` |
| C | Delete account while paid: the subscription is cancelled at once with no refund and does not come back if the account is restored, and the confirmation did not say so | `identity/deletion_effects.py:233-262`; `AccountData.tsx:158-163` | Fixed now (wording). **Needs the owner**: whether a prorated refund is owed | `AccountData.test.tsx` (existing) |
| C | Change email, sign out everywhere, export my data contents, suspended account | `identity/routes.py`, `cloud_export.py`, `SuspendedPanel` | Not reviewed | |
| D | Dates in billing notices | New `ui/format.ts dateWords` in the person's own time zone; emails use the owner's account time zone (`notify/billing_mail.py day_in`) | Fixed now | `BillingStanding.test.tsx`, `test_a_failed_renewal_mails_the_grace_date_in_the_owners_time_zone` |
| D | One formatter each for price, count, size | `ui/format.ts countOf`, `cloud/api.ts bytes`; prices are literal strings in `Billing.tsx:18-21` | Not reviewed in full | |
| E | Server codes shown as words: `messageOf` turns a bare code into text ("billing not permitted") | `cloud/api.ts:101-109` | Not reviewed in full: callers need a code-to-words map | |
| F | Storage full, cleared, private browsing, versionchange, two tabs migrating | `media/store.ts`, `cloud/persistence.ts` | Not reviewed | |
| G | Suspended audio context, output change, sleep, discarded tab | `devices/**`, `playback/**` | Other agent (device and room) | handed over |
| H | Rate limits: `docs/saas/12-security-privacy-legal.md:18` promised "per-account and per-IP limits in the API"; only rooms, business people and the kiosk answered 429 | `scripts/audit/routes.py` table: 19 of 338 Cloud routes mentioned 429 | Fixed now (`src/selecta/ratelimit.py`, flag `cloud.rate_limits`): per-IP and per-account token buckets kept in each process's memory (a database write per request would double the load to stop the rare abuser; N processes allow N times each limit, documented), stricter for checkout and portal, account changes, upload plans and search; 429 with `Retry-After` and plain words; a forged token is refused before it costs anyone's bucket. Doc §12.1 now matches. **Owner**: Cloudflare WAF rules on top. Tests to follow (CI) | fb728358 |
| H | A write whose answer was lost, or a double press, done twice (a second mix, room or upload plan) | Only billing, local-media recipes, Lucy and business billing kept keys | Fixed now (`src/selecta/replay/`, flag `cloud.idempotency`, table `idempotent_replays` with the workspace isolation policy, migration `bfaudit01`): every Cloud write with an Idempotency-Key gets the first answer back for 24 hours, a concurrent repeat gets 409 `request_in_progress`; the web client sends one key per press, made before any retry. Left without it, on purpose: billing Checkout and portal, local-media recipes, Lucy and business billing (each keeps its own keys, Stripe's included); webhooks (Stripe and WorkOS event ids); guest, display, kiosk and venue room routes (no account token, their own per-guest and per-device limits). Tests to follow (CI) | 16c1b6b6 |
| H | Anonymous access: every Cloud route called with no sign-in | `scripts/audit/anonymous.py`: only `GET /api/status` and `GET /api/ready` answered 2xx | Handled before | the script |
| I | Accessibility of the new notices and frames | Notices use `role="alert"` or `status`; error frames keep the `main` landmark and put the alert on the message | Fixed now; not checked with a screen reader | `LocalFirstShell.test.tsx` L1 |
| J | No Terms of Service or Privacy Policy link anywhere; Checkout asks "I agree to the subscription terms" without a link to them | `Billing.tsx:164`; `PrivacyNoticeDraft.tsx` is a draft behind a flag | **Needs the owner** (legal text and URLs) | |
| J | Refund policy and the 14-day right: the consent wording exists (`Billing.tsx:159-162`); no refund policy page | | **Needs the owner** | |
| J | Cookie wording: the app keeps settings in browser storage only; no notice says so | | **Needs the owner** (whether a notice is needed) | |
| J | "REX Technologies" in the footer | `CloudApp.tsx CloudCredit` | Handled before | |

## K. Defaults

Rules are in `docs/saas/11-ui-ux.md` "Defaults". What each setting is, where it lives, its default
and where that default is written.

| Setting | Stored | Default today | Defined at | Should be | Follows the person to other devices |
|---|---|---|---|---|---|
| Theme | browser | follow the OS | `web/src/state/prefs.ts DEFAULT_PREFS` | same | No (screen) |
| Motion | browser | Subtle; OS reduced motion always wins | `prefs.ts DEFAULT_PREFS`, `ui/useReducedMotion.ts` | same | No (screen) |
| Density, library layout, side menu | browser | comfortable, list, open | `prefs.ts DEFAULT_PREFS` | same | No (screen) |
| Ctrl K, single-key shortcuts, term hints, older navigation | browser | on, on, on, off | `prefs.ts DEFAULT_PREFS` | same | No (this keyboard) |
| How defaults were read | | each field had its own literal in `prefs.ts read()`, and `setPrefs` wrote every default into storage, so a better default could never reach anyone who had changed any one setting | | **Fixed now**: one constant, only choices stored, Reset to defaults with a confirmation that lists what changes | `web/src/state/prefsDefaults.test.ts` |
| Plan picker | page | Premium, Monthly | `Billing.tsx:186` | Standard, Monthly (`DEFAULT_PLAN`, `DEFAULT_INTERVAL`) | n/a. **Fixed now** |
| Checkout consent boxes | page | none ticked (`checkout.ts NO_CONSENT`) | | same (UK: never pre-ticked) | n/a. Handled before |
| Time zone | account | browser's at onboarding (`CloudApp.tsx:478`), `UTC` if unknown | `identity/schema.py:41` | same | Yes |
| Workspace name | workspace | "Personal" | `identity/accounts.py:52 PERSONAL_WORKSPACE_NAME` | "Personal" until a name is known; the owner is offered a rename once (`PUT /api/account/workspace-name`, flag `account.workspace_name`, `cloud/WorkspaceNameOffer.tsx`). Shown on the Account page, not the device Workspace page, which belongs to the device and room agent's shell work | Yes. Fixed now, e646a972; not checked in a browser |
| Device name, default speaker, never play | account / device | `devices/**` (ADR-0475) | | the first device with music becomes the default only when it is the only one | Other agent (device and room) |
| Room settings: approval, nicknames, per-guest limit, cooldown | room | `src/selecta/rooms/settings.py` | | host approves, generated nicknames | Other agent (device and room) |
| Lucy preferences | account | `src/selecta/lucy/**` | | | Other agent (Lucy) |
| Marketing email | account | none exists; only service email is sent | | off until asked | Handled before |
| Analytics or diagnostics sharing | | none is sent; Diagnostics copies only when the person presses Copy | `cloud/BrowserDiagnostics.tsx` | off | Handled before |
| Mix length and style for a first mix | browser (`selecta.mixLength`) | not traced | | | Not reviewed |
| Volume on first play and on hand-over | device | `devices/**`, `playback/**` | | comfortable, never jumps | Other agent (device and room) |
| Every other `localStorage` key (studio, listen, inspector width, recent draft, unsent Lucy text) | browser | per feature | | | Not reviewed one by one |

## L. The whole repo

### Inventories

| Inventory | How it is made | Totals |
|---|---|---|
| API routes | `uv run python scripts/audit/routes.py` (method, path, app, flag, signed in, workspace, Idempotency-Key, 429) | 469 routes: 131 local, 338 Cloud. Every route has a flag (`tests/test_flags.py`) |
| Anonymous calls | `uv run python scripts/audit/anonymous.py` | 2 Cloud routes answer with no sign-in (status, ready); 12 answer 503 "not configured" in a bare test app (webhooks, guest and display pages) |
| Background work | `src/selecta/maintain.py` builds every task; each runs under the maintenance leader's lease (`fence`) | 25 tasks (actions, reservations, Lucy runs, flag previews, admin metrics, usage reconcile, derived eviction, Stripe events and reconcile, storage and account deletions, rooms, export expiry, DMCA, emails, zone clock and autoplan, entitlement, alerts, horizon, business billing and licensing) |
| Migrations | `src/selecta/persistence/migrations/versions` | 46 |
| Screens | not generated yet | Not reviewed |

### Findings so far

| Pass | Finding | Status |
|---|---|---|
| Routes, security | No Cloud route does anything for an anonymous caller | Handled before (script) |
| Routes, abuse | 207 Cloud writes take no Idempotency-Key; most are naturally idempotent PUT and DELETE, but POSTs that create (mixes, rooms, uploads plan) should be checked one by one | Not reviewed one by one |
| Routes, abuse | No general per-account or per-IP rate limit | Needs the owner (see H) |
| Secrets | The production build holds the public API origin only; no key or token found by a grep of `web/dist/assets` for `sk_`, `whsec_`, `rk_`, `Bearer ` | Handled before (checked once on this audit's build) |
| Jobs | Each maintenance task runs under one leader with a fence | Handled before (`maintain.py`); interruption and double-run per task not reviewed |
| Docs | `docs/saas/16-edge-cases.md` claimed "sign-in from a new device (notify)" with nothing behind it | Fixed now: one email per new device with Sign out everywhere (`notify/device_mail.py`, flag `account.new_device_email`; `tests/test_cloud_new_device_email.py`), e59ea95a |
| Dead code | `library_soft_cap_songs` was read nowhere, though `02-plans-and-economics.md:22,70` promises it as a soft cap | Fixed now: counted in `/api/account` (`usage/meters.py library_size`) and said calmly on Plan & billing past the cap; nothing is refused (`tests/test_cloud_library_soft_cap.py`), e646a972 |
| Local app, business, admin, dependencies, observability, consistency | | Not reviewed |

## Handed to the other agents

- **Device and room agent**: what a drop from Premium does to an open room (it should run to its end, as `16-edge-cases.md` says) and the sentence the host sees; devices over a limit after a downgrade; area G (suspended audio context, output device change, sleep and wake, discarded tab, a file moved since the scan); default device name ("Chrome on Windows", "This device"), the first device with music becoming the default speaker only when it is the only one, volume that starts comfortable and never jumps on hand-over; room defaults (host approves, generated nicknames, per-guest limit, cooldown).
- **Lucy agent**: Lucy turns over the new tier after a downgrade mid-conversation (the next turn uses the new tier, and the person is told once); Lucy preference defaults and that they follow the account.
