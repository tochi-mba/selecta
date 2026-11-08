# Themes, functional edges and music graphics

Source of truth: `web/src/styles/tokens.css` (palette → meaning → parts), `web/index.html` (first
paint), `web/src/state/prefs.ts` (choice and browser chrome) and `web/src/views/Now.tsx` (canvas).

## Edge roles

Every boundary in the interface has one of five roles. Decorative dividers may be quiet; the other
four must stay perceivable against the surface they sit on.

| Role token | Meaning | Used by (examples) | Light value | Dark value |
|---|---|---|---|---|
| `--edge-decorative` | separates content, carries no state | section rules, card dividers, overlay head/foot rules | `--line` `#d5cfbd` | `--line` `#3a362c` |
| `--edge-interactive` | "this can be pressed or typed into" | buttons, inputs, selects (`style.css`), editor controls (`creation.css`) | `--soft` `#6a6555` | 60 % `--soft` + 40 % `--line` |
| `--edge-selected` | the chosen object | selected Library rows (`music-objects.css`), selected seam/song (`creation.css`) | `--accent` `#2b2a14` | lime `#e8ff3a` |
| `--edge-error` | a problem with this object | invalid fields, failed seams | `--warn` `#b93d10` | `#ff7a4d` |
| `--edge-focus` | keyboard focus | `:focus-visible` outlines, focused selected rows | `--accent` `#2b2a14` | lime `#e8ff3a` |

Per component: form controls → interactive; actionable rows and cards → interactive at rest,
selected when chosen; tabs → interactive, selected tab underlined with the selected role; modal and
menu frames → decorative edge plus elevation (`--shadow-raised`) because the dimmed backdrop already
separates them; selectable music items (songs, seams, Studio cells) → selected role plus a non-colour
mark (inset bar, `aria-pressed`, pattern). Decorative-only lines are never the only sign of state.

Concurrent states stay distinguishable: a selected row that also has keyboard focus shows the
selected inset bar **and** a 2 px focus outline (`music-objects.css`); playing uses the playing
marker; errors add a text reason. None of the three relies on hue alone.

## Lime in light theme

Lime (`#e8ff3a`) fails as text or as a thin line on cream, so in light theme it appears only as
`--primary-fill` / `--word-fill`: a filled shape with dark ink (`--primary-ink #14140a`) and a dark
edge (`--primary-edge #16140e`). Focus and selection in light theme use the dark olive accent.

## Theme precedence

| Saved choice | OS prefers | Storage | `data-theme` | Shown theme | `theme-color` metas |
|---|---|---|---|---|---|
| Dark | light or dark | readable | `dark` | dark | both `#100f0c` |
| Light | light or dark | readable | `light` | light | both `#f5f2e9` |
| System (or nothing saved) | light | readable | none | light (CSS media query) | each meta keeps its own media colour |
| System | dark | readable | none | dark | each meta keeps its own media colour |
| unknown value | either | readable | none | follows OS | as System |
| any | either | blocked / throws | none | follows OS (`DEFAULT_PREFS`) | as System |

Rules: a manual choice always outranks the OS; System follows the OS live (`useShownTheme`
subscribes to `matchMedia`); an OS change never overrides a manual choice while the app is open;
the pre-paint script in `index.html` applies the saved choice and chrome colour before any app
JavaScript runs; changing theme never touches the player (`web/e2e/finishing.e2e.ts` "changing the
theme while playing starts nothing again, and the title bar follows").

## Browser chrome support

| Environment | Behaviour | Fallback |
|---|---|---|
| Edge / Chrome tab | toolbar follows `theme-color`, updated at runtime | - |
| Edge / Chrome installed app | title bar follows `theme-color` (manifest `theme_color` is the cold-start colour) | first frame may use the manifest colour |
| Firefox | ignores `theme-color` | page theme still correct |
| Safari (macOS/iOS) | honours `theme-color` with `media` | - |

The installed-app and non-Edge rows still need a person with those browsers (see
[needs-a-person.md](needs-a-person.md)).

## Graphic states

| Graphic | Source of data | Light / dark treatment | Non-colour cue | Owner |
|---|---|---|---|---|
| Waveform + playhead | analysed peaks; player clock | `--text-soft` peaks, `--playing` playhead | playhead line + time text | `views/Now.tsx` |
| Seek target (ghost) | pointer/keyboard before release | dashed `--focus` marker | "Seek to m:ss" in the time readout | `views/Now.tsx` |
| Transition countdown | seam switch time + beat grid | `--status-working` | beats/bars as numbers | `views/Now.tsx` |
| Spectrum (15 styles) | `AnalyserNode` of the real mix | `--accent` / `--ok` read from tokens at draw time; `CanvasText`/`Highlight` in forced colours | none needed (decorative, `aria-hidden`) | `views/spectrumVisuals.ts` |
| Seam diagram | requested vs rendered move | family shapes | label of the move actually playing | `ui/MusicObjects.tsx` `SeamDiagram` |
| Route diagram | server-returned bridge songs | request blue | ordered text list | `ui/MusicObjects.tsx` `RouteDiagram` |
| Energy horizon | five intended stops / measured songs | intention dots vs measured line, never superimposed | labelled scales | `ui/MusicObjects.tsx` `EnergyHorizon` |
| Energy overview / thumb | per-song measured energy | relative bars; unknown hatched | "energy unknown" text | `ui/MusicObjects.tsx` |
| Studio cells | 8 lanes × 8–64 cells | on/off fill + edge; solo outline | `aria-pressed`, lane names | `views/Studio.tsx` |

A theme switch only repaints: the canvas re-reads tokens (dependency on `useShownTheme` and a
forced-colours listener) and keeps drawing from the live analyser. No data value changes.

## Token consumer audit

Raw colour values appear only in the palette section of `tokens.css` (dark `:root`, the
`prefers-color-scheme: light` block and `[data-theme='light']`), in `web/index.html`'s pre-paint
script and in `state/prefs.ts` `BAR_COLOUR` (browser chrome must be a literal colour). Every other
stylesheet uses meanings (`--surface-*`, `--text*`, `--status-*`, `--edge-*`, `--selected`,
`--playing`, `--request`, `--danger`). One fallback literal (`var(--bg, #111)` in `style.css`) was
removed in this PR.

## Accepted visual exceptions

| Exception | Why |
|---|---|
| Spectrum canvas has no contrast requirement | decorative, `aria-hidden`; the same information is not needed to use the app |
| Decorative dividers below 3:1 | carry no state (WCAG 1.4.11 applies only to UI components and meaningful graphics) |
| Disabled controls below 3:1 | WCAG exempts inactive components; each has a written reason instead |
| Lime never used as text in light theme | contrast; replaced by filled shapes with dark ink |
