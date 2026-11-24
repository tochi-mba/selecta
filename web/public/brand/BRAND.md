# SelectaDJ brand kit

One place for every logo, colour and image a service asks for, so Stripe, WorkOS, Google, our
emails and link previews all look like SelectaDJ. The PNGs are made from the SVGs by
`node web/scripts/brand-kit.mjs` (from `web/`); change an SVG, run it again, commit both.

## Name

**SelectaDJ**, one word, capital S, D and J. "A REX Technologies product" where a company name is
asked for. Never "Selecta" alone in anything a customer sees.

## Colours (from `web/src/styles/tokens.css`)

| Role | Dark (the default) | Light |
|---|---|---|
| Page background | `#100f0c` | `#f5f2e9` |
| Panel | `#1a1814` | `#fffdf6` |
| Text | `#f4f0e4` | `#16140e` |
| Soft text | `#a8a292` | `#6a6555` |
| Brand accent (the lime) | `#e8ff3a` | `#e8ff3a` as a fill, always with dark ink `#14140a` and a `#16140e` edge |
| Ink on the lime | `#14140a` | `#14140a` |
| Links in Light | | `#2b2a14` |

The lime is a fill, never text on a light background (it fails contrast there).

## Type

Headings: Arial Black (falls back to Helvetica Neue, Impact). Body: the system font (Segoe UI,
Roboto, San Francisco). Where a service only offers a list: **Inter** on WorkOS (Google Fonts) and
`inter` on Stripe Checkout, the closest neutral sans.

## Shape

Rounded corners, 10px on cards and 8px on controls; pill shapes only for small chips. On Stripe
choose "Rounded"; on WorkOS a corner radius of 8.

## Files and where each goes

| File | Size | Where |
|---|---|---|
| `mark.svg` | any | The app icon: favicon, installable app, everywhere a square mark is asked for |
| `mark-disc.svg` | any | The mark without its square, for use on a coloured background |
| `wordmark-light.svg`, `wordmark-dark.svg` | 1280x320 | The logo with the name, transparent, for light and dark backgrounds |
| `png/favicon-16.png`, `-32`, `-64` | 16, 32, 64 | Browser tabs; WorkOS favicon (64) |
| `png/apple-touch-icon-180.png` | 180 | iPhone and iPad home screen |
| `../icons/selecta-192.png`, `-512.png` | 192, 512 | The installable app (`manifest.webmanifest`) |
| `png/stripe-icon-512.png` | 512 | Stripe, Settings, Branding: **Icon** |
| `png/stripe-logo-1280x320.png` | 1280x320 | Stripe, Settings, Branding: **Logo** |
| `png/workos-logo-light-1280x320.png` | 1280x320 | WorkOS, Branding: **Logo** |
| `png/workos-logo-dark-1280x320.png` | 1280x320 | WorkOS, Branding: Logo for dark mode (if offered; otherwise use custom CSS) |
| `png/workos-logo-icon-512.png` | 512 | WorkOS, Branding: **Logo icon** |
| `png/google-consent-120.png` | 120 | Google Cloud, OAuth branding: **App logo** |
| `png/email-logo-96.png` | 96 | Our own emails |
| `png/social-card-1200x630.png` | 1200x630 | Link previews of the app and the welcome page (Open Graph, Twitter) |
| `png/room-card-1200x630.png` | 1200x630 | Link preview of a room link (`/r/{code}`): an invitation, no private data |

Where each is set, field by field, is in `docs/engineering/branded-surfaces.md`.
