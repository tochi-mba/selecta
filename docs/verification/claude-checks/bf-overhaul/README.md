# BF overhaul: before and after captures (W6)

Machine captures, taken by Claude on 2026-11-18 on the owner's Windows machine in headless Edge,
muted, reduced motion asked for, animations disabled, times and canvases masked. They are
**candidates for a person to review**, never approval and never compared as goldens
(the S3-0075 and P0132 specs refuse a golden folder on purpose). Nobody has reviewed these
pairs yet; the review notes below are the capturing agent's own reading of each pair.

- **Before:** commit `2759e00e`, the last commit before the overhaul's UI waves (W1 sheets,
  W2 primitives, W3 to W5 adoption). Built and served from its own worktree with its own server.
- **After:** the branch head when the captures were taken (the commit that adds this folder,
  plus the regeneration commit after it).
- Widths: 375px (phone) and 1440px or 1280px (desktop), Light and Dark, full page.

## How they were made

| Set | Spec | Command |
|---|---|---|
| `before/cloud`, `after/cloud` | `web/e2e-cloud/bf-overhaul-captures.cloud.ts` | `BF_CAPTURE=1 pnpm exec playwright test -c playwright.cloud.config.ts e2e-cloud/bf-overhaul-captures.cloud.ts` |
| `before/local`, `after/local` | `web/e2e/visual-baseline.e2e.ts` | `VITE_SELECTA_GALLERY=1 pnpm exec vite build --outDir <dist>`, then `SELECTA_E2E_DIST=<dist> pnpm exec playwright test e2e/visual-baseline.e2e.ts` |

The before cloud run used the same capture spec copied into the old worktree. The old build has
no `cloud.hosted_shell` flag, so its `cloud-hosted-shell` captures show the legacy rail: that pair
is the flag-on shell against what the same account saw before.

## Review notes, per surface

| Surface | Files | What changed, on purpose | Look for |
|---|---|---|---|
| Cloud Overview (legacy rail) | `cloud-home-*` | W1 re-expanded cloud.css onto tokens: headings take the display face, eyebrows the one eyebrow role, the rail its 212px shell width, the brand mark is the shared lime `BrandMark` badge; radii and type steps come from the scale | the eyebrow face change is the biggest visible shift; check it reads as a label, not a heading |
| Cloud Library, Add music, Settings, Plan and billing | `cloud-library-*`, `cloud-upload-*`, `cloud-account-*`, `cloud-billing-*` | the same token pass; Settings gains ConfirmDialog for the danger actions (closed in the capture) and the device sign-out words | long email and file names at 375px; meters on the Meter primitive |
| Hosted shell, flag on | `cloud-hosted-shell-*` | W4: the hosted pages inside the shared shell (bottom bar on a phone, side rail on desktop) instead of the legacy Cloud rail | before shows the legacy rail (no flag in that build) |
| Staff console overview | `admin-overview-*` | admin.css onto tokens (W1); the DataTable rules moved to foundation.css (W6) with no change in look | table edges and the 640px stack |
| Rooms and devices (harness) | `rooms-devices-*` | RoomPanel and DevicesPanel buttons onto Action with ConfirmDialog (W3); the harness page now loads the Cloud site's sheets (it imports the cloud gallery's sheet list), so it looks like the real Cloud page instead of half-styled | the harness gaining the shared sheets is a test-page change, not a product change |
| Guest page | `guest-join-*` | the eyebrow is sentence-case "SelectaDJ room" source text shown in capitals by CSS (it said "SELECTA ROOM"); the mini-palette is re-derived from tokens.css and now guarded by palette-drift.test.ts | the only visible change is the eyebrow words |
| Room display | `display-pairing-*` | the same eyebrow fix ("SelectaDJ display", "Scan to request a song" in source, capitals by CSS) | no other change expected |
| Local app pages | `local/*` (explore, listen, my-mixes, editor, library, workspace) | W1 token and type-scale pass on the shared sheets, exit motion, 44px coarse-pointer targets; W5 route focus to the page heading | the captures are taken as the page first paints, so several show skeletons; compare geometry, not content |
| Local component gallery | not captured as a pair | new in W6 (every ui export, all 11 status kinds, all 10 skeletons, compact density); it has no before | measured by `web/e2e/mp-0279-component-gallery.e2e.ts` instead |
| Cloud harness gallery | not captured as a pair | new in W6 (`/harness?page=gallery`) | measured by `web/e2e-cloud/mp-0279-cloud-gallery.cloud.ts` and the axe pass in `bf-accessibility.cloud.ts` |

## Regenerated candidate sets

The regeneration commit after this folder reruns the three candidate specs on the gallery build
(`VITE_SELECTA_GALLERY=1`): `web/e2e/visual-baseline.e2e.ts` (its images are `after/local`),
`web/e2e/s3-0075-visual-regression.e2e.ts` and `web/e2e/polish-p0132-baselines.e2e.ts`. Their
images stay test artifacts, as those specs require; the P0132 manifests and the list of every
candidate produced are kept in `regenerated/`.
