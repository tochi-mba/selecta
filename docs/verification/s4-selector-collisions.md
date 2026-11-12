# Selecta 4.0 selector-collision inventory (S4-0091-04)

Generated from the sheets `web/src/main.tsx` loads by `python -m selecta.audit.selector_collisions --write`; `tests/test_s4_selector_collisions.py` fails when it falls behind. Load order: `style.css`, `styles/shell.css`, `styles/polish.css`, `styles/foundation.css`, `styles/listening.css`, `styles/creation.css`, `styles/operations.css`, `styles/music-objects.css`, `styles/glossary.css`, `styles/palette.css`, `styles/icons.css`, `styles/depth.css`, `styles/typography.css`. The proposed owner is the earliest sheet that styles the class unscoped, else the earliest that styles it. Verdicts for the seven shared class names are in `docs/adr/completion/css-ownership.md`. Rules inside media queries count, so a responsive refinement shows here too; each row is for review, not a defect.

## Identical selectors in more than one sheet (167)

| Selector | Sheets, in load order | Wins the cascade |
|---|---|---|
| `*` | style.css, styles/polish.css | styles/polish.css |
| `.artist` | style.css, styles/shell.css | styles/shell.css |
| `.card` | style.css, styles/polish.css | styles/polish.css |
| `.card h3` | style.css, styles/polish.css | styles/polish.css |
| `.carry-on` | style.css, styles/listening.css | styles/listening.css |
| `.carry-on h2` | style.css, styles/listening.css | styles/listening.css |
| `.choice` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.content > main.page` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.context-bar .count` | styles/shell.css, styles/icons.css | styles/icons.css |
| `.correct-field` | styles/shell.css, styles/operations.css | styles/operations.css |
| `.correct-field input` | styles/shell.css, styles/operations.css | styles/operations.css |
| `.countdown-meta` | style.css, styles/typography.css | styles/typography.css |
| `.countdown-number` | style.css, styles/polish.css | styles/polish.css |
| `.countdown-number span` | style.css, styles/typography.css | styles/typography.css |
| `.discovery` | style.css, styles/operations.css | styles/operations.css |
| `.discovery .hint` | style.css, styles/operations.css | styles/operations.css |
| `.discovery h3` | style.css, styles/operations.css | styles/operations.css |
| `.discovery-steps button[aria-current='step']` | style.css, styles/operations.css | styles/operations.css |
| `.display` | style.css, styles/shell.css | styles/shell.css |
| `.draft` | style.css, styles/polish.css | styles/polish.css |
| `.draft-actions` | style.css, styles/listening.css | styles/listening.css |
| `.draft-name` | style.css, styles/listening.css | styles/listening.css |
| `.drafts-head` | style.css, styles/listening.css | styles/listening.css |
| `.edit-inspector` | styles/shell.css, styles/creation.css | styles/creation.css |
| `.editor-scope` | styles/creation.css, styles/typography.css | styles/typography.css |
| `.editor-scope .status` | styles/creation.css, styles/typography.css | styles/typography.css |
| `.energy-arc-stops label` | style.css, styles/listening.css | styles/listening.css |
| `.energy-overview button` | styles/creation.css, styles/music-objects.css | styles/music-objects.css |
| `.eyebrow` | style.css, styles/polish.css | styles/polish.css |
| `.facts` | style.css, styles/polish.css | styles/polish.css |
| `.folder-list b` | styles/shell.css, styles/operations.css | styles/operations.css |
| `.folder-list li` | styles/shell.css, styles/operations.css | styles/operations.css |
| `.hint` | style.css, styles/polish.css | styles/polish.css |
| `.inspector-head` | styles/shell.css, styles/creation.css | styles/creation.css |
| `.inspector-identity` | styles/creation.css, styles/typography.css | styles/typography.css |
| `.inspector-pair` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.inspector-tabs button` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.inspector-tabs button[aria-selected='true']` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.library-count` | styles/shell.css, styles/typography.css | styles/typography.css |
| `.library-find` | styles/shell.css, styles/polish.css, styles/operations.css | styles/operations.css |
| `.library-rows.library-cards` | styles/operations.css, styles/music-objects.css | styles/music-objects.css |
| `.line-controls` | style.css, styles/listening.css | styles/listening.css |
| `.line-place` | style.css, styles/listening.css | styles/listening.css |
| `.link-handoff q` | style.css, styles/operations.css | styles/operations.css |
| `.link-handoff span` | style.css, styles/operations.css | styles/operations.css |
| `.lyrics` | style.css, styles/listening.css | styles/listening.css |
| `.lyrics .current-word` | style.css, styles/foundation.css | styles/foundation.css |
| `.lyrics p` | style.css, styles/listening.css | styles/listening.css |
| `.menu-list` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.metrics strong` | style.css, styles/polish.css | styles/polish.css |
| `.mini-song` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.mini-song b` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.mini-song span` | styles/shell.css, styles/typography.css | styles/typography.css |
| `.mix-head` | style.css, styles/polish.css, styles/creation.css | styles/creation.css |
| `.mix-head .lede` | style.css, styles/typography.css | styles/typography.css |
| `.music-visualizer` | style.css, styles/listening.css | styles/listening.css |
| `.nav .count` | styles/shell.css, styles/icons.css | styles/icons.css |
| `.nav a[aria-current='page']` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.nav li a` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.nav-collapse` | styles/shell.css, styles/icons.css | styles/icons.css |
| `.next-song` | style.css, styles/polish.css | styles/polish.css |
| `.next-song b` | style.css, styles/polish.css, styles/listening.css | styles/listening.css |
| `.next-song span` | style.css, styles/listening.css | styles/listening.css |
| `.now .transport` | styles/polish.css, styles/listening.css | styles/listening.css |
| `.overlay-body` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.overlay-close` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.overlay-head` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.overlay-head h2` | styles/shell.css, styles/typography.css | styles/typography.css |
| `.overlay-panel` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.page` | style.css, styles/polish.css | styles/polish.css |
| `.palette-item.on` | styles/foundation.css, styles/palette.css | styles/palette.css |
| `.panel` | style.css, styles/polish.css | styles/polish.css |
| `.phrase` | style.css, styles/operations.css | styles/operations.css |
| `.primary` | style.css, styles/foundation.css | styles/foundation.css |
| `.problem` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.request-approve` | style.css, styles/listening.css | styles/listening.css |
| `.request-cancel` | style.css, styles/listening.css | styles/listening.css |
| `.request-name b` | style.css, styles/listening.css | styles/listening.css |
| `.request-name span` | style.css, styles/listening.css | styles/listening.css |
| `.request-pair` | style.css, styles/listening.css | styles/listening.css |
| `.request-preview` | style.css, styles/listening.css | styles/listening.css |
| `.request-preview button` | style.css, styles/listening.css | styles/listening.css |
| `.request-row.attention` | style.css, styles/polish.css | styles/polish.css |
| `.request-row.stuck` | style.css, styles/depth.css | styles/depth.css |
| `.row.wrap` | style.css, styles/polish.css | styles/polish.css |
| `.seam` | style.css, styles/shell.css | styles/shell.css |
| `.seam-line` | style.css, styles/shell.css | styles/shell.css |
| `.seam-visual` | style.css, styles/shell.css | styles/shell.css |
| `.seam-visual-bars` | style.css, styles/shell.css | styles/shell.css |
| `.seam-visual-caption` | style.css, styles/shell.css | styles/shell.css |
| `.seam-visual-label` | style.css, styles/shell.css | styles/shell.css |
| `.seam.open` | style.css, styles/shell.css | styles/shell.css |
| `.skeleton` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.skeleton i` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.skeleton i:nth-child(2n)` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.song` | style.css, styles/shell.css | styles/shell.css |
| `.song-detail-artist` | styles/shell.css, styles/polish.css, styles/typography.css | styles/typography.css |
| `.song-facts dd` | styles/shell.css, styles/typography.css | styles/typography.css |
| `.song-name` | style.css, styles/shell.css, styles/polish.css | styles/polish.css |
| `.song-name b` | style.css, styles/shell.css, styles/polish.css | styles/polish.css |
| `.song-name span` | style.css, styles/shell.css | styles/shell.css |
| `.song-readiness` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.song-select` | styles/creation.css, styles/music-objects.css | styles/music-objects.css |
| `.song-select b` | styles/creation.css, styles/music-objects.css | styles/music-objects.css |
| `.song.over` | style.css, styles/shell.css | styles/shell.css |
| `.song.playing` | style.css, styles/polish.css | styles/polish.css |
| `.stage .handoff` | style.css, styles/listening.css | styles/listening.css |
| `.stage .music-visualizer` | style.css, styles/listening.css | styles/listening.css |
| `.status` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.status-blocked` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.status-failed` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.status-needs-action` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.status-ready` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.status-warning` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.strip` | style.css, styles/listening.css | styles/listening.css |
| `.strip.can-seek` | style.css, styles/listening.css | styles/listening.css |
| `.strip.can-seek:focus-visible` | style.css, styles/polish.css | styles/polish.css |
| `.studio` | style.css, styles/creation.css | styles/creation.css |
| `.studio-cell` | style.css, styles/polish.css, styles/creation.css | styles/creation.css |
| `.studio-cell.now` | style.css, styles/polish.css | styles/polish.css |
| `.studio-cell[aria-pressed='true']` | style.css, styles/polish.css | styles/polish.css |
| `.studio-cell[aria-pressed='true']::after` | styles/polish.css, styles/creation.css | styles/creation.css |
| `.studio-grid` | style.css, styles/polish.css, styles/creation.css | styles/creation.css |
| `.studio-head` | style.css, styles/creation.css, styles/typography.css | styles/typography.css |
| `.studio-lane` | style.css, styles/polish.css, styles/creation.css | styles/creation.css |
| `.studio-lane .studio-name` | style.css, styles/creation.css | styles/creation.css |
| `.studio-name` | style.css, styles/polish.css | styles/polish.css |
| `.studio-ruler span.now` | style.css, styles/creation.css | styles/creation.css |
| `.studio-side` | style.css, styles/creation.css | styles/creation.css |
| `.tabs` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.tabs a` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.time` | style.css, styles/polish.css | styles/polish.css |
| `.timeline` | style.css, styles/shell.css | styles/shell.css |
| `.timeline .song` | styles/polish.css, styles/creation.css | styles/creation.css |
| `.toast-row` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.toast-row .toast-close` | styles/shell.css, styles/icons.css | styles/icons.css |
| `.toast-row > span` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.toast-row.problem` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.toasts` | styles/shell.css, styles/polish.css | styles/polish.css |
| `.ui-icon` | styles/polish.css, styles/icons.css | styles/icons.css |
| `.vibe-card-facts` | styles/listening.css, styles/typography.css | styles/typography.css |
| `.vibe-group` | style.css, styles/polish.css, styles/listening.css | styles/listening.css |
| `.vibe-group > .eyebrow` | style.css, styles/listening.css | styles/listening.css |
| `.vibe-tempo` | styles/polish.css, styles/listening.css, styles/typography.css | styles/typography.css |
| `.warn` | style.css, styles/polish.css | styles/polish.css |
| `a.button` | styles/shell.css, styles/polish.css | styles/polish.css |
| `a.button.primary` | styles/shell.css, styles/polish.css, styles/foundation.css | styles/foundation.css |
| `a:focus-visible` | style.css, styles/polish.css | styles/polish.css |
| `body` | style.css, styles/polish.css | styles/polish.css |
| `button` | style.css, styles/polish.css | styles/polish.css |
| `button.icon` | styles/shell.css, styles/icons.css | styles/icons.css |
| `button:disabled` | style.css, styles/polish.css | styles/polish.css |
| `button:focus-visible` | style.css, styles/polish.css | styles/polish.css |
| `button[aria-pressed='true']` | style.css, styles/polish.css | styles/polish.css |
| `input:focus-visible` | style.css, styles/polish.css | styles/polish.css |
| `media (forced-colors: active)` | styles/polish.css, styles/listening.css, styles/creation.css, styles/operations.css, styles/music-objects.css, styles/glossary.css, styles/palette.css, styles/depth.css | styles/depth.css |
| `media (max-width: 1024px)` | style.css, styles/polish.css, styles/creation.css, styles/operations.css | styles/operations.css |
| `media (max-width: 1040px)` | styles/polish.css, styles/listening.css | styles/listening.css |
| `media (max-width: 420px)` | styles/shell.css, styles/polish.css, styles/listening.css | styles/listening.css |
| `media (max-width: 520px)` | style.css, styles/foundation.css, styles/listening.css | styles/listening.css |
| `media (max-width: 560px)` | style.css, styles/shell.css, styles/polish.css | styles/polish.css |
| `media (max-width: 620px)` | style.css, styles/polish.css, styles/listening.css, styles/creation.css, styles/operations.css | styles/operations.css |
| `media (max-width: 760px)` | styles/shell.css, styles/polish.css, styles/listening.css, styles/creation.css | styles/creation.css |
| `media (pointer: coarse)` | styles/creation.css, styles/glossary.css, styles/icons.css | styles/icons.css |
| `media (prefers-reduced-motion: reduce)` | style.css, styles/shell.css, styles/polish.css | styles/polish.css |
| `select` | style.css, styles/polish.css | styles/polish.css |
| `select:focus-visible` | style.css, styles/polish.css | styles/polish.css |

## Classes styled by more than one sheet (214)

| Class | Sheets, in load order | Proposed owner |
|---|---|---|
| `.action-labels` | styles/polish.css, styles/listening.css, styles/icons.css | styles/polish.css |
| `.active` | style.css, styles/depth.css | style.css |
| `.add-gap` | style.css, styles/creation.css | style.css |
| `.artist` | style.css, styles/shell.css, styles/listening.css | style.css |
| `.artists` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.attention` | style.css, styles/polish.css | style.css |
| `.big` | style.css, styles/listening.css | style.css |
| `.button` | style.css, styles/shell.css, styles/polish.css, styles/foundation.css | style.css |
| `.can-seek` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.card` | style.css, styles/polish.css, styles/depth.css | style.css |
| `.cards` | style.css, styles/listening.css | style.css |
| `.carry-on` | style.css, styles/listening.css, styles/depth.css | style.css |
| `.carry-on-words` | styles/listening.css, styles/typography.css | styles/listening.css |
| `.chips` | style.css, styles/polish.css, styles/listening.css, styles/operations.css | style.css |
| `.choice` | styles/shell.css, styles/polish.css, styles/foundation.css, styles/operations.css | styles/shell.css |
| `.coming` | style.css, styles/music-objects.css | style.css |
| `.content` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.context-bar` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.context-button` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.correct-field` | styles/shell.css, styles/operations.css | styles/shell.css |
| `.count` | style.css, styles/shell.css, styles/polish.css, styles/icons.css | styles/polish.css |
| `.countdown-meta` | style.css, styles/typography.css | style.css |
| `.countdown-number` | style.css, styles/polish.css, styles/listening.css, styles/typography.css | style.css |
| `.countdown-track` | style.css, styles/listening.css | style.css |
| `.cue-row` | style.css, styles/creation.css | style.css |
| `.current-word` | style.css, styles/foundation.css | style.css |
| `.destructive` | styles/polish.css, styles/foundation.css | styles/polish.css |
| `.discoveries` | style.css, styles/polish.css | style.css |
| `.discovery` | style.css, styles/operations.css | style.css |
| `.discovery-steps` | style.css, styles/operations.css | style.css |
| `.display` | style.css, styles/shell.css, styles/polish.css, styles/listening.css, styles/operations.css, styles/music-objects.css | style.css |
| `.done` | style.css, styles/foundation.css | style.css |
| `.draft` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.draft-actions` | style.css, styles/listening.css | style.css |
| `.draft-list` | style.css, styles/listening.css, styles/creation.css | style.css |
| `.draft-name` | style.css, styles/listening.css | style.css |
| `.draft-progress` | style.css, styles/music-objects.css | style.css |
| `.drafts-head` | style.css, styles/listening.css | style.css |
| `.edit-inspector` | styles/shell.css, styles/creation.css, styles/depth.css | styles/shell.css |
| `.editor` | style.css, styles/creation.css | style.css |
| `.editor-scope` | styles/creation.css, styles/depth.css, styles/typography.css | styles/creation.css |
| `.energy-arc-stops` | style.css, styles/listening.css | style.css |
| `.energy-overview` | styles/creation.css, styles/music-objects.css | styles/music-objects.css |
| `.energy-overview-unknown` | styles/creation.css, styles/music-objects.css | styles/music-objects.css |
| `.exit-stage` | style.css, styles/listening.css | style.css |
| `.eyebrow` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.facts` | style.css, styles/polish.css | style.css |
| `.failed` | style.css, styles/music-objects.css | style.css |
| `.field` | styles/polish.css, styles/foundation.css, styles/listening.css, styles/operations.css, styles/glossary.css | styles/foundation.css |
| `.field-help` | styles/polish.css, styles/glossary.css | styles/polish.css |
| `.focus` | style.css, styles/listening.css | style.css |
| `.folder-list` | styles/shell.css, styles/operations.css | styles/shell.css |
| `.grip` | style.css, styles/polish.css, styles/creation.css | style.css |
| `.handoff` | style.css, styles/listening.css | style.css |
| `.handoff-next` | style.css, styles/listening.css | style.css |
| `.hero` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.hint` | style.css, styles/polish.css, styles/listening.css, styles/operations.css, styles/glossary.css, styles/typography.css | style.css |
| `.how` | style.css, styles/listening.css | style.css |
| `.icon` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.in-seam` | style.css, styles/listening.css | style.css |
| `.inspector` | styles/shell.css, styles/polish.css, styles/creation.css, styles/music-objects.css | styles/shell.css |
| `.inspector-head` | styles/shell.css, styles/creation.css | styles/shell.css |
| `.inspector-identity` | styles/creation.css, styles/typography.css | styles/creation.css |
| `.inspector-pair` | styles/shell.css, styles/polish.css, styles/creation.css, styles/music-objects.css | styles/shell.css |
| `.inspector-tabs` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.is-current` | styles/creation.css, styles/depth.css | styles/creation.css |
| `.is-draft` | styles/creation.css, styles/depth.css | styles/creation.css |
| `.lede` | style.css, styles/polish.css, styles/listening.css, styles/typography.css | style.css |
| `.library` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.library-cards` | styles/operations.css, styles/music-objects.css | styles/operations.css |
| `.library-count` | styles/shell.css, styles/typography.css | styles/shell.css |
| `.library-find` | styles/shell.css, styles/polish.css, styles/operations.css | styles/shell.css |
| `.library-rows` | styles/operations.css, styles/music-objects.css, styles/depth.css | styles/operations.css |
| `.limit` | style.css, styles/operations.css | style.css |
| `.line-controls` | style.css, styles/listening.css | style.css |
| `.line-place` | style.css, styles/listening.css | style.css |
| `.link` | style.css, styles/glossary.css | style.css |
| `.link-card` | style.css, styles/operations.css | style.css |
| `.link-handoff` | style.css, styles/operations.css | style.css |
| `.lost` | styles/polish.css, styles/creation.css | styles/polish.css |
| `.lyrics` | style.css, styles/foundation.css, styles/listening.css | style.css |
| `.menu` | styles/shell.css, styles/listening.css, styles/creation.css | styles/shell.css |
| `.menu-list` | styles/shell.css, styles/polish.css, styles/foundation.css, styles/listening.css, styles/creation.css, styles/depth.css | styles/shell.css |
| `.metrics` | style.css, styles/polish.css, styles/operations.css | style.css |
| `.mini-song` | styles/shell.css, styles/polish.css, styles/typography.css | styles/shell.css |
| `.mix` | styles/shell.css, styles/creation.css | styles/shell.css |
| `.mix-head` | style.css, styles/polish.css, styles/creation.css, styles/typography.css | style.css |
| `.mixes` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.music-seam-diagram` | styles/music-objects.css, styles/depth.css | styles/music-objects.css |
| `.music-visualizer` | style.css, styles/listening.css | style.css |
| `.nav` | styles/shell.css, styles/polish.css, styles/icons.css | styles/shell.css |
| `.nav-collapse` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.nav-label` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.nav-request` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.next-song` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.next-up` | style.css, styles/listening.css, styles/typography.css | style.css |
| `.notice` | style.css, styles/listening.css | style.css |
| `.now` | style.css, styles/shell.css, styles/polish.css, styles/listening.css, styles/creation.css, styles/music-objects.css, styles/icons.css | styles/listening.css |
| `.off` | styles/foundation.css, styles/palette.css | styles/foundation.css |
| `.on` | style.css, styles/foundation.css, styles/creation.css, styles/palette.css, styles/depth.css | style.css |
| `.on-stage` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.open` | style.css, styles/shell.css, styles/creation.css | style.css |
| `.over` | style.css, styles/shell.css, styles/creation.css | style.css |
| `.overlay-body` | styles/shell.css, styles/polish.css, styles/foundation.css, styles/creation.css | styles/shell.css |
| `.overlay-close` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.overlay-dialog` | styles/shell.css, styles/glossary.css | styles/shell.css |
| `.overlay-head` | styles/shell.css, styles/polish.css, styles/typography.css | styles/shell.css |
| `.overlay-panel` | styles/shell.css, styles/polish.css, styles/glossary.css, styles/depth.css | styles/shell.css |
| `.overlay-sheet` | styles/shell.css, styles/creation.css | styles/shell.css |
| `.overlay-workspace` | styles/shell.css, styles/creation.css | styles/shell.css |
| `.page` | style.css, styles/shell.css, styles/polish.css, styles/creation.css | style.css |
| `.palette-item` | styles/foundation.css, styles/palette.css, styles/depth.css | styles/foundation.css |
| `.panel` | style.css, styles/polish.css, styles/depth.css | style.css |
| `.phrase` | style.css, styles/operations.css | style.css |
| `.pill` | style.css, styles/listening.css | style.css |
| `.playing` | style.css, styles/polish.css, styles/creation.css, styles/depth.css | style.css |
| `.popover-panel` | styles/foundation.css, styles/depth.css | styles/foundation.css |
| `.preview` | style.css, styles/shell.css | style.css |
| `.primary` | style.css, styles/shell.css, styles/polish.css, styles/foundation.css, styles/listening.css, styles/creation.css | style.css |
| `.problem` | styles/shell.css, styles/polish.css, styles/foundation.css, styles/listening.css | styles/shell.css |
| `.prominent` | styles/listening.css, styles/depth.css | styles/listening.css |
| `.quiet` | style.css, styles/listening.css | style.css |
| `.ready` | style.css, styles/music-objects.css | style.css |
| `.report` | style.css, styles/icons.css | style.css |
| `.request-approve` | style.css, styles/listening.css | style.css |
| `.request-cancel` | style.css, styles/listening.css | style.css |
| `.request-list` | style.css, styles/shell.css | style.css |
| `.request-name` | style.css, styles/listening.css | style.css |
| `.request-pair` | style.css, styles/listening.css | style.css |
| `.request-preview` | style.css, styles/listening.css | style.css |
| `.request-results` | style.css, styles/foundation.css, styles/icons.css | style.css |
| `.request-row` | style.css, styles/polish.css, styles/depth.css | style.css |
| `.request-tag` | style.css, styles/listening.css | style.css |
| `.requested` | style.css, styles/depth.css | style.css |
| `.requests` | style.css, styles/foundation.css | style.css |
| `.requests-head` | style.css, styles/foundation.css | style.css |
| `.round` | style.css, styles/shell.css | style.css |
| `.row` | style.css, styles/polish.css, styles/listening.css, styles/operations.css | style.css |
| `.seam` | style.css, styles/shell.css, styles/creation.css | style.css |
| `.seam-actions` | style.css, styles/creation.css | style.css |
| `.seam-line` | style.css, styles/shell.css | style.css |
| `.seam-name` | style.css, styles/creation.css | style.css |
| `.seam-visual` | style.css, styles/shell.css | style.css |
| `.seam-visual-bars` | style.css, styles/shell.css | style.css |
| `.seam-visual-caption` | style.css, styles/shell.css | style.css |
| `.seam-visual-label` | style.css, styles/shell.css | style.css |
| `.search-field` | styles/foundation.css, styles/operations.css | styles/foundation.css |
| `.section-title` | style.css, styles/listening.css | style.css |
| `.selected` | styles/creation.css, styles/music-objects.css, styles/depth.css | styles/creation.css |
| `.skeleton` | styles/shell.css, styles/polish.css, styles/listening.css | styles/shell.css |
| `.skeleton-library` | styles/polish.css, styles/operations.css | styles/operations.css |
| `.small` | style.css, styles/polish.css, styles/operations.css | style.css |
| `.soft` | style.css, styles/typography.css | style.css |
| `.song` | style.css, styles/shell.css, styles/polish.css, styles/creation.css, styles/depth.css | style.css |
| `.song-actions` | style.css, styles/polish.css, styles/creation.css, styles/operations.css, styles/music-objects.css | style.css |
| `.song-columns` | styles/operations.css, styles/music-objects.css | styles/operations.css |
| `.song-detail-artist` | styles/shell.css, styles/polish.css, styles/operations.css, styles/typography.css | styles/shell.css |
| `.song-facts` | styles/shell.css, styles/operations.css, styles/typography.css | styles/shell.css |
| `.song-motif` | styles/operations.css, styles/music-objects.css | styles/music-objects.css |
| `.song-name` | style.css, styles/shell.css, styles/polish.css, styles/operations.css, styles/music-objects.css, styles/depth.css | style.css |
| `.song-open` | styles/shell.css, styles/operations.css, styles/music-objects.css | styles/music-objects.css |
| `.song-readiness` | styles/shell.css, styles/polish.css, styles/operations.css | styles/shell.css |
| `.song-row` | style.css, styles/operations.css, styles/music-objects.css, styles/depth.css | style.css |
| `.song-select` | styles/creation.css, styles/music-objects.css | styles/creation.css |
| `.song-why` | styles/operations.css, styles/music-objects.css | styles/operations.css |
| `.stack` | style.css, styles/polish.css | style.css |
| `.stage` | style.css, styles/shell.css, styles/polish.css, styles/listening.css | style.css |
| `.start` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.status` | style.css, styles/shell.css, styles/polish.css, styles/foundation.css, styles/listening.css, styles/creation.css, styles/operations.css, styles/typography.css | styles/shell.css |
| `.status-blocked` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.status-failed` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.status-needs-action` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.status-ready` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.status-warning` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.steer` | style.css, styles/listening.css | style.css |
| `.story-song` | styles/creation.css, styles/depth.css | styles/creation.css |
| `.story-tag` | styles/creation.css, styles/depth.css | styles/creation.css |
| `.strip` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.stuck` | style.css, styles/depth.css | style.css |
| `.studio` | style.css, styles/creation.css | style.css |
| `.studio-cell` | style.css, styles/polish.css, styles/creation.css, styles/music-objects.css | style.css |
| `.studio-grid` | style.css, styles/polish.css, styles/creation.css | style.css |
| `.studio-head` | style.css, styles/creation.css, styles/typography.css | style.css |
| `.studio-lane` | style.css, styles/polish.css, styles/creation.css | style.css |
| `.studio-name` | style.css, styles/polish.css, styles/creation.css | style.css |
| `.studio-pair` | styles/creation.css, styles/music-objects.css | styles/creation.css |
| `.studio-ruler` | style.css, styles/creation.css | styles/creation.css |
| `.studio-side` | style.css, styles/creation.css | style.css |
| `.sung` | style.css, styles/listening.css | style.css |
| `.tabs` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.thumbs` | style.css, styles/polish.css | style.css |
| `.time` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.timeline` | style.css, styles/shell.css, styles/polish.css, styles/creation.css, styles/depth.css | style.css |
| `.toast-close` | styles/shell.css, styles/polish.css, styles/icons.css | styles/polish.css |
| `.toast-row` | styles/shell.css, styles/polish.css, styles/icons.css, styles/depth.css | styles/shell.css |
| `.toasts` | styles/shell.css, styles/polish.css | styles/shell.css |
| `.tooltip-anchor` | styles/shell.css, styles/listening.css | styles/shell.css |
| `.transport` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.transport-more` | styles/shell.css, styles/listening.css | styles/shell.css |
| `.ui-icon` | styles/polish.css, styles/foundation.css, styles/icons.css | styles/polish.css |
| `.vibe-card` | styles/polish.css, styles/listening.css, styles/music-objects.css, styles/typography.css | styles/listening.css |
| `.vibe-card-detail` | styles/polish.css, styles/listening.css | styles/polish.css |
| `.vibe-card-facts` | styles/listening.css, styles/typography.css | styles/listening.css |
| `.vibe-filters` | styles/listening.css, styles/typography.css | styles/listening.css |
| `.vibe-group` | style.css, styles/polish.css, styles/listening.css | style.css |
| `.vibe-scope` | styles/listening.css, styles/typography.css | styles/listening.css |
| `.vibe-tempo` | styles/polish.css, styles/listening.css, styles/typography.css | styles/polish.css |
| `.view-options` | styles/polish.css, styles/listening.css | styles/polish.css |
| `.volume` | styles/shell.css, styles/icons.css | styles/shell.css |
| `.waiting` | style.css, styles/music-objects.css | style.css |
| `.warn` | style.css, styles/polish.css, styles/listening.css, styles/operations.css | style.css |
| `.why` | style.css, styles/typography.css | style.css |
| `.wide` | style.css, styles/shell.css | style.css |
| `.wrap` | style.css, styles/polish.css | style.css |
