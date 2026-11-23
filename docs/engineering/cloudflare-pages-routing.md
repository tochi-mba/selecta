# Cloudflare Pages deep-link routing

SelectaDJ's Cloudflare Pages deployment serves a React app at `/` and three small,
separate HTML entries: the anonymous guest page, room display and kiosk player.
Vite's `roomPages()` development middleware is **not deployed** to Cloudflare.
The CDN requires `web/public/_redirects`, which Vite copies into its output.

| Public route | HTML entry | Purpose |
| --- | --- | --- |
| `/r/:code` (also trailing slash) | `guest.html` | Anonymous guest joins, requests, votes |
| `/display` (also trailing slash) | `display.html` | Paired room display |
| `/kiosk` (also trailing slash) | `kiosk.html` | Venue kiosk |

These are Cloudflare Pages HTTP 200 **internal proxies**: the guest URL must remain
`/r/CODE` so `guest/main.ts` can read the room code from `location.pathname`.
Guests do not need sign-in; the API handles their scoped HttpOnly cookie.

**The guest route must proxy to the extensionless `/guest` target, not
`/guest.html`.** Cloudflare Pages automatically redirects a direct request for
`/guest.html` to canonical `/guest`. If an internal rewrite exposes that
redirect, the browser leaves `/r/CODE` and the guest script shows "No room
code" even though the QR and text link are correct. The source path must stay
`/r/:code`, and `200` must not change to a 3xx. The display/kiosk rewrite
targets are unchanged by this room-link fix.

## Build and regression checks

Every `vite build` using `roomPages()` verifies its **published output** via
`writeBundle`. A missing `_redirects`, missing dedicated HTML entry or incorrect
rule fails the build. Run `pnpm test -- src/guest/pagesRoutes.test.ts` for route
contract unit tests. The `pnpm e2e:cloud` guest suite verifies deep links,
anonymous joining and reloads. The browser test also asserts the URL pathname
remains `/r/CODE` before joining, after joining and after refreshing, while
the route-contract test rejects `.html` destinations.

The Cloud E2E Python server has its own `/r/{code}` mapping to `guest.html`.
Those tests alone do **not** check Cloudflare Pages routing; the build contract
and the post-deployment check cover that gap.

## Check staging after Cloudflare Pages publishes

Run after the Pages build completes (which need not be simultaneous with the
separately deployed Render API):

```sh
python infra/deploy/smoke.py \
  --api https://api.staging.selectadj.app \
  --gateway https://gateway.staging.selectadj.app \
  --web https://app.staging.selectadj.app
```

The optional `--web` makes anonymous GET requests to `/r/K7QDM2XP`,
`/display` and `/kiosk`, verifying the dedicated HTML instead of the
React shell. It also fails on a `301/302` response to `/guest`; the failure
output includes the `Location` header. This dummy room code does not join a
room or modify any data.
Follow it with a manual test of a real room QR from a phone in a fresh
browser session.

Cloudflare Pages `_redirects` do not apply to requests handled by
Pages Functions. If adding Functions later, verify their route coverage
and migrate these rewrites as needed.
