# CSS ownership, collisions and breakpoints

## Files and owners

| File | Owns | Loaded by |
|---|---|---|
| `styles/tokens.css` | palette, meanings, type, space, motion, layers, shell geometry, density, theme switching | `main.tsx`, first |
| `styles/foundation.css` | base element meanings: primary fill, popovers, word highlight | `main.tsx` |
| `style.css` | legacy global sheet: base controls, Listen strip/lyrics/handoff, timeline rows, Library rows, Links cards, Workspace metrics | `main.tsx` |
| `styles/shell.css` | rail/bottom bar, context bar, mini-player, toasts, overlays, menus, tooltips, skeletons, inspector resize | `main.tsx` |
| `styles/listening.css` | Listen layout, Stage, seek ghost, energy arc inputs, forced-colour fallbacks for music graphics | `main.tsx` |
| `styles/creation.css` | editor scope bar, inspector, Studio, Story view, energy overview and thumb | `main.tsx` |
| `styles/music-objects.css` | motifs, seam/route diagrams, energy horizon, Library selection and cards | `main.tsx` |
| `styles/operations.css` | Library columns, Workspace panels, export jobs | `main.tsx` |
| `styles/polish.css` | interaction feedback, card disclosure, skeleton reveal, reduced-motion overrides | `main.tsx` |
| `styles/glossary.css`, `styles/palette.css` | glossary dialog and term hints; palette song results | `main.tsx` |

Load order (`web/src/main.tsx`): tokens, style.css, shell, polish, foundation, listening, creation,
operations, music-objects, glossary, palette. Later files refine earlier ones; feature files come
after the legacy sheet so they win at equal specificity. New work goes into the file that owns the
feature; `style.css` only shrinks.

## Collisions audited

Class tokens used by more than one feature (`className` strings parsed across `web/src`):

| Token | Users | Verdict |
|---|---|---|
| `.song`, `.seam`, `.grip`, `.facts`, `.pill` in Requests | Requests draws ghost rows that look like timeline rows on purpose | intentional, kept |
| `.facts` in Library | Library rows define a `facts` grid area | intentional |
| `.count` | timeline position number **and** the navigation/request/activity badges and the glossary | accidental: the badge inherited `grid-area: count`, right alignment and a minimum width. Scoped to `.song .count`; the badge has its own font rule (this PR) |
| `.pair` | Good/Bad pairs in Edit and the rating group in Discovery | intentional, same meaning |
| `.thumbs`, `.next-up` | Listen and inspector/Discovery | intentional, same meaning |
| `.handoff` | Listen countdown only (Links uses `link-handoff`) | no collision |
| `var(--bg, #111)` literal | `.chord-strip span.now` | removed (this PR) |

## Breakpoints

One shell breakpoint (760 px) in `tokens.css` and `shell.css`; page-local breakpoints are 620 px
(Library rows, timeline rows, Listen and Workspace panels stack) and the inspector sheet switch in `Mix.tsx`. The Studio
never changes structure by width; it scrolls with sticky lane labels, so Library rules cannot affect
it. See [route-state-register.md](route-state-register.md#breakpoints).

## Spacing exceptions

Values outside the `--space-*` scale that remain on purpose: 1–3 px hairline gaps in bar charts
(energy overview, seam bars), 6 px pills, and the 24 px add-gap targets in the timeline (WCAG 2.5.8
minimum, with spacing). Everything else uses tokens.
