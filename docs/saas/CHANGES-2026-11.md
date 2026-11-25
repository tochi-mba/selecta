# What changed in November 2026

*For the owner, in plain words. Covers pull requests #127 to #134, and #135 as it lands. The details
live in the chapters linked; this page says what is different for a person using SelectaDJ, and
ends with everything that needs you.*

## Signing in and the first minutes

- The welcome, sign-in and waiting screens move gently and never look stuck; "page not found" and
  its two sibling pages say where you are and how to get back (#127).
- The false "Sign in again to carry on" screen is fixed: it heals by itself, and an open page is not
  replaced for a short miss (#129).
- A link opened while signed out now comes back after **signing up** as well as signing in.
- "Finish later" on the getting-started steps is remembered on that browser (#129).

## Devices: every device a controller (ADR-0475)

- A phone or laptop without the music can still see and steer everything: search the whole
  library, add requests next, play on another device, and set one volume for the mix (#131 to #134).
- One account-wide current mix; a default speaker; when nothing plays, Play picks the device that
  plays by one rule, and asks "Where should the music play?" only when it must.
- A room offers guests only the songs its speaker can play now.
- "Never play" works in Cloud (#132).
- Chapter: [11a](11a-devices-and-rooms.md), [11 §11.3c](11-ui-ux.md). Still being built by the device
  agent in #134.

## Lucy in Cloud (ADR-0476)

- Lucy holds a full conversation in the browser about your library and mixes, proposes mixes you can
  save or play, and works across your devices (#133, #134). Every turn goes through the AI gateway
  with the plan's allowance and spending ceiling; when they run out she says so and when they come
  back. Each plan now answers with its own model: Free on Haiku, Standard on Sonnet, Premium on Opus.
- Not yet: Lucy's memory of you and your listening history in Cloud. Chapter: [09 §9.7](09-lucy-ai-gateway.md).

## Lucy's limits: a proposal (ADR-0480 to ADR-0487)

- Proposed on 2026-11-25, nothing built: one Lucy allowance weighted by what each turn costs, on a
  five-hour session under a weekly limit, with one meter that shows what is really enforced. It
  would replace turns per month. Prices and the 40% rule stay as they are.
- Reading the code for it found faults in today's limits: the turns meter reads counters nothing
  writes, two of the four turn classes can never happen, and the "out of turns" words are also
  shown when the hidden dollar ceiling was the cause. Each is filed in `docs/todo/items/`.
- Those three are fixed (2026-11-25): the meter reads what the gateway counts, messages count as
  quick turns and deep plans as the plans say, and at the dollar ceiling Lucy says it is the plan's
  monthly limit on her AI, not the turns. A test now fails if the two allowance tables disagree.
- Needs you: accept, amend or reject the set (LM-0480-02). Chapter: [09 §9.8](09-lucy-ai-gateway.md).

## Billing and plans

- **When a payment goes wrong, people are told.** A failed renewal, a cancelled plan, a bank asking to
  confirm a payment, and a plan that ended because payment failed each show one calm notice with the
  date in the person's own time zone, on every page and on Plan & billing, with Update card, Keep my
  plan or Confirm payment, and Contact support. Dismissed, it stays away until something changes.
- **Four emails**: payment failed, plan ending in 3 days, plan ended, and "your plan is now …".
  Stripe keeps sending receipts, invoices, refunds and the confirm-payment link
  ([08 §8.5, §8.6](08-billing.md)).
- The plan picker starts on the cheaper plan, billed monthly.
- A drop to Free no longer deletes older exports within the hour: the new plan's keeping time starts
  from the day of the drop.
- Plan & billing mentions calmly when a library is past the plan's soft cap; nothing is refused.
- Deleting a paid account now says the plan is cancelled at once, without a refund.

## Safety and reliability

- **Rate limits** in the Cloud API, per account and per IP, stricter for checkout, account changes,
  search and upload plans; a refused request says how long to wait.
- **A press is never applied twice**: a lost answer or a double click gets the first answer back.
- No request body over 8 MB is read.
- A **security policy** for the website in report-only mode, plus HSTS and a permissions policy
  ([12](12-security-privacy-legal.md)).
- **After a deploy**, an open tab that cannot fetch a page says "SelectaDJ has been updated" with
  Reload instead of going blank; music keeps playing until you choose. A quiet "A new version is
  ready" line shows when nothing is playing.
- Every page that stops working offers Try again, Reload and Contact support with a short reference,
  which also reaches the server log so support can find it.
- **Help and support** in the account menu; Contact support on error pages, billing notices and the
  closed-account page.
- An email when a **new device signs in**, with Sign out everywhere.
- Download my data now includes saved mixes, the current mix and the library's song details.
- Settings like theme and motion are kept as your own choices only, so better defaults reach you,
  and Interface has **Reset to defaults**. The starting "Personal" workspace can be renamed once.

## The local app

- Songs in folders deeper than Windows' old 260-character limit are now found, read and played
  (#135). Nothing already in the library changes.

## Looking like SelectaDJ everywhere

- A brand kit (`web/public/brand/`): the mark, the wordmark and every image size Stripe, WorkOS,
  Google and link previews ask for.
- Stripe Checkout speaks in our words and the person's language; the customer portal is set up
  from code; our emails, error pages, link previews (including room links, which show an
  invitation and nothing private) are in the brand (#136, #137).
- What each service lets us change, and the checklist to apply in each dashboard:
  [branded-surfaces.md](../engineering/branded-surfaces.md).

## Staff console

- The admin console's pages (Overview, Jobs and workers, Accounts and billing, AI routing, Security,
  Flags, and Pilots) are walked in browser tests. The admin agent is building the rest in #134
  ([07 §7.5](07-identity-rbac-admin.md)).

## Testing

- The other database tests now run on PostgreSQL on every pull request, and `pip-audit` reports Python
  advisories ([docs/ci.md](../ci.md)).
- The full product audit, row by row: [docs/engineering/product-audit.md](../engineering/product-audit.md).

## What needs you

Every item below is also in the to-do list ([docs/todo](../todo/README.md); `python scripts/todo.py list --who owner`), which stays current as items are done.

Money, legal, and settings only you can change:

1. **Support mailbox**: make `support@selectadj.app` real and read (`web/src/support.ts`).
2. **Stripe emails**: turn off Stripe's "Failed payments" and "Canceled subscriptions" customer emails
   so nobody gets two for one event ([08 §8.6](08-billing.md)).
3. **VAT**: confirm every Stripe price includes VAT, then add "Prices include VAT" to the plan cards.
4. **Legal pages**: Terms, Privacy, refund policy, cookie wording, each at a real address; Checkout
   asks people to agree to "the subscription terms" without a link today.
5. **Refunds on deletion**: decide whether deleting a paid account owes a prorated refund.
6. **Cloudflare in front of the API**: only Cloudflare may reach the API (the rate limits trust its
   visitor address), and add Cloudflare rate rules on top.
7. **Security policy**: after a week with no reports, switch the report-only policy to enforced.
8. **CI**: make `pip-audit` a required check once it is green.
9. **Branded surfaces**: apply the dashboard checklist in `docs/engineering/branded-surfaces.md`;
   the WorkOS custom domain costs $99 a month, Cloudflare custom error pages need a paid plan,
   and a Stripe custom domain is optional and paid.
10. **Restore drill**: run the staging backup restore, which also proves a rollback.
11. From the launch checklist ([launch-operator-checklist.md](launch-operator-checklist.md)),
    still open: Sentry and Grafana setup, choosing Resend or Postmark, a status page, scheduling
    backups, the DMCA agent date, phone alerts, the model and lyrics licences (S-KEY, Demucs,
    LRCLIB), a UK music and IP lawyer, UK GDPR and DPIA work, the deploy credential broker, and
    verifying staging against real accounts.
