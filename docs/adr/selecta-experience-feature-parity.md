# Selecta — experience-first feature-preservation map

**Design proposal only; feature parity not yet independently verified at baseline `6638ec2313ce53843adfaf363306f8e79c4c8c7e`.** Keep the existing [Selecta 4.0 feature-parity map](selecta-4-feature-parity.md) as a complementary source-backed checklist.

| Existing source-observed capability | Proposed placement | New ADR | Invariants |
|---|---|---|---|
| Listen, persistent player, lyrics, spectrum, Stage, media keys, steering | Music-first Listen plus optional DJ controls | 0115–0116 | One audio owner, no surprise resume or lost advanced control |
| Explore featured mix, moods, Play/Edit/Save draft | Make a Mix Choose–Shape–Commit | 0117–0118 | One-press Play and all existing outcomes |
| Length, mix feel, stem frequency, five-stop energy, destination | Optional shaping | 0117 | Saved fields preserved; requested is not achieved |
| Current mix, drafts, render line, rename/copy/delete/activate | My Mixes | 0119 | Render line not playback queue; correct scopes and Undo |
| Add/reorder/remove/lock, song vs seam, preview, inspector | Arrangement editor | 0120–0121 | Stable revision/IDs, keyboard and touch alternatives, accurate render |
| Full Stem Studio eight lanes and variable grid (up to 64 cells) | Shape + Detailed | 0122 | No information loss; exact recovery and Apply |
| URL-backed Library search, filters, pagination, corrections, priority/Never play | Library contextual controls | 0123 | 20k scale, deep refresh and original-file protection |
| Requests, planning, bridge consent, cancel, force and join | Request lifecycle | 0124 | Atomic idempotent insertion and no invented ETA |
| Word links, harmonic auditions, feedback and adding pairs | Music discovery | 0125 | Audition order and pair/render identity |
| Local path setup, scanning and readiness | Browser-first onboarding | 0126, 0134 | Keep current backend path and privacy/security, no desktop work |
| Frozen FLAC export, job status, downloads | Exact-scope Export/Activity | 0127 | Decoded output matches frozen mix/draft revision |
| Sources, analysis, storage, learning, diagnostics, settings | Quiet Workspace | 0128 | Job state truth and source/path safety |
| Blind A/B study | Neutral Learning | 0129 | No method disclosure, once-only identity |
| Themes, CSS, controls, focus, overlays, Undo, screen sizes | Shared foundation | 0130–0132 | Both themes, accessible focus, route/media continuity |
| User acceptance, scale, visual, human audio, rollback | Release gate | 0133 | Exact SHA, actual evidence, no P0 |
| Possible future SaaS | Separate future programme, not existing UI work | 0134 | No desktop packaging; no SaaS implementation now |

**Scope prohibits** backend/audio/schema rewrites without a new decision, remote asset tracking, desktop launchers/native pickers, SaaS accounts, cloud library, uploads and migration. Preserve old routes and preferences until separately accepted changes are proven safe. Every control, including obscure menus, must be inventoried per EX-0114-04 before a redesign claims parity.
