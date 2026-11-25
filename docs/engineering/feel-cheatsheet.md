# Feel system cheat sheet (ADR-0477, ADR-0478)

How a screen asks for the feel. Everything is inert until its flag is on (`app.feel_*`, written to
`<html data-feel>` by `web/src/feel/root.ts`), so adding these to a component changes nothing with
the flags off. Ask `feelOn('motion' | 'depth' | 'pointer' | 'music' | 'ambient' | 'moments')` before
doing anything from script, and `feelCalm()` before any script animation.

## Rules every screen keeps

- Hovering never moves a control; a press never shrinks its hit area. Buttons already press, lift and
  glow by themselves: do not add transforms to buttons.
- Frequent actions (row hover, typing, keyboard moves) answer within 120ms with no travel. Only rare
  moments get long choreography.
- Only music moves by itself, and only from measured signal. No `infinite` animation, no timer that
  looks like music.
- Colour and opacity use `--motion-*` and `--motion-ease`. Position and scale use `--spring-*` with
  `--motion-spring-*`. No raw colours, shadows, sizes or durations in CSS: tokens only.
- Hover-only rules go inside `@media (hover: hover) and (pointer: fine)` (every selector there has
  `:hover`), with a `:focus-visible` or `:focus-within` twin outside.
- Nothing may depend on motion or hover to be understood. Decorative elements are `aria-hidden`.
- The blind listening study stays neutral: component feedback only.

## Attributes and classes (styles/feel.css)

| Ask | What it does |
| --- | --- |
| `data-lift` | A card, tile or choice whose painted skin (`::before`) rises and casts `--shadow-lift` on hover and focus inside. The element and its buttons never move. Drop the component's own hover shadow when adding it. A border wider than 1px sets `--lift-inset`. `overflow: hidden` clips it. |
| `data-lift="row"` | A list row: lit top edge only, no travel, no shadow. |
| `data-glow` | Soft light under the mouse and a lit border (cards, tiles, panels; not buttons). |
| `data-arrive` | Rises a little and fades in once when first drawn. |
| `data-stagger` on a parent | Each direct child arrives one after another. Set `style={{ '--i': index }}` on each child. |
| `.feel-pop` | Pops in on a spring. Re-key the element to replay. |
| `.feel-tick` | On an SVG path with `pathLength="1"`: the tick draws itself. |
| `.feel-flash` | A new or changed row glows once. |
| `.feel-collapse-out` | A removed row fades and folds away. Add only when `feelOn('motion')`, remove the node on `animationend` with a timer fallback. |
| `data-feel-drag="held"` / `"returning"` | Your drag code sets it on the thing being dragged: lifted and tilted while held; springs back when let go somewhere it cannot land (clear your own translate). |
| `data-feel-drop="over"` | A place the dragged thing can land, while it is over it: the edge lights. |
| `data-feel-part="before"` / `"after"` | The neighbours either side of the landing spot step apart. |

Shared components already do the rest by themselves: `Slider` shows a value bubble while dragged,
`IconButton` blooms from the mouse's entry point, `Skeleton` fades its content in when it goes,
`DataTable` glides reordered rows, `Meter` rolls its percentage, and every `Drawer` and `Sheet`
(not the editor's `PhoneSheet`, which has its own) closes on a drag down its title bar on a phone.

## Engines (web/src/feel/)

```tsx
// Sliding indicator for tabs, segmented controls, nav
useSlidingIndicator(stripRef, '[aria-selected="true"]');
<div ref={stripRef}>...<span className={INDICATOR_CLASS} aria-hidden="true" /></div>
// data-indicator-shape="fill" on the strip for a block behind the choice instead of a line

// Rolling numbers (the screen reader hears the final value)
<NumberRoll value={count} format={(n) => countOf(n)} />

// Reorder, insert and remove that glide (wrap the React update in flushSync)
void flip([...listRef.current!.children], () => flushSync(() => setOrder(next)));

// Phone taps: tap(), tick(), success(), warn() from feel/haptics (no-ops where they cannot work)
onClick={() => { tap(); doThing(); }}

// A celebration at a rare moment (parent must be positioned; one at a time, one per 8 seconds)
{celebrating && <Moment kind="equalizer" onDone={() => setCelebrating(false)} />}

// A thing that travels to the next page; the destination carries data-vt="mix-art"
navigate('/mix/current/edit', { share: [[coverEl, 'mix-art'], [titleEl, 'page-title']] });
// names: mix-art, song-art, page-title, player-art, brand-mark, palette

// Music: a decorative child the beat bus pulses on measured kicks
<span data-beat="ring" aria-hidden="true" />            // inside Play's wrapper
<span data-beat="edge|glow|row" aria-hidden="true" />   // player edge, glowing thing, playing row
<span data-playing-bars aria-hidden="true"><i /><i /><i /></span>
useEffect(() => registerBeatTarget(ref.current!, 'ring'), []); // returns the unregister

// Covers: file art, then catalogue art, then the generated tile
<CoverArt seed={song.song_id} songId={song.song_id} size="hero" />
const { small, large, hue } = useSongArt(song.song_id, { large: true });
```

`Action` buttons show a drawn tick for a moment after their work resolves and a danger edge after it
fails; nothing to add.

## Tokens

- Springs: `--spring-gentle` (no overshoot), `--spring-snappy` (about 4%), `--spring-bouncy` (about
  16%); `--motion-spring-snappy`, `--motion-spring-release`, `--motion-spring-glide`, `--motion-stagger`.
- Depth and light: `--shadow-rest`, `--shadow-lift`, `--shadow-float` (dragging), `--edge-light`,
  `--glow-accent` (one lime peak per region), `--ambient-tint`, `--pointer-light`.

## When you add a keyframe

Name it `feel-...`, never loop it, and report its name and kind (answers-you or arrives) so it can be
added to `docs/engineering/motion-inventory.md` and the motion tests.
