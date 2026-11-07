# Selecta 3.0: accessibility

Covers S3-0067-01, S3-0067-02, S3-0067-05, S3-0067-06, S3-0051-02 and S3-0050-06. The target is WCAG 2.2 AA across the essential journeys.

**No screen reader has been used on this work.** Automated axe checks, keyboard tests in a real browser and reading the code are what exist. S3-0067-08 and every "Verified" status stay open until a person runs the scripts below.

## How each criterion applies

| Criterion | Applies to | How it's met |
|---|---|---|
| 1.3.1 Info and relationships | All | Landmarks, headings, lists, labelled groups; `Field` ties label, help and error together |
| 1.4.1 Use of colour | All statuses | `Status` always adds a mark and words. Studio cells add shape as well as colour |
| 1.4.3, 1.4.11 Contrast | Both themes | Automated axe checks in both; non-text contrast is reviewed from screenshots |
| 1.4.4, 1.4.10 Resize and reflow | All | No two-way scrolling at 320px except the Studio grid, which is inherently 2D |
| 1.4.13 Content on hover | Tooltips | Dismissed by Escape, hoverable, persistent |
| 2.1.1 Keyboard | All | Everything essential, with tests per journey |
| 2.1.2 No keyboard trap | Overlays, grid | Overlays close on Escape and the grid leaves by Tab |
| 2.1.4 Character shortcuts | Global keys | They only fire when focus isn't in something that takes keys, and can be turned off in the shortcuts dialog |
| 2.4.1 Bypass blocks | Shell | Skip link, landmarks |
| 2.4.2 Page titled | All | From the route manifest |
| 2.4.3 Focus order | Overlays, page changes | Focus goes into overlays and returns; a page change goes to its start |
| 2.4.7, 2.4.11 Focus visible, not obscured | All | `scroll-padding` from the same numbers as the bars; bars step aside for a keyboard |
| 2.5.1 Pointer gestures, 2.5.7 Dragging | Timeline, energy arc | Move up and Move down, and five sliders. Nothing needs a drag |
| 2.5.8 Target size | All | 44px controls by default, compact is 36px, and the minimum is 24px |
| 3.2.2 On input | Filters, selects | Only changes what's shown, and history records a chosen filter |
| 3.3.1, 3.3.3 Errors | Forms | Inline, associated, with what to do next |
| 4.1.2 Name, role, value | Custom widgets | See the table below |
| 4.1.3 Status messages | All | `announce`, `role="status"`, `role="alert"` |

## Custom widgets against the ARIA patterns

| Widget | Pattern | Keys | Value or state |
|---|---|---|---|
| Waveform | Slider | Arrows ±5s, PageUp/Down ±30s, Home, End | `aria-valuetext` in minutes and seconds. In a transition it says why it can't move |
| Volume, storage, energy stops | Native range | Native | `aria-valuetext` where a bare number isn't enough |
| Energy arc drawing | Image plus sliders | The sliders are the keyboard way | Named per stop |
| Dialog, sheet, drawer, workspace | Modal dialog | Tab stays in, Escape closes | `aria-modal`, labelled; everything underneath is `inert` |
| Menu | Menu button | Arrows, Home, End, Escape, Tab closes | `aria-haspopup`, `aria-expanded`, `role="menuitem"` |
| Inspector tabs | Tabs | Arrows, Home, End, one tab stop | `aria-selected`, `aria-controls` |
| Studio | Grid | Arrows, Home, End, Space, one tab stop | `aria-pressed` on each square, named by song, part and square |
| Timeline row handle | Button | ArrowUp and ArrowDown move the song | Result announced |
| Command palette | Combo box and list box | Arrows, Enter, Escape | `aria-activedescendant`, `aria-selected`, `aria-disabled` |
| Page sections | Links with `aria-current` | Tab | Deliberately links, because they have addresses |

## What gets announced, and what doesn't

Once: each new song, a page change, an action's result, a failure. Never: the clock, progress ticks, polling. The same words again within 8 seconds aren't repeated. The live region and toasts sit outside the page, so they still speak while a dialog has the page inert.

## Metadata

Titles and artists use `unicode-bidi: plaintext`, so Hebrew or Arabic reads the right way round beside anything else. Long names wrap rather than vanish, and a control's accessible name carries the full title. Missing values read "Untitled" and "Unknown artist".

## Scripts for a person

Record the device, OS, browser, screen reader and versions, what worked and what didn't. Do each with NVDA on Windows, VoiceOver on a Mac if one's available, and TalkBack for the phone-sized journeys, then again by keyboard only.

1. **First run.** Reach the folder field. Hear its help. Enter a wrong path and hear why. Enter a right one. Hear the progress without being talked over.
2. **Playback.** Start a mix. Hear the song's name once. Pause. Seek with the waveform and hear the time. Go to another page and hear where you are, with the music still playing.
3. **Editing.** Open the timeline. Move a song and hear where it went. Add a song by position. Open a transition, change its move, and hear what's rendering. Undo it.
4. **Requests.** Ask for a song. Hear its state change without chatter. Approve a bridge after hearing each transition's status.
5. **Studio.** Tab to the grid once. Move with arrows and hear each square. Turn squares on and off with Space. Solo a part. Apply it.
6. **Export.** Start one, close the panel, find it again in Activity, and download it.
7. **Zoom.** Repeat 2 and 3 at 200% and 400% browser zoom, with large text set in the system. Nothing focused should be hidden, and nothing should need scrolling both ways except the Studio grid.

## Known limitations

- The Studio grid scrolls sideways on a phone, which is allowed because it's inherently 2D.
- Text in the display face leans on system fonts, and fallback rendering is only as good as what's installed.
