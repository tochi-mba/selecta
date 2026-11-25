# ADR-0477 - Feel system: expressive motion, depth and music-reactive chrome

- **Decision:** Proposed (the owner set the direction on 2026-11-25: Expressive by default, the same brand made richer, music-reactive across the app, phone haptics and no interface sounds; approval of this record is the owner's).
- **Implementation:** In progress on branch `feat/feel-system`. See the checklist at the end.
- **Independent verification:** None.
- **Programme/date/baseline:** Feel (FL); 2026-11-25; `main` at `f5b6a4ab`.
- **Existing ADR owners:** ADR-0137, ADR-0182, ADR-0205 and ADR-0296 are superseded in part (below). ADR-0136, ADR-0161 and ADR-0162 are kept whole.
- **Flags:** `app.feel_motion`, `app.feel_depth`, `app.feel_pointer_light`, `app.feel_music`, `app.feel_ambient`, `app.feel_moments`, `app.feel_haptics` (new, in `src/selecta/flags/app.json`), and the existing `app.scene_transitions`. Off: today's look and behaviour, and pages still reflow.

## The problem

The owner's verdict on 2026-11-25: the Cloud modes look uncreative, with no interactive or hover animation, and do not yet feel worth paying for. The code agrees, and it is by design:

- Everyone runs on Subtle (`web/src/state/prefs.ts`), 60 to 180ms. Expressive adds only the Welcome drawing's bar kick and a page cross-fade.
- Hover is a colour change and a press is an inset ring. `polish.css` forces `button:active { transform: none }` and MP-0296-03 fails if a button's box changes by half a pixel.
- There is one easing curve and six durations, pinned by `motion-tokens.test.ts`.
- The Cloud player has no live spectrum, its visualizer is off, and the hosted dock is the browser's own audio widget.
- No moment is rewarded: onboarding finish, a built mix, the first hand-off, an upgrade and an export are each a sentence or a toast.
- A slow computer drops straight to Still (`web/src/ui/lowPower.ts`).

Earlier records chose that restraint on purpose. This one changes the choice and keeps their truth rules.

## Decision: the rules of the feel

1. **Frequency sets intensity.** Actions done hundreds of times a day (row hover, typing, keyboard moves, the palette) answer within 120ms with no travel. Rare moments get 600 to 1400ms of choreography.
2. **Two families.** Effects (colour, opacity) ease out and never bounce. Spatial changes (position, scale) use springs.
3. **Hovering never moves a control, and a press never shrinks its hit area.** Hover is light, edge and shadow. A press squashes the control to 0.96 while a pad keeps the whole resting box clickable.
4. **Only music moves by itself.** Every pulse, glow or bar that looks musical traces to a measured kick, a measured onset or an analysed beat, and rests when paused. Nothing musical runs on a timer. Where no real signal exists the chrome stays still.
5. **Arrive from where you were asked, leave faster than you came.** Everything can be interrupted. Pause never waits for an animation.
6. **Continuity.** An object that is on both pages travels instead of vanishing.
7. **One lime peak per region** (ADR-0136).
8. **Comfort ladder.** Expressive, Subtle, Still, the computer's reduced-motion setting, forced colours and two low-power steps each have a defined result. No information depends on motion or on hover.
9. **Cheap by construction.** Transform and opacity only, no per-frame style writes on the page root, no per-row listeners, blur only on small fixed chrome.
10. **Real or clearly generated** (artwork: ADR-0478).
11. **Neutral where it must be.** The blind listening study gets component feedback only: no ambient colour, no music-reactive chrome.

## What is superseded, and what stays

| Record | Clause | Now |
| --- | --- | --- |
| ADR-0137 | "no spring overshoot on playback, precise timeline drops or dialogs that contain data" | Kept for timeline drops and dialogs that hold data. Overshoot is allowed on controls being released, on arrivals and on celebrations. |
| ADR-0182 | "A focusable target never moves away underneath an active pointer or keyboard interaction", with press 0 to 120ms and hover 100 to 160ms as the whole vocabulary | Replaced by rule 3. The promise is the hit area, not the painted box. Press and hover timings stay inside those ranges; release, arrival and page travel use the new spatial tokens. |
| ADR-0205 | "No fake beat pulse, strobe, surprise sound, moving hit targets or animated delay on Pause" | "Fake" is the operative word. A pulse driven by a measured kick or an analysed beat is allowed (rule 4). No strobe, no surprise sound, no delay on Pause: all kept. |
| ADR-0296 | MP-0296-03: a hovered or pressed control's box never changes | The hover half stays as written. The pressed half becomes: every point of the resting box still lands on the control while pressed, and the box is back within half a pixel after release. |
| Defaults | Motion starts on Subtle | Motion starts on Expressive (behind `app.feel_motion`). A person who chose Subtle or Still keeps it. |

Kept whole: no shake or flash for errors and no interface sounds (ADR-0182); never flash or strobe and nothing hover-only (ADR-0161); compositor-only cosmetic motion, everything stops when the page is hidden, audio comes first and no new runtime dependency (ADR-0162); never fabricate a beat, a wave, progress or success (ADR-0182, ADR-0146).

## How it is built

- **Tokens** (`web/src/styles/tokens.css`). The six duration tokens and `--motion-ease` are unchanged and are the effects family. A spatial family is added: `--spring-gentle`, `--spring-snappy` and `--spring-bouncy` as CSS `linear()` curves with a plain fallback, their durations `--motion-spring-snappy`, `--motion-spring-release`, `--motion-spring-glide`, a stagger step and `--press-scale`. Depth and light roles are added: `--shadow-rest`, `--shadow-lift`, `--edge-light`, `--glow-accent`, `--ambient-tint`, `--light-spot`.
- **Sheets.** `styles/feel.css` (press, hover, moving skins, pointer light, indicators, arrivals), `styles/feel-scene.css` (page and shared-element transitions), `styles/feel-music.css` (beat ring, playing bars, ambient layer). Every rule is scoped to `<html data-feel~='...'>`, which `web/src/feel/root.ts` writes from the flags and the motion choice.
- **Engines** (`web/src/feel/`, a flat shared folder): the beat bus, the ambient hue, the pointer light, the sliding indicator, the number roll, a FLIP helper, haptics and the celebration. Page transitions stay on `document.startViewTransition` in `web/src/shell/sceneTransition.ts`, because the router is a synchronous external store.
- **The beat bus** plays a short compositor-only animation on at most four registered elements for each measured kick or analysed beat. It never writes a beat-rate custom property on the page root. It stops itself when playback is paused, the tab is hidden, the choice is Still, the computer asks for reduced motion or low power is on; the global CSS switch does not reach script animations, so the bus does its own gating. It is capped at three pulses a second and halves above 180 beats a minute.

## Honest limits by mode

| Mode | Real signal | Result |
| --- | --- | --- |
| Local app | Analyser taps; the analysed beat grid while Listen is open | Grid-locked beats on Listen, measured kicks elsewhere |
| Cloud, music on this device | The engine's analyser, exposed as a read-only tap | Measured kicks and onsets; no beat grid |
| Cloud, music on another device | None here | Ambient hue and play state only |
| Cloud hosted playback | The browser's audio element, which cannot be measured safely | Ambient hue and play state only |

## Comfort ladder

| Setting | Result |
| --- | --- |
| Expressive | Everything above |
| Subtle | Every spring becomes the gentle one and shorter, press 0.98, no pointer light, no beat outside the player, no celebrations |
| Still, reduced motion | Zero durations, press 1, exits keep their short fade, no music-reactive chrome |
| Low power, first step (`lite`) | No blur, glow, pointer light, beat or ambient travel; gentle springs |
| Low power, second step (`auto`) | As Still |
| Forced colours | Shadows, glows and the ambient layer are removed; borders and outlines carry every state |

## Checklist

1. **FL-0477-01 - Tokens and sheets.** The spatial, depth and light tokens; the three registered sheets; `feel/root.ts`. Implementation: Not started.
2. **FL-0477-02 - Press, hover and moving skins.** Rule 3 for every control, card, tile and row. Implementation: Not started.
3. **FL-0477-03 - Page and shared-element transitions.** Direction, Back and Forward, chunk preload, persistent chrome, named shared elements, the low-power check. Implementation: Not started.
4. **FL-0477-04 - Beat bus and ambient hue.** Rule 4, the Cloud audio tap, the hue travelling with a real hand-over. Implementation: Not started.
5. **FL-0477-05 - Comfort.** Expressive by default, the two low-power steps, forced colours. Implementation: Not started.
6. **FL-0477-06 - Small engines and the motion gallery.** Indicator, number roll, FLIP, haptics, celebration; every primitive shown at three levels. Implementation: Not started.
7. **FL-0477-07 - Every surface.** The shared components, the Shell and each screen listed in the plan. Implementation: Not started.
8. **FL-0477-08 - Tests and inventories.** `motion-tokens.test.ts`, `gp-0257-motion.test.ts` (a "follows music" kind that may never loop in CSS), MP-0296-03, the default-pinning tests, `docs/engineering/motion-inventory.md`. Implementation: Not started.
9. **FL-0477-09 - Proof on real devices.** Haptics on an Android phone, the display on a television, the owner's own computer. Needs a person.

## Research

- Press scale, short ease-out feedback, near-instant frequent actions: https://emilkowal.ski/ui/7-practical-animation-tips
- Effects and spatial springs: Material 3 Expressive motion, https://m3.material.io
- Same-document view transitions are Baseline (Firefox 144, Safari 18): https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- `linear()` easing and `@starting-style` support: https://developer.chrome.com/blog/new-in-web-ui-io26
- Web haptics work on Android only in practice: https://bugs.webkit.org/show_bug.cgi?id=285120
