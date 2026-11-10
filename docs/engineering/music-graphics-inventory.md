# Music graphics: semantic states and their treatment in both themes (FP-0266-01)

Every graphical mark that carries musical meaning, where it is drawn, and how each state is told apart.
All colours are theme tokens from `web/src/styles/tokens.css`, so a theme change repaints each mark from the
newly effective palette; none of these rules holds a raw colour. Every row also names the shape, text or
label that carries the meaning without hue, and the forced-colours treatment where one exists.

Machine-checked by `web/src/styles/music-graphics-inventory.test.ts`: every row's source file must exist
and contain its marker, and every CSS rule must exist and use only tokens or system colours.

| Graphic | State | Source | CSS rule | Treatment | Without colour |
|---|---|---|---|---|---|
| Waveform | played | `views/Now.tsx` | `.peaks .played` in `style.css` | stroke `--ink` | position left of the playhead; elapsed time text |
| Waveform | not yet played | `views/Now.tsx` | `.peaks .unplayed` in `style.css` | stroke `--line` (decorative) | position right of the playhead |
| Waveform playhead | now | `views/Now.tsx` | `.playhead` in `style.css` | 2px bar `--ink` | a solid vertical line; time readout |
| Seek marker | proposed seek, not yet heard | `views/Now.tsx` | `.strip .scrub-ghost` in `styles/listening.css` | 2px dashed `--focus` | dashed, unlike the solid playhead; the seek note text |
| Seam on the waveform | next transition | `views/Now.tsx` | `.seam-mark` in `style.css` | 3px bar `--playing` | the word "seam" drawn above it |
| Transition countdown | time to the seam | `views/Now.tsx` | `.countdown-track span i` in `style.css` | fill `--playing` at 55% | filled segments count down; the number is written out |
| Live spectrum (15 styles) | real mixed-audio levels | `views/Now.tsx`, `views/spectrumVisuals.ts` | `.music-visualizer` in `styles/listening.css` | canvas painted from computed `--accent` and `--ok`, re-read on every theme or forced-colours change | its label names the style and says the levels are measured; paused says paused |
| Seam diagram | planned | `ui/MusicObjects.tsx` | `.music-seam-diagram.is-plan` in `styles/music-objects.css` | dashed border | dashed; "Planned, not rendered" in its label |
| Seam diagram | rendered | `ui/MusicObjects.tsx` | `.music-seam-diagram.is-made` in `styles/music-objects.css` | 3px solid `--status-ready` start edge | solid edge; "Rendered transition" in its label |
| Seam diagram | queued | `ui/MusicObjects.tsx` | `.music-seam-diagram[data-state='queued']` in `styles/music-objects.css` | 3px dashed `--status-planned` | dashed edge; "Queued to render" |
| Seam diagram | rendering | `ui/MusicObjects.tsx` | `.music-seam-diagram[data-state='rendering']` in `styles/music-objects.css` | 3px dotted `--status-working` | dotted edge; "Rendering" |
| Seam diagram | failed | `ui/MusicObjects.tsx` | `.music-seam-diagram[data-state='failed']` in `styles/music-objects.css` | 3px solid `--status-failed`, lines faded | faded lines; "Render failed" stays in its label |
| Route diagram | wanted song | `ui/MusicObjects.tsx` | `.music-route li.wanted` in `styles/music-objects.css` | border `--selected` | "Requested song" under it, "Extra bridge song" under a bridge |
| Energy overview | measured energy | `ui/MusicObjects.tsx` | `.energy-overview-bar` in `styles/music-objects.css` | fill `--status-ready`, height is the value | bar height; each button's label says the energy |
| Energy overview | chosen song | `ui/MusicObjects.tsx` | `.energy-overview button[aria-current='true']` in `styles/music-objects.css` | 2px `--selected` border on `--surface-selected` | `aria-current`; thicker border |
| Energy overview | unknown energy | `ui/MusicObjects.tsx` | `.energy-overview-unknown` in `styles/music-objects.css` | `--text-soft` mark | a written gap, never a guessed bar |
| Energy horizon | asked-for (intention) | `ui/MusicObjects.tsx` | `.energy-horizon.intention` in `styles/music-objects.css` | drawable line | labelled "Draw energy arc"; never called measured |
| Energy horizon | measured | `ui/MusicObjects.tsx` | `.energy-horizon.measured` in `styles/music-objects.css` | read-only line | labelled "Measured relative energy of the current mix" |
| Studio cell | on | `views/Studio.tsx` | `.studio-cell[aria-pressed='true']` in `style.css` | filled `--ink` | `aria-pressed`; inset bar under it |
| Studio cell | off | `views/Studio.tsx` | `.studio-cell` in `style.css` | `--surface-control` with `--line` edge | `aria-pressed=false` |
| Studio cell | playing now | `views/Studio.tsx` | `.studio-cell.now` in `style.css` | 2px outline `--playing` | top bar in `polish.css`; the playhead readout |
| Studio cell | keyboard focus | `views/Studio.tsx` | `.studio-cell:focus-visible` in `styles/polish.css` | 3px outline `--focus` inset | the focus ring is drawn inside, distinct from the playing outline |
| Studio cell | changed by Selecta | `views/Studio.tsx` | `.studio-cell.ai-changed` in `styles/music-objects.css` | inset `--status-warning` | the list of changes is written out |
| Studio lane | soloed | `views/Studio.tsx` | `.studio-name[aria-pressed='true']` in `style.css` | border and text `--selected` | `aria-pressed`; bold name |
| Studio lane | silenced by a solo | `views/Studio.tsx` | `.studio-lane.silenced .studio-cell, .studio-lane.silenced .studio-name` in `styles/creation.css` | 45% opacity | faded; solo button state |
| Studio lane | stem not available | `views/Studio.tsx` | `.studio-lane.lost .studio-cell` in `styles/creation.css` | 35% opacity with a hatched pattern | hatching; not-allowed cursor; the reason in words |

Behaviour that keeps these marks honest across a theme change is proven in a browser by
`web/e2e/fp-live-theme.e2e.ts` (spectrum repaint, energy and seam equality) and in unit tests by
`web/src/views/Studio.test.tsx` (Studio squares through Light, Dark and System),
`web/src/ui/MusicObjects.test.tsx` (planned versus rendered, requested versus measured) and
`web/src/views/spectrumVisuals.test.ts` (fifteen styles, silence stays quiet).
