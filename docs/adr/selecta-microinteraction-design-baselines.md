# Selecta microinteraction design baselines

**Implementation scope:** MI-0135-01, MI-0136-04 through MI-0136-06, MI-0137-07 and MI-0139-01. These are source baselines, not independent human verification. Reviewer recordings, computed-style contrast measurements and participant observations remain open in the evidence ledger.

## Attention map

| Journey | Primary decision | Permitted persistent context | Interruptions | Distraction budget |
|---|---|---|---|---|
| First run | Choose a music folder | Privacy and analysis explanation | Folder/error consent only | One primary button; progress replaces setup controls |
| Listen | Play, pause or choose what is next | Current song, elapsed time and transition truth | Playback failure or requested overlay | One transport cluster; secondary detail stays optional |
| Make a Mix | Choose a starting approach | Readiness and the current mix | Replacement confirmation | One primary card/action per step |
| My Mixes | Open or activate a saved draft | Current-vs-draft identity and render state | Destructive/replacement confirmation | One emphasized action per draft |
| Edit | Change the selected song or transition | Stable song, seam and revision identity | Conflict/recovery dialog | Inspector follows selection; playback remains available |
| Studio | Shape and audition one transition | Applied, recovered, working and rendered states | Missing-stem or apply failure | Grid is primary; presets and detail remain subordinate |
| Library/Workspace | Find a song or resolve an operation | Search/filter state, job state and source safety | Scoped operation failure | Search/filter first; background jobs never steal focus |

The route shell, player and activity surfaces are the authoritative source inventory: `web/src/shell/manifest.ts`, `web/src/shell/Shell.tsx`, `web/src/App.tsx`, `web/src/views/Now.tsx`, `web/src/views/Mixes.tsx`, `web/src/views/MyMixes.tsx`, `web/src/views/Mix.tsx`, `web/src/views/Studio.tsx`, `web/src/views/Library.tsx` and `web/src/views/Workshop.tsx`.

## Authentic artwork rules

1. Display cover or artist artwork only when it comes from an explicit, traceable media metadata field. Never synthesize, infer or fetch an image from title/artist text.
2. Missing artwork uses a neutral material surface, typography or waveform. It must not resemble an album cover or imply provenance.
3. Decorative gradients, particles and waveform geometry are labelled decorative and carry no song identity or timing claim.
4. Artwork failure preserves the song title, artist and controls; it must not create an empty actionable target.
5. Cached or remote images may not reveal local file paths. Any future remote provider requires an explicit privacy disclosure and failure fallback.

The current application intentionally uses text, waveform and neutral materials rather than unverified cover imagery. That is the compliant missing-metadata fixture.

## Page-level material specimens

| Surface | Density and material rule | Current source specimen |
|---|---|---|
| Listen | Sparse, calm hero; transport and song identity dominate | `web/src/views/Now.tsx`, `web/src/styles/listening.css` |
| Mix ideas | Scannable cards; one primary action per idea | `web/src/views/Mixes.tsx`, `web/src/styles/creation.css` |
| Library | Dense rows with explicit columns, stable IDs and comfortable/compact preference | `web/src/views/Library.tsx`, `web/src/styles/operations.css` |
| Editor | Alternating song/seam sequence with selection-following inspector | `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx` |
| Studio | Workstation grid with status ledger and optional detail | `web/src/views/Studio.tsx`, `web/src/styles/creation.css` |
| Workspace | Operational cards and truthful progress without visual urgency | `web/src/views/Workshop.tsx`, `web/src/views/WorkshopPanels.tsx` |

`web/src/ui/ControlGallery.tsx` is the component-state specimen for buttons, statuses, overlays, loading, recovery and reduced-motion review.

## Contrast ownership

All semantic foreground/background pairs are owned by `web/src/styles/tokens.css`; components consume tokens rather than inventing meaning with local colors.

| Content | Foreground | Background | Required target |
|---|---|---|---|
| Body and headings | `--ink` | `--bg`, `--panel`, `--panel-2` | WCAG 2.2 AA, 4.5:1 for normal text |
| Muted/supporting text | `--soft` | owning surface | 4.5:1 when essential; otherwise never the sole carrier of state |
| Primary controls | `--primary-ink` | `--primary-fill` | 4.5:1 label; 3:1 boundary/focus distinction |
| Status/error text | `--warn`, `--ok`, `--request` plus words/icons | owning surface | 4.5:1 text; colour never acts alone |
| Focus | `--focus-ring` and offset surface | adjacent colours | 3:1 component-state contrast |
| Overlays | `--ink` | `--panel` | Same text targets as pages |

Dark, light and system themes define the same semantic roles. Independent computed-style measurement at the exact candidate SHA remains a verification gate.

## Motion storyboard baseline

| Lifecycle | Enter/change | Completion | Reduced motion |
|---|---|---|---|
| Player | State-driven transport feedback; waveform follows actual player time | Stable playing/paused state | Static state change; no decorative sweep |
| Navigation | Route content changes while the persistent player survives | Focus moves to the new page heading | No spatial scene movement |
| Request | Waiting → proposed bridge → approved/joining → joined/failed | Named request and surviving mix state | Status/text changes only |
| Studio grid | Working cells change locally; audition owns audio focus | Applied and rendered states remain distinct | No pulsing grid or travelling highlight |
| Mix card | Hover/focus/selection disclose action | Building state resolves to mix or scoped error | Opacity/colour state without scale travel |
| Background job | Queued → running → completed/failed | Artifact or recovery action appears | Progress remains textual/determinate where known |
| Export | Frozen revision → render → decode/download result | Exact artifact identity remains available | No celebratory motion required |

Normal-speed and quarter-speed recordings are independent review evidence and remain open.

## Navigation storyboard

The canonical route manifest is `web/src/shell/manifest.ts`; parsing and canonicalization live in `web/src/router.ts`.

| Intent | Canonical route | Direct-link result | Persistent context |
|---|---|---|---|
| Listen | `/listen` | Current mix or truthful empty state | Player and request/activity controls |
| Make a Mix | `/mixes` | Mix ideas | Existing playback continues |
| My Mixes | `/mixes/mine` | Current mix and drafts | Current/draft identity remains explicit |
| Edit current | `/mix/current/edit` | Current arrangement | Current revision and selection |
| Edit draft | `/mixes/drafts/:id/edit` | Named draft or truthful missing state | Draft identity never aliases current mix |
| Library | `/library` | Search/filter/sort from query parameters | Playback continues |
| Discover | `/discover`, `/discover/harmonic` | Word or harmonic workflow | Playback continues |
| Workspace | `/workshop`, `/workshop/sources` | Operations or sources | Background activity persists |

Legacy aliases canonicalize without restarting playback. Back/Forward restores route context; page transitions move focus to the destination heading while Stage restores the originating control when possible.

