# The mix editor on phones, tablets and desktops: research and design

Owner: the editor views (`web/src/views/Mix.tsx` and the files it imports). Flag: `editor.phone_layout` (on).
Written 2026-11-24, before the code. The "before" screenshots this starts from are described in
[What was wrong](#1-what-was-wrong-before).

The owner's words: "the view for the edit when we have a mix on my phone looks horrible; just do loads
of research and improve." People pay for SelectaDJ, so the editor has to feel like a finished,
professional product on every screen, starting with the phone.

## 1. What was wrong before

Measured in the SelectaDJ Cloud editor with a real ten-song mix, at 360x740, 390x844, 430x932, 740x360,
820x1180, 1024x768 and 1440x900, in Light and Dark, while the mix played.

1. **The first screen held no music.** On a 390x844 phone the pinned scope bar (about 150px), the page
   title (three lines of display type), a sentence of facts, four full-width buttons and the view switch
   filled the whole first screen. The first song started at the very bottom, under the mini player.
2. **The scope bar pinned 150px of a 740px screen** for the whole session: "Editing the current mix",
   "Changes here change what's playing", "Arrange view" and "Transitions worked out as it plays" on
   four lines. On a 360px phone, a fifth of the screen never scrolled.
3. **Ten songs took 3,800px**, about five phone screens. Each song was a 145px card and each transition
   another 145px: three to four songs per screen at best.
4. **Every song card wasted its left third** on a tall, empty grip well (the whole card height) with a
   tiny dotted mark. The song number floated under the motif, away from the title.
5. **Every row repeated the same four controls** (Play, Move up, Move down, More) as a second line, so
   the page read as a wall of identical buttons rather than a mix.
6. **"Add a song as number N" sat between every pair of songs**: ten extra rows of the same words.
7. **Every transition was two lines of controls**: "Picked as it plays" with a "Live" pill, then
   "Move" with a native select. It never said what would actually happen in plain words, and the
   connector line ran down a gutter that did not line up with the cards.
8. **A transition that went wrong was red body text** ("Scheduled here: Faded. This device has not been
   measured yet...") that pushed the next card down, with no fix offered beside it.
9. **The row menu held one item, Remove**, behind a three-dot button; there was no Move to top or
   Move to bottom, and Remove had no confirmation or explanation of Undo in place.
10. **Reordering by touch was a 52x100px empty box**; dragging it gave no visible feedback in the
    screenshots, and there was nothing to say where the song would land.
11. **Story view started below the fold** too, and repeated the header, then a long explanation.
12. **Nothing said where in the mix the music was.** The editor knew which song was playing ("Playing
    now" pill) but not how far through, and there was no way to jump to a transition.
13. **Landscape (740x360) showed one song card per screen** and the header alone took two screens.
14. **Tablet (820x1180) and desktop (1440x900)** stretched the same cards across the full width: a
    play button 900px from the title it plays, and a Move select at the far right edge.
15. **Small targets**: the native select, the Live pill row and the "as number N" text were under 44px
    tall; up and down arrows were 40px.

## 2. Research

Each finding: what it is, where it comes from, and what SelectaDJ does with it.

### 2.1 Layout and hierarchy

| Finding | Source | What we do |
|---|---|---|
| The active mix area should be the most prominent thing on screen; configuration and rare actions belong in secondary places, and the hierarchy should stay the same across views. Decorative motion "adds cognitive cost without adding information". | DJ.Studio, [Clean, modern, visual UI principles](https://dj.studio/blog/clean-modern-visual-ui-principles) | The song list starts on the first phone screen. Rare actions (Save a copy, New mix, Clear, Ask Lucy, Download) move into one "Mix actions" sheet. Motion is only the sheet rising and a row settling. |
| Show transitions with their entry and exit points, and keep their parameters visible and editable in context, not hidden in menus. | DJ.Studio, same article; [Transition editor help](https://help.dj.studio/en/articles/8106059-transition-editor) | Each transition is a connector between its two songs, saying what happens in words. Opening it shows the end of one song and the start of the next as real waveforms, and the choices beside them. |
| DJ.Studio separates a quick preset route (Carousel) from detailed work (Studio). | [DJ.Studio Studio view help](https://help.dj.studio/en/articles/8106005-studio-view-editing-arranging-controls) | The transition sheet shows the few choices that matter first; anything more detailed (Studio, exact cues, quality checks, where the server offers them) sits one step further in, in its own section. |
| Space is the scarcest thing on a small screen: IMG.LY let people collapse the timeline at any time and sized it to its contents. | IMG.LY, [Designing a timeline for mobile video editing](https://img.ly/blog/designing-a-timeline-for-mobile-video-editing/) | The header scrolls away with the page and only the slim mix strip stays pinned; the sheet opens at half height so the list stays in view above it. |
| IMG.LY snaps only to points visible on screen, gives "subtle feedback for snapping", and makes handle hit areas more than twice their drawn size. | IMG.LY, same article | Drag targets are the gaps between rows, the drop line snaps to the nearest gap, and the handle's 44px hit area is wider than its drawn mark. |
| Adobe balanced the player, the timeline and the inspectors on iPhone with progressive disclosure; tools expand from a single ribbon only when needed, and clearly labelled bottom-toolbar functions needed no training. | Adobe Design, [Behind the design: Premiere on iOS](https://adobe.design/ideas/behind-the-design-adobe-premiere-on-ios) | Every button has a word on it, not only an icon. Detail (what played here, what else is possible) is revealed inside the opened transition, not on the list. |
| YouTube Create keeps a sticky preview on top and puts tools in a context-aware bottom sheet in the thumb zone; the timeline stays partly visible while the sheet is open. | [Learning from YouTube Create](https://simplearyan.github.io/kinetix/blog/learning-from-youtube-create) (a third-party teardown) | The transition sheet opens to half height, so the two songs it joins stay visible above it. Its choices sit at the bottom of the sheet, where a thumb reaches. |
| CapCut puts a small square at each cut; tapping it opens the transition panel with a duration slider and Apply to all. | [CapCut help](https://www.capcut.com/help/transitions-in-capcut), [technobezz guide](https://www.technobezz.com/how-to-add-transitions-in-capcut) | A transition is its own tappable object between two songs, never a property hidden inside a song. |
| Serato on iPhone keeps the laptop layout; reviewers call it cramped, and find djay "slightly more intuitive" on a phone because of how its buttons are laid out and sized. | We Are Crossfader, [Serato DJ for iOS review](https://wearecrossfader.co.uk/blog/serato-dj-app/) | We do not shrink the desktop editor. The phone gets its own layout built from the same parts. |
| djay's Automix lets people pick songs and adjust transition type and duration; Apple Music's AutoMix is one switch in the queue. | [Digital DJ Tips djay review](https://www.digitaldjtips.com/reviews/algoriddim-djay-for-ios/), [Apple iPhone guide](https://support.apple.com/guide/iphone/aside/iphcba31c44b/ios), [9to5Mac on AutoMix](https://9to5mac.com/2025/06/16/automix-apple-music-ios-26/) | The default ("Let SelectaDJ pick") is always one tap away and always named, so choosing a move never feels like the only way to get a good transition. |
| rekordbox on phones is mainly for preparing playlists; one review notes the track order could not be changed there at all. | bonedo, [rekordbox for iOS test](https://www.bonedo.de/artikel/pioneer-dj-rekordbox-ios3-test/) | Reordering on a phone is a first-class job here, with a handle, a menu and the keyboard. |

### 2.2 Sheets

| Finding | Source | What we do |
|---|---|---|
| A resizable sheet has a grabber; tapping it cycles through the detents, and it works with VoiceOver. Medium (about half) and large detents; add medium on iPhone for progressive disclosure. | Apple HIG, Sheets ([mirror of the HIG text](https://unpkg.com/apple-hig-mcp@1.1.3/content/sheets.md)) | The sheet has a grabber that is a real button ("Make the sheet taller" / "Make the sheet shorter"). It opens at half height and snaps to half or full. |
| Support swiping down to dismiss, but never rely on it alone; show one sheet at a time; avoid a sheet on a sheet. | Apple HIG, Sheets | Swipe down closes; so do the Close button, Escape and the Back button. Opening another transition replaces the sheet's contents rather than stacking a second sheet. |
| On mobile, bottom sheets span the width; on larger screens their contents move into side sheets. | Material 3, [Bottom sheets](https://material.io/components/sheets-bottom) | Wider than 640px (and in phone landscape) the opened transition is a side pane, not a sheet. |
| A sheet must support the Back button and a visible Close; the grab handle is easy to miss; swipe-only dismissal is inaccessible; do not stack sheets; do not use sheets for long, complex content. | Nielsen Norman Group, [Bottom sheets](https://www.nngroup.com/articles/bottom-sheet/) | Back, Close and Escape all close it. Adding songs, which is longer and needs a keyboard, gets a full-height sheet of its own. |
| The keyboard does not change `dvh`; by default Chrome resizes only the visual viewport, and Safari has no opt-out, so anything pinned to the bottom has to follow `visualViewport`. | Chrome, [Viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior), [MDN Visual Viewport API](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API) | The shell already measures the keyboard (`--keyboard-inset`, Shell.tsx). The sheets size from it, so the search field in Add songs is never under the keyboard. |

### 2.3 Lists, reordering and touch

| Finding | Source | What we do |
|---|---|---|
| Use a small dedicated handle with `touch-action: none` and `user-select: none`, never the whole row, or the list cannot scroll. | Chrome, [Rearrange items with drag and drop](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/drag-and-drop) | Only the handle starts a drag; a finger anywhere else on a row scrolls the list. |
| Don't reorder siblings while the pointer moves; keep the item in its slot, lift it, and draw a drop marker in the gap; show nothing when the drop is its own slot. | Chrome, same guide | The lifted row follows the finger, the others stay still, and a line in the gap says where it will land, with the words "Drop to move it here, between X and Y". |
| Record the pointer that started the drag and ignore others, so a thumb holding the phone cannot start a competing drag. Use pointer capture. | Chrome, same guide | Done: the first pointer owns the drag; any second touch is ignored. |
| Auto-scroll near the edges, faster the further in; re-run the drop spot after each scroll step; avoid smooth scrolling on that container. | Chrome, same guide | Done with a frame loop that stops at the end of the drag. |
| Visible move buttons or an actions menu are the best default for discoverability and screen readers; Escape cancels; announce the new position only when it changed. | Chrome, same guide; WCAG 2.2, [Dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) | Each song's menu has Move up, Move down, Move to the top and Move to the end. The handle keeps the existing Space-and-arrows keyboard mode. |
| Spotify puts the reorder handle at one end of a row and remove at the other in Edit; it later moved to press-and-hold, and its forums are full of people who could not find it. UIKit edit mode does the same (delete on the leading edge, reorder on the trailing edge). | [Spotify community: Edit a playlist on mobile](https://community.spotify.com/t5/FAQs/Edit-a-playlist-on-mobile/ta-p/4918572), [Spotify community thread](https://community.spotify.com/t5/Your-Library/Mobile-Rearrange-songs-in-a-playlist/td-p/4676785) | A handle is always visible on the trailing edge, never a hidden long-press. Remove lives in the song's menu, away from the handle, so a slip can't delete a song. |
| Targets: WCAG 2.2 AA needs 24x24 CSS px (or spacing); Apple 44pt, Material 48dp; aim for 44x44. | W3C, [Target size (minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum); [Smashing Magazine](https://smashingmagazine.com/2024/07/getting-bottom-minimum-wcag-conformant-interactive-element-size/) | Every control in the phone editor is at least 44x44 (`--control-height`). |
| GarageBand gives precision by zooming and snapping to the grid, and turns snapping off only when asked. | Apple, [GarageBand for iPhone: Snap to Grid](https://support.apple.com/en-ca/101913) | Where exact cues exist (local mode), they are bar and phrase boundaries chosen from a list (snapped), not a free-dragged position. |
| BandLab mobile users ask for finer control and BandLab answers "turn off snap"; its "shift" nudge is mobile-only. | [BandLab App Store reviews](https://apps.apple.com/app/968585775), [Pratt IxD critique](https://ixd.prattsi.org/2025/09/design-critique-bandlab-music-making-studio-mobile/) | Fine adjustment is a dedicated, named section ("Exact cues"), not a hidden setting. |

### 2.4 Sizes and devices

| Finding | Source | What we do |
|---|---|---|
| Window size classes: compact under 600, medium 600 to 839, expanded 840 and up; decided by the window, never the device. List-detail shows one pane on compact and medium, two on expanded. | Android, [Use window size classes](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes), [Canonical layouts](https://developer.android.com/guide/topics/ui/layout/canonical-layouts) | Compact: one column, transition in a bottom sheet. Medium, expanded and phone landscape: two panes, the list and the opened transition side by side. Decided with `matchMedia`, never the user agent, at the app's own canonical breakpoints (`styles/breakpoints.ts`: 640 for phones, which sits between Material's 600 and the largest phones held upright, and 1100 for laptops). |
| Safe areas: fixed bars need `env(safe-area-inset-*)`, including left and right in landscape. | MDN, [env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env) | The sheet pads its bottom by `--safe-bottom` and its sides by the left and right insets. |

## 3. Design

### 3.1 Principles

1. **The mix is the page.** The first phone screen shows songs.
2. **A transition is an object.** It sits between its two songs, says in words what happens, and opens
   on a tap.
3. **One tap to the default.** "Let SelectaDJ pick" is always the first choice.
4. **Honest.** Only what the runtime can really do is offered. A browser mix's transitions are worked
   out as it plays, so there is no fake render progress, no length slider the browser would ignore and
   no A/B of clips that do not exist.
5. **Every gesture has a button.** Drag has a menu; swipe has Close and Back; the grabber is a button.

### 3.2 Phone (compact, up to 640px)

From the top:

- **Header.** One line of scope ("Current mix · changes play now" or "Draft · what's playing isn't
  touched"), the mix's name (two lines at most, `--type-page`), and one facts line: "10 songs · 23 min ·
  Saved". The save state reads "Saved", "Saving..." while a change is on its way, or "Not saved" with
  Try again after a refusal. Below: the main action (Play from the top, or Play this mix), Undo when
  there is something to undo, and "Mix actions" for the rest.
- **Mix map.** A slim strip, pinned under the app bar while the list scrolls: one segment per song,
  sized by length, a notch at each transition, and a playhead while the current mix plays. Tapping a
  segment plays from that song; its label says "Song 3 of 10, 1:20 of 3:40". This is where the mix is,
  at a glance. It does not add a second player at the bottom: the shell's own mini player is already
  there, above the bottom bar, and a third pinned bar would take a quarter of a 740px screen.
- **The story.** An ordered list of songs. Each song is a 64px row: its number (or a playing mark),
  title and "artist · 3:22", a menu button and a reorder handle on the trailing edge. Between two songs,
  a 44px connector: a vertical line from the song above, a state mark (ready, preparing, worked out as
  it plays, problem) and a few words ("Echo out", "SelectaDJ picks as it plays", "Played: Blend",
  "Fell back to a fade"). Tapping it opens that transition.
- **Add songs.** One button at the end of the list, and "Add a song after this" in each song's menu.
  It opens a full-height sheet with search.

The song menu (a sheet, so every item is a 44px row): Play from here, Move up, Move down, Move to the
top, Move to the end, Add a song after this, Lock (where songs can be locked), Remove. Remove shows the usual "Removed
X" notice with Undo.

The transition sheet, opened at half height:

- Grabber (a button), the title "Into {next song}", and Close.
- **The picture.** The last part of the outgoing song and the first part of the incoming one as real
  waveforms (decoded on this device, where the shell offers them), overlapping where the move overlaps
  them: a cut meets edge to edge, a blend overlaps, an effect tail trails off. While the waveforms load,
  or where there are none, the existing seam drawing stands in.
- **What happens now**, in a sentence, with its state.
- **The move**, as large choices in a grid, "Let SelectaDJ pick" first. A move the device can't play
  says why.
- **Hear it.** Plays the current mix from 35 seconds before this transition (a draft offers "Play
  the draft from {song}").
- **Compare with SelectaDJ's pick.** When a move is chosen: "Try SelectaDJ's pick" switches to the
  default and plays the transition again; "Back to {move}" switches back. Both are real choices saved
  as they are made, so what is heard is what is in the mix.
- The local app, where the server renders transitions, keeps its classic editor at every size (see 3.4).

Gestures: swipe the grabber or header down to shrink, then to close; up to grow. A swipe that starts in
the sheet's scrolled content only scrolls it. Escape and the Back button close it. Focus goes into the
sheet on open and back to the connector on close.

### 3.3 Phone landscape, tablet and foldables (wider than 640px, or under 500px tall)

Two panes: the story on the left; the opened song or transition on the right, sticky under the app
bar, with its own scroll. Nothing opens as a sheet except Add songs and Mix actions. With nothing open,
the right pane says "Choose a transition to hear or change it" and shows the mix's facts.

### 3.4 Desktop (wider than 1100px)

A browser mix (Cloud) uses the same two panes at desktop width, so the list is a readable column and the
opened transition sits beside it.

### 3.5 The local app keeps its classic editor at every size

The local app renders every transition and opens it in the transition inspector (Listen, Change with
exact cues, Studio, Details, Compare with before), and its browser tests hold promises at small sizes
this layout does not yet keep in the same way: at 320px the inspector is reached from a Change button
beside the mini-player, the full Studio grid scrolls and the keyboard reaches all of it, names stay
whole, the pages reflow at 400% zoom, and its states are paired in Light and Dark at 375x667. So
`editorLayout.ts` gives the classic editor whenever the transition inspector is on. Bringing the local
app across means opening the inspector and the Studio from the sheet and the pane with those promises
kept, and moving those tests to the new layout in the same change.

### 3.6 States

| State | What it says and does |
|---|---|
| Ready | A filled tick mark: "Blend", "Echo out". |
| Worked out as it plays | An outlined mark: "SelectaDJ picks as it plays", or the chosen move. |
| Played here | "Played: Blend" after the device played it this visit. |
| Problem | A warning mark and "Fell back to a fade"; in the sheet the reason and the fix ("Choose another move, or let SelectaDJ pick"). |
| Preparing (where the server renders) | A working mark: "Rendering now", "Waiting in line", as the connector's words. |
| Failed (where the server renders) | "Couldn't be made", as the connector's words. |
| Saving | "Saving..." in the facts line; the moving row is marked and announced. |
| Not saved | "Not saved" with Try again, and the reason. |
| Offline | The connection banner (shell) says what still works; the editor's writes queue as they do today. |
| Empty / one song | The existing empty pages, with Add a song. A browser mix keeps at least two songs and says so. |
| Playing while editing | The playing song's row shows a playing mark; the mix map's playhead moves. |

### 3.7 Words

- Connector: what happens, in at most four words, and nothing else.
- Buttons are verbs: "Hear it", "Play from here", "Move to the top", "Add songs", "Mix actions".
- Never "seam" on screen; always "transition".
- No em dashes anywhere.

### 3.8 Motion

The sheet rises over `--motion-overlay` and settles at its detent; a moved row settles over
`--motion-reveal`. Both are tokens, so Subtle shortens them and Still and reduced motion take them to
0ms. No looping motion.

### 3.9 Accessibility

The story is an ordered list; each song is an `h3` inside its item, and each transition a button that
names both songs. The handle is a button ("Reorder X") with the existing Space and arrow keys. The sheet
is the app's own dialog (focus moved in, trapped, returned; Escape closes), plus a grabber button. At 200
percent zoom the page is narrower than 640 CSS px, so it gets the one-column layout, which reflows.

### 3.10 The flag

`editor.phone_layout`, on by default. Off: the editor is exactly as before at every size.

## 4. What was proved, and how

Measured on a local Cloud stack with a real ten-song browser mix playing, in Playwright.

- **Screenshots** at 360x740, 390x844, 430x932, 740x360, 820x1180, 1024x768 and 1440x900, Light and Dark: the
  list (top, middle, end), a transition open at half and full height, a song's menu, carrying a song,
  adding a song and a refused change. Each was opened and compared with the same state before. No page
  scrolls sideways at any size, and the end of the list (Add songs) clears the mini player and the
  bottom bar.
- **Touch, Chromium (real touch events through the DevTools protocol): 17 of 17.** A finger on a row
  scrolls the list and moves nothing; the handle carries a song, the other rows stay still, a line shows
  where it lands and letting go moves it; a second finger during the carry is ignored; Move to the top
  in the song's menu puts it back; a transition opens at half height (432px of 720px), swipes up to full
  (672px), down to half and down again to close; Back closes it and stays in the editor; Escape closes
  it and focus returns to the transition; the strip names the song under the finger and letting go
  plays from it.
- **Touch, WebKit (pointer events as a touch makes them, since Playwright's WebKit has no touch
  protocol): 14 of 15.** Everything above but real scrolling, which needs real touch. Focus going back
  to the transition first failed here, because Safari does not focus a button it was pressed with; the
  pressed button now takes focus itself, and it passes. The strip's play could not be checked: this
  WebKit build cannot decode the test MP3s, so it hands playback to the other open device.
- **Unit tests**: `web/src/views/editorLayout.test.ts` and `web/src/views/PhoneEditor.test.tsx`.

## 5. What could not be checked here

- Real phones: everything was measured in Playwright's Chromium and WebKit with touch emulation.
  Haptics, the iOS Safari toolbar, the real on-screen keyboard and the system Back gesture need a
  real device.
- Redo: the server keeps one undo, not a redo history, so there is no Redo button.
- Fine adjustment of a browser mix's transition (its length and where it starts): the browser runtime
  takes only the move, so there is nothing honest to adjust yet. Exact cues stay where the server
  renders transitions (local mode's inspector, `seam_inspector.exact_cues`).
- The current mix's name is not editable from the editor: there is no rename for the current mix, only
  for drafts (Mix actions, Rename) and Save a copy.
