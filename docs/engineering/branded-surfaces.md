# Branded surfaces

Wherever a customer leaves SelectaDJ (to pay, to sign in) or gets something a service sends on our
behalf (a receipt, a password reset, an error page), it should look and read like SelectaDJ. This
page lists every such surface: what can be customised, how, on which plan and at what cost, what is
built in the repo, and, at the end, an ordered checklist for each dashboard.

Facts are from each vendor's official documentation, read on 2026-11-24 (sources at the foot).
The images and colours are in the brand kit, `web/public/brand/` (see `BRAND.md` there).

## Recommendations

- **Stripe: keep hosted Checkout, branded.** Hosted Checkout takes our icon, logo, colours,
  font and corner shape, our words (`custom_text`), the person's language, Stripe Tax, VAT ids,
  3D Secure and wallets, and keeps us out of most card-data compliance scope. Embedded Checkout
  (`ui_mode=embedded_page`) keeps the customer on our page but needs a new page, a `return_url`
  flow instead of `success_url`/`cancel_url`, Stripe.js in our bundle (and in our security policy)
  and changes to the return handling we have tested; it gains only the address bar. Elements
  (`ui_mode=elements`) is a full custom build and loses `custom_text`, `custom_fields` and
  branding settings. Revisit embedded once the hosted flow is proven with paying customers. A
  custom domain (`pay.selectadj.app`) is the cheaper way to keep our name in the address bar; it
  is a paid Stripe feature (price on Stripe's pricing page).
- **WorkOS: keep hosted AuthKit, branded, with a custom domain in production.** AuthKit's branding
  covers logo, icon, favicon, four colours each for light and dark, corner radius, a Google font,
  copy on the sign-in and sign-up pages, a split layout with our own panel and custom CSS on every
  AuthKit page (MFA and error pages included). Building our own sign-in on the API would lose bot
  detection, automatic SSO routing, automatic translation and the Radar challenge, and makes every
  flow (verification, reset, invitations, MFA, Google) ours to build and secure. The custom domain
  (`auth.selectadj.app`) costs **$99 a month** while configured (staging is free); the launch
  checklist already expects it.
- **Sign-in providers at launch:** email and password plus **Google** only. Apple, GitHub and
  Microsoft add setup, review and support for few music listeners; turn them off in production
  until someone asks. Google needs brand verification (below) or the consent screen shows only
  our domain, not our name and logo.

## Stripe

| Surface | What can be set | How | Cost |
|---|---|---|---|
| Checkout, portal, invoices, receipts, emails | Icon (square, at least 128 px, under 512 KB), logo (non-square), brand colour, accent colour; portal also background and button colour, font, shapes | Dashboard, Settings, Branding | Free |
| Checkout, per session | `branding_settings` (background and button colour, border style, display name, font, icon, logo) | API; **not used**: it needs a recent API version, and the dashboard branding already applies | Free |
| Checkout words | `custom_text[submit]`, `[after_submit]`, `[terms_of_service_acceptance]` (up to 1,200 characters, Markdown links) | API. **Built**: `src/selecta/billing/branding.py` | Free |
| Checkout language | `locale=auto` | API. **Built** | Free |
| Terms checkbox | `consent_collection[terms_of_service]=required`, needs a Terms address in Public details | API, behind `SELECTA_TERMS_URL` and `SELECTA_STRIPE_TERMS_CONSENT=1`. **Built, off** until Terms exist | Free |
| Custom fields | `custom_fields` (up to 3) | API; **not used**: nothing more to ask | Free |
| Customer portal | `business_profile.headline`, `privacy_policy_url`, `terms_of_service_url`, `default_return_url`, features (update details, invoices, card, cancel at period end with reasons, switch between our prices) | API. **Built**: `selecta billing-portal-setup` creates or updates it (found again by its metadata), then set `SELECTA_STRIPE_PORTAL_CONFIGURATION` and `/api/billing/portal` uses it | Free |
| Customer emails | Successful payments, refunds, payment confirmation (3D Secure link), failed payments, renewal reminders, expiring cards, trial reminders | Dashboard, Settings, Customer emails and revenue recovery. Which ones Stripe sends and which we send: `docs/saas/08-billing.md` §8.6 | Free |
| Invoices | Default memo, footer, numbering prefix, up to four custom header fields, PDF page size, tax ids | Dashboard, Settings, Billing, Invoices | Free |
| Public details | Public business name, statement descriptor, support email, phone, address, website, privacy and terms links | Dashboard, Settings, Public details | Free |
| Custom domain | One subdomain for Checkout, Payment Links and the portal (CNAME to `hosted-checkout.stripecdn.com`, a TXT check, CAA allows Let's Encrypt) | Dashboard, Settings, Custom domains; then set `SELECTA_STRIPE_CUSTOM_DOMAIN` so the API accepts the new host. **Built** (the setting) | **Paid** (see Stripe pricing) |

## WorkOS AuthKit

| Surface | What can be set | How | Cost |
|---|---|---|---|
| Sign-in, sign-up, magic code, MFA, email verification, invitation, reset, not found, auth disabled | Logo (at least 160 px, 100 KB), logo icon, favicon, display name, page background, button background, button text and link colours for light and dark, corner radius, light, dark or follow the device, a Google font, sign-up name fields, "last used" badge, privacy and terms links | Dashboard, Branding (per environment) | Free |
| Copy | Page title and link text on sign-in and sign-up, translated automatically | Dashboard, Branding preview | Free |
| Layout | One column, or split with our own HTML panel (no scripts or styles) | Dashboard, Branding | Free |
| Every AuthKit page | Custom CSS, per page by `data-hak-page`; dark mode by `light-dark()` or `.dark-theme` | Dashboard, Branding, Custom CSS | Free |
| Emails (verification, reset, magic code, invitation, email change) | Branding colours, logo and display name apply; custom CSS does not. Or turn the defaults off and send our own from the `*.created` events | Dashboard, Emails; our own sending would be a new piece of work | Free; our sending would use our email provider |
| Custom domain | `auth.selectadj.app` for the hosted pages, and email and API domains | Dashboard, Domains (CNAME, DNS only on Cloudflare until verified) | **$99 a month** in production |

## Google sign-in

The consent screen shows our name and logo only after **brand verification** ("usually a few
minutes" for apps with only basic scopes); without it, people see only our domain. It needs: app
name "SelectaDJ", logo (square, 120 px, under 1 MB: `google-consent-120.png`), a support email
(a Google account or Group we manage), the authorised domain `selectadj.app`, and homepage,
privacy and terms links on that domain (the homepage must describe the app, not only sign in; the
privacy link must match the one on the homepage). **Blocked on the legal pages.**

## Cloudflare

| Surface | What can be set | How | Cost |
|---|---|---|---|
| 4xx, 1xxx, WAF block, rate-limit and challenge pages | Our own HTML, fetched once from a URL and stored by Cloudflare (under 1.5 MB, everything inline) | Dashboard, Error Pages; for 5xx a Custom Error Rule (Error Pages do not cover 500, 501, 503, 505) | **Paid plan** (Pro or above) |
| Our pages | `infra/cloudflare/error-pages/`: 5xx, 1xxx, blocked, rate-limited, challenge (with `::CF_WIDGET_BOX::`), made by `build.py` and published under `https://app.selectadj.app/errors/` for Cloudflare to fetch. **Built**. Screenshots: `branded-surfaces/cloudflare-5xx-light.png`, `-dark.png`, `cloudflare-rate-limited-*.png` | | |
| Pages 404 | The app's own designed "Page not found" (the site falls back to the app for unknown paths) | Already built | Free |

## Render

Paid web services deploy with no downtime: the old instance answers until the new one passes its
health check, and a failed build never replaces it. A **maintenance mode** (paid services) answers
503 to every request and may point to a custom static page. The app already says
"SelectaDJ is being updated and is back in a moment. Anything playing keeps playing." for a 503 with
no words of its own (`web/src/cloud/api.ts statusWords`), and the deploy panel covers a tab whose
page files changed. Recommendation: point maintenance mode at `https://app.selectadj.app/errors/5xx.html`
if it is ever used.

## Email

Our own emails (`src/selecta/notify/`) are now in the brand: the mark and name, one card, one lime
button with dark ink, the footer naming REX Technologies, a text version, and
`color-scheme: light dark` so mail apps may adapt them. Screenshot:
`branded-surfaces/email-payment-failed-light.png` (the logo shows once the site is live at
`app.selectadj.app`). Not checked in real mail clients yet.

Sender: `SelectaDJ <support@selectadj.app>` or a `notifications.selectadj.app` subdomain. DNS:
Postmark wants a DKIM TXT and a Return-Path CNAME (`pm_bounces` to `pm.mtasv.net`); Resend gives
DKIM and SPF records (TXT and MX or CNAME, not proxied on Cloudflare). Add DMARC (`p=none` to
start) after verification. Our emails are transactional, so no unsubscribe page is needed;
marketing email, if ever sent, needs one.

## Our own defaults (built)

- Tab title "SelectaDJ"; favicon SVG with a 32 px PNG fallback; Apple touch icon 180 px.
- Installable app: `manifest.webmanifest` with the 192 and 512 icons (regenerated from the kit).
- Link previews: Open Graph and Twitter card for the app (`social-card-1200x630.png`) and, for
  every room link, one invitation card (`room-card-1200x630.png`) that names no room, host or song;
  room pages are `noindex`.
- `robots.txt`: only the welcome page is for search engines; room links, accounts, admin,
  business, display, kiosk and error pages are not.
- A plain message for a browser with JavaScript off, on the app and on room links.
- The API host answers unknown paths with JSON 404 and no page; nothing to brand there.

## Dashboard checklist

In this order. Nothing here has been changed; each step is for the owner (or with their go-ahead).

### Stripe (dashboard.stripe.com, test mode first, then live)

1. **Settings, Branding.** Icon: `web/public/brand/png/stripe-icon-512.png`. Logo:
   `png/stripe-logo-1280x320.png`. Brand colour `#16140e`. Accent colour `#e8ff3a`. Checkout and
   portal: background `#f5f2e9`, button `#16140e`, font Inter, shape Rounded. Email receipts tab:
   same icon and colours.
2. **Settings, Public details.** Public business name "SelectaDJ"; statement descriptor
   "SELECTADJ" (5 to 22 characters); support email `support@selectadj.app`; website
   `https://selectadj.app`; privacy and terms links once published.
3. **Settings, Checkout.** Support contact and the same policy links.
4. **Settings, Billing, Invoices.** Memo "Thank you for using SelectaDJ." Footer
   "SelectaDJ is a REX Technologies product. Questions: support@selectadj.app". Numbering:
   account-level prefix `SDJ`.
5. **Settings, Customer emails.** As `docs/saas/08-billing.md` §8.6: receipts and refunds on,
   3D Secure link on, expiring cards on, **failed payments off**, cancelled subscriptions off.
6. **Customer portal.** Run `selecta billing-portal-setup` with the Stripe key (test, then live)
   and set `SELECTA_STRIPE_PORTAL_CONFIGURATION` on the API to the id it prints.
7. **Custom domain (optional, paid).** `pay.selectadj.app`: add the CNAME and TXT in Cloudflare
   (DNS only), then set `SELECTA_STRIPE_CUSTOM_DOMAIN=pay.selectadj.app` on the API.
8. **Terms box.** Once Terms are published: set `SELECTA_TERMS_URL` and
   `SELECTA_STRIPE_TERMS_CONSENT=1` on the API.

### WorkOS (dashboard.workos.com, staging then production)

1. **Branding.** Logo `png/workos-logo-light-1280x320.png`; logo icon `png/workos-logo-icon-512.png`;
   favicon `png/favicon-64.png`; display name "SelectaDJ"; appearance: follow the device.
   Light: page `#f5f2e9`, button `#e8ff3a`, button text `#14140a`, link `#2b2a14`. Dark: page
   `#100f0c`, button `#e8ff3a`, button text `#14140a`, link `#e8ff3a`. Corner radius 8. Font Inter.
2. **Copy.** Sign-in title "Sign in to SelectaDJ"; sign-up title "Make your SelectaDJ account".
3. **Custom CSS** (for the dark logo, since only one logo is offered):
   `.dark-theme [data-hak-logo] img { content: url(https://app.selectadj.app/brand/png/workos-logo-dark-1280x320.png); }`
   (check the selector in the preview pane first).
4. **Links.** Privacy and terms once published.
5. **Authentication methods (production).** Email and password, and Google. Turn off Apple,
   GitHub and Microsoft.
6. **Domains (production, $99 a month).** `auth.selectadj.app` (and the email domain), CNAME in
   Cloudflare as DNS only until verified; the website build's `VITE_WORKOS_API_HOSTNAME` matches.

### Google Cloud (console.cloud.google.com, the OAuth client WorkOS uses)

1. **Branding.** App name "SelectaDJ"; logo `png/google-consent-120.png`; support email; app
   domain links (home, privacy, terms); authorised domain `selectadj.app`.
2. **Verify branding**, then **Publish branding** within 7 days.

### Cloudflare (dash.cloudflare.com, the `selectadj.app` zone, Pro plan or above)

1. **Error Pages**: for each of 1xxx, WAF block, rate limiting and challenge, "Fetch from URL"
   `https://app.selectadj.app/errors/1xxx.html`, `blocked.html`, `rate-limited.html`,
   `challenge.html`.
2. **Custom Error Rule** for status 500 to 599 on `app.selectadj.app` and `api.selectadj.app`,
   serving the asset made from `https://app.selectadj.app/errors/5xx.html`.

### Email provider

1. Add the sending domain, then the DKIM, SPF or Return-Path records it shows (DNS only), then
   DMARC `v=DMARC1; p=none; rua=mailto:support@selectadj.app`.
2. Sender `SelectaDJ <support@selectadj.app>`; set `SELECTA_EMAIL_FROM` to match.

### Costs and owner steps

- WorkOS custom domain: **$99 a month** (production).
- Stripe custom domain: **paid**, optional.
- Cloudflare custom error pages: **a paid plan** (Pro or above).
- Domain checks the owner must complete: WorkOS domains, the email domain, the Stripe custom
  domain if chosen, Google's authorised domain.
- Blocked on legal pages: Stripe terms box and portal links, WorkOS links, Google branding.

## Sources

docs.stripe.com: checkout sessions create, checkout custom components, configure the customer
portal, portal configurations create and portal sessions create, custom domains, invoicing
customize, receipts, revenue recovery customer emails. workos.com/docs: authkit/branding,
custom-domains (and authkit), email-verification, authkit/custom-emails, authkit/hosted-ui;
workos.com/pricing. support.google.com/cloud answers 15549049 and 13463073.
developers.cloudflare.com: custom pages and error rules. render.com/docs: deploys, free,
maintenance-mode, health-checks. postmarkapp.com support article 1046; resend.com domains docs.
