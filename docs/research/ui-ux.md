# Steerable auto DJ UI/UX: research notes (4 Nov 2026)

**Tags:**
- `solid/research`: measured study.
- `solid/doc`: primary product or platform doc, so a product convention or platform rule.
- `practitioner`: designer, expert or press writing.
- `anecdotal`: forum, marketing or opinion.

"Inferences" and the final section are my own judgement.

**Reading depth:** I read Jin, Millecamp, Kulesza, Kizilcec, Salimpoor, Buell & Norton and Harrison only at abstract or excerpt level. The rekordbox guide and Tom's Guide pages wouldn't load, so those claims rest on search excerpts.

## 1. DJ software conventions

### Takeaway
Waveform conventions exist so people can beatmatch by eye. Selecta should keep the "where are we, what's next" parts and drop the rest.

### Cited Findings
- `solid/doc` Mixxx pairs a zoomed waveform (fixed centre playhead, white beat lines) with a whole-track overview (played part darkened, click to seek). Parallel layout is the default so beats can be matched visually. The overview flashes red about 30 s before the end. [Mixxx manual](https://manual.mixxx.org/2.5/en/chapters/user_interface.html)
- `solid/doc` rekordbox labels phrases Intro, Up, Down, Chorus, Bridge, Verse and Outro under the waveform, flags fill-ins, and allows editing. [Guide excerpt](https://manuals.plus/rekordbox/alphatheta-phrase-analysis-manual)
- `anecdotal` One user calls this kind of detection error-prone enough to need hand-editing. [VirtualDJ forum](https://virtualdj.com/forums/257055/Wishes_and_new_features/Phrase_Analysis.html)
- `practitioner` rekordbox RGB uses red for bass, yellow/green for mids and blue for highs. 3-Band uses blue, amber and white. RGB can overwhelm, and commenters prefer 3-Band for spotting drops and vocals. [Substack](https://reallychrism.substack.com/p/the-secret-language-of-waveforms)
- `practitioner` Serato maps red, green and blue to bass, mid and treble. [DJ TechTools, 2010](https://djtechtools.com/2010/01/05/understand-your-wave-forms) One reviewer finds its fixed colours distracting. [Digital DJ Tips](https://www.digitaldjtips.com/review-traktor-pro-2/)
- `practitioner` Traktor added parallel waveforms (Full and Slim) in 3.1, after reviewers called them its main omission. [Digital DJ Tips](https://www.digitaldjtips.com/traktor-pro-3-1-brings-parallel-waveforms-traktor-kontrol-s4-mk3-mixer-mode/)
- `solid/doc` djay Automix has a queue fed by Manual, Matching Songs or Current Playlist, plus transition, duration, tempo and song-range settings. Automatic picks an effect at random, and Mix Now finds the earliest suitable blend point. [djay manual](https://help.algoriddim.com/user-manual/djay-pro-windows/mixing-basics/using-automix) A white line marks the mix-out and a pencil edits it. [Mac manual excerpt](https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/using-automix)
- `anecdotal` DJ.Studio's own copy describes per-track energy segments with numeric intensity. [Vendor](https://dj.studio/blog/mixed-in-key-integration)
- `practitioner` Spotify Mix shows two waveforms, BPM and Camelot keys, with presets plus volume, EQ and effect curves. [Engadget](https://www.engadget.com/entertainment/music/spotify-now-lets-you-create-seamless-transitions-between-songs-on-your-custom-playlists-100051537.html) Launch coverage says it suits house and techno best. [Excerpt; exact page not pinned](https://newsroom.spotify.com/tag/transitions)

### Inferences
- **Keep:** whole-song overview, dimmed played part, section labels, exit marker, time to next transition.
- **Drop:** beat ticks, phase-aligned parallel waveforms, frequency colouring, key codes, hot cues.
- Low frequencies are red in one app and blue in another, so no colour convention is worth inheriting. Spend colour on section and transition type.
- Mixed genres mean some pairs won't blend. The UI needs a dignified way to present a plain cut.

### Gaps
- rekordbox's exact phrase palette and mood variants are unverified.
- VirtualDJ's display, and Traktor's and Serato's phrase and energy views, were not reached.
- I found no independent DJ.Studio review.

## 2. Lean-back automated experiences

### Takeaway
People praise low-effort steering and resent machines that talk or hide their plans.

### Cited Findings
- `practitioner` AutoMix uses time-stretching and beat-matching. [MusicTech](https://musictech.com/news/gear/apple-music-automix-ai/) It replaces Crossfade and is on by default. [MacRumors](https://www.macrumors.com/2025/06/12/ios-26-automix-apple-music/) It doesn't promise a beat-matched mix for every pair, but one reviewer rates it a solid upgrade for casual listeners. [iGeeksBlog](https://www.igeeksblog.com/apple-music-automix-in-ios-26/)
- `anecdotal` AutoMix complaints are thin and mostly from the betas. [TechIssuesToday](https://techissuestoday.com/ios-26-brings-automix-to-apple-music-but-some-say-its-painfully-bad)
- `anecdotal` The loudest Spotify DJ complaint is the voice, in a [turn-it-off thread](https://community.spotify.com/t5/Your-Library/How-do-I-turn-off-the-ai-dj/td-p/5513222/highlight/true/page/15) whose URL reaches page 15. Repetition is next. [PiunikaWeb](https://piunikaweb.com/2023/07/04/spotify-ai-dj-keeps-playing-the-same-recently-played-songs/)
- `practitioner` A reviewer likes that the button jumps to another genre, artist or mood. [Tom's Guide excerpt](https://www.tomsguide.com/opinion/ive-been-using-spotify-dj-for-a-month-heres-5-things-i-love-and-hate)
- `solid/doc` Plexamp's Guest DJ modes (Stretch, Contempo, Groupie, Doppelgänger) are named personas that require Sonic Analysis. [Plex release notes](https://forums.plex.tv/t/plexamp-release-notes/221280/72)
- `practitioner` Sonic Adventure connects a chosen start track to a destination track. [Sound & Vision excerpt](https://www.soundandvision.com/content/plexamp-s-sonic-sage-uses-chatgpt-improved-discovery)
- `anecdotal` Roon thread titles show the friction: a [hidden queue](https://community.roonlabs.com/t/why-is-the-play-queue-in-roon-radio-hidden/89065?page=2), [being asked why you skipped](https://community.roonlabs.com/t/stop-asking-why-i-skipped-a-track/71894), and [rating a track before hearing it](https://community.roonlabs.com/t/how-to-decide-do-i-like-dislike-the-roon-radio-pickup-without-hearing-the-song/156078/3). I read these at title or excerpt level.
- `practitioner` Tuned Global [acquired Pacemaker in 2023](https://www.musicbusinessworldwide.com/tuned-global-acquires-ai-powered-music-tech-and-dj-app-company-pacemaker12/). `anecdotal` A competitor says it is [no longer available](https://dj.studio/blog/pacemaker-app-alternative).

### Inferences
- Show the machine's agency through a visible plan, not a voice.
- Plexamp's persona names are a cheap way to summarise a policy.
- Sonic Adventure's start-to-destination idea is the closest precedent for a steerable path.

### Gaps
- I could not verify what AutoMix or Spotify DJ draw on screen during a transition.
- Roon's now-playing behaviour and Pacemaker's interface details were not reached.
- I found no recent review of Spotify DJ's voice requests.

## 3. Steering without taking over

### Takeaway
Acknowledge instantly, state when the change will land, and make undo cheap.

### Cited Findings
- `solid/research` In a between-subjects study (N=240, eight settings), controlling the recommendations was the most favoured single control. Profile plus algorithm-parameter control was the best combination. [Jin et al. 2018](https://research.tudelft.nl/en/publications/effects-of-personal-characteristics-on-music-recommender-systems-/)
- `solid/research` High-level control gave the best recommendations but the highest cognitive load. [Jin et al. 2017, excerpt](https://ceur-ws.org/Vol-1884/paper7.pdf)
- `solid/research` Moodplay offers a navigable mood space with a mood-influence slider. [UMAP 2016](https://dparra.sitios.ing.uc.cl/pdfs/Moodplay_UMAP_2016.pdf)
- `solid/research` The 18 human-AI guidelines were tested by [49 practitioners on 20 products](https://www.microsoft.com/research/publication/guidelines-for-human-ai-interaction/). They include efficient dismissal and correction, global controls, conveying consequences, and adapting cautiously. [Microsoft](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/)
- `practitioner` The limits are 0.1 s (feels instant), 1 s (flow intact) and 10 s (attention holds). [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/) These derive from older work, and Miller's table was more granular. [Critique](https://feelsfast.vercel.app/concepts/canonical-thresholds)
- `practitioner` Prefer undo for routine actions, because frequent confirmations train reflexive yeses. [NN/g](https://www.nngroup.com/articles/confirmation-dialog/)
- `solid/doc` A longer scheduling lookahead delays when control changes take effect. [web.dev](https://web.dev/articles/audio-scheduling)
- `anecdotal` A user complains that a chosen djay transition type reverts after one song. [Forum](https://community.algoriddim.com/t/automix-neural-mix-transition-type-keeps-going-back-to-automatic/26199)

### Inferences
- Give one-tap steering first, with the curve as an optional deeper layer.
- A drawn curve is a wish, not a command. Show what the library can actually deliver.
- User intent must never silently revert.

### Gaps
- I found no study of pending-state design for delayed effects, and no credible energy-curve editor precedent. Both are design territory to test.
- Liang & Willemsen's mood-control work did not surface.

## 4. Explanation, trust and feedback

### Takeaway
Keep explanations moderate, truthful and on demand, and offer more when the system surprises. Make feedback one gesture and never ask for a reason.

### Cited Findings
- `solid/research` Trust peaked at moderate transparency (N=103, peer grading, not music). Explaining the process helped when expectations were violated, and extra information eroded trust. [Kizilcec 2016](https://www.cs.mcgill.ca/~jeromew/data/COMP766/CHI2016/p2390-kizilcec.pdf), [WARC summary](https://www.warc.com/newsandopinion/news/algorithms-how-too-much-transparency-can-backfire/40803)
- `solid/research` People quickly built sound mental models of a music recommender. [Kulesza 2012](https://researchr.org/publication/KuleszaSBK12) Completeness mattered more than soundness, but very unsound explanations raised mental demand and lowered trust. [Kulesza 2013](https://eprints.gla.ac.uk/261399)
- `solid/research` Personal characteristics change how explanations land, in a within-subject music study. [Millecamp 2019](https://dblp1.uni-trier.de/rec/conf/iui/MillecampHCV19.html)
- `solid/doc` Netflix reports a 200% rise in ratings activity after moving from stars to thumbs. [Netflix](https://about.netflix.com/en/news/goodbye-stars-hello-thumbs) Coverage states the figure differently, so its exact meaning is unclear. [VentureBeat](https://venturebeat.com/2017/04/05/netflix-ditches-5-star-rating-system-for-thumbs-up-and-thumbs-down)
- `practitioner` (measured, 2014 data) 24.14% of Spotify plays were skipped in the first 5 s, 35.05% within 30 s, and 48.6% before the end. Most skips came in the first 20 s or so. [Lamere](https://musicmachinery.com/2014/05/02/the-skip/)

### Inferences
- Explanations must come from real planner factors, because invented reasons are the expensive failure.
- Skips are plentiful and noisy. Treat a skip soon after a transition as weak evidence against that transition, and a later skip as a song signal.

### Gaps
- I found no study of rating transitions, as opposed to songs.
- Millecamp's effect sizes were not read.

## 5. Lyrics and delight

### Takeaway
Treat lyrics as typography, not a karaoke overlay. Timing accuracy matters more than effects.

### Cited Findings
- `solid/doc` Apple Music Sing offers precisely timed real-time lyrics. [Apple](https://www.apple.com/uk/newsroom/2022/12/apple-introduces-apple-music-sing/)
- `practitioner` Apple's lyrics are described as a full-screen typographic experience with word timing and blurred inactive lines. [Crosley](https://blakecrosley.com/guides/design/apple-music)
- `practitioner` Many catalogue tracks are line-synced only. [Engineering blog](https://dev.to/vimu_kale_4b5058f002ff8b1/how-apple-music-maps-audio-to-lyrics-the-engineering-behind-real-time-lyric-sync-4fin) One web component falls back to a faster line fade when timing is coarse. [am-lyrics](https://www.pkgstats.com/pkg:@uimaxbai/am-lyrics)
- `anecdotal` One writer finds Spotify's lyric sync often a beat behind. [Desirability Lab](https://desirabilitylab.com/backfill/backfill-2023-40-apple-music-vs-spotify-lyrics)
- `solid/research` Dopamine release involved the caudate during anticipation and the nucleus accumbens at peak response. [Summary](https://brams.org/2011/01/09/salimpoor/), [DOI](https://doi.org/10.1038/nn.2726)

### Inferences
The neuroscience supports treating the build-up as part of the reward, by analogy only. Restraint is the anti-cheese rule. Mis-timed word lighting is worse than none.

### Gaps
- I found no study of visual cues for anticipation and no first-party design rationale.
- Nothing confirmed Spotify's word-level state in 2026.
- Perceptual tolerance for lyric-to-audio offset was not reached.

## 6. First run and long background work

### Takeaway
Music comes first and analysis keeps deepening it. Show counts of real work and proof of life, not one percentage.

### Cited Findings
- `practitioner` (reports a study) Users with a moving indicator waited about three times longer. Use percent-done from 10 s, show step counts, give generous rough estimates, avoid racing then stalling, and allow stopping. [NN/g](https://www.nngroup.com/articles/progress-indicators/)
- `practitioner` Beyond 10 s people switch tasks, so say when work will finish and help them reorient. [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)
- `solid/research` Visible effort raised perceived value, even with longer waits for identical results. The authors propose a running tally of results in place of a bar. [Buell & Norton](https://doi.org/10.1287/mnsc.1110.1376)
- `solid/research` Bar motion changes perceived duration. [Harrison 2007](https://www.chrisharrison.net/index.php/Research/ProgressBars)
- `anecdotal` Plex forum replies say analysis can take days or weeks; one 20k-album library took 12 days at full CPU. Generic status text leaves users reading CPU load as a sign of life, and some counts stall. [Thread 1](https://forums.plex.tv/t/sonic-analysis-has-processed-6-albums-in-40-minutes/735992?page=9), [Thread 2](https://forums.plex.tv/t/sonic-analysis-makes-no-progress-not-working/738689)
- `anecdotal` Roon separates background from on-demand analysis. Throttled mode can look stalled, and users say full analysis can hurt playback. [Thread 1](https://community.roonlabs.com/t/background-audio-analysis-speed/148504), [Thread 2](https://community.roonlabs.com/t/1-3-audio-analysis-taking-a-very-long-time-normal/19315)
- `anecdotal` Engine DJ users report 15-20 s per stems track and 26 hours for about 6,000 songs. [Forum](https://community.enginedj.com/t/slow-scanning-of-stems-tracks/60413)

### Inferences
- Stalled-looking progress is the main trust killer, more than slowness. Show what finished last and when.
- Only show labour that is real, since the labour illusion is easy to abuse.

### Gaps
- I found no credible time-to-first-sound benchmark. Selecta's own throughput needs measuring before any estimate is shown.
- There is no controlled analysis benchmark across rekordbox, Serato and Traktor.
- rekordbox stall reports exist on Pioneer DJ's forums, but I couldn't tie them to specific threads, so I left them out.

## 7. Library at scale

### Takeaway
Show exceptions, not numbers everywhere, and make corrections one tap and permanent.

### Cited Findings
- `solid/research` Accuracy1 allows 4% tolerance, and Accuracy2 also forgives factor-of-2 and factor-of-3 errors. [ISMIR 2017](https://archives.ismir.net/ismir2017/paper/000137.pdf) One CNN scored about 0.58 and 0.96 on [WJD](https://tempoeval.github.io/tempo_eval_report/wjd.html). The top model scored about 0.80 and 0.91 on [GiantSteps](https://tempoeval.github.io/tempo_eval_report/giantsteps_tempo.html).
- `solid/research` Guidelines cover stating how well the system performs and scoping services when in doubt. [Microsoft](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/)

### Inferences
Half-time and double-time are the expected BPM errors, so offer ×2 and ÷2 before a number field. Use "sure", "unsure" and "not yet" instead of percentages.

### Gaps
- I found no sources on audiobook filtering UX or on confidence displays in music libraries.
- Key-detection accuracy did not surface, and list performance at 1,400 rows was not reached.
- This is the thinnest section, and most of its design advice is judgement.

## 8. Visual language and performance

### Takeaway
Default to Canvas 2D with precomputed data and treat WebGL as an optional extra.

### Cited Findings
- `solid/doc` Use layered canvases, pre-rendering, integer coordinates and `alpha: false`, and redraw only differences. Avoid `shadowBlur` and text rendering where possible. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- `solid/doc` Peaks.js recommends precomputed waveforms for long files because browser decoding is CPU-intensive. It draws with canvas. [BBC](https://github.com/bbc/peaks.js)
- `solid/doc` Butterchurn (MilkDrop in the browser) requires WebGL 2 and gives no hardware benchmarks. [GitHub](https://github.com/jberg/butterchurn)
- `practitioner` OffscreenCanvas supports 2D and WebGL in a worker. [Kinney](https://stevekinney.com/courses/react-performance/offscreen-canvas-webgl)
- `solid/doc` The audio render budget is about 2.67 ms at 48 kHz. The worklet thread isn't real-time priority, GC blocks it, and a larger `latencyHint` helps. [web.dev](https://web.dev/articles/profiling-web-audio-apps-in-chrome)
- `solid/doc` (archived 2020) TV information density should resemble a phone. Keep essentials out of the outer 5%, use at least 15 epx at 200% scale for main text, avoid tooltips, and don't rely on subtle colour differences. [Microsoft](https://learn.microsoft.com/en-us/windows/apps/design/devices/designing-for-tv)
- `solid/doc` No more than three flashes per second, subject to area and red-flash thresholds. [W3C](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html)

### Inferences
- Selecta already knows beats, sections and energy in advance, so visuals need no analyser node and can anticipate.
- For identity, go type-led with sound-system poster energy, since the signature feature is literally words.

### Gaps
- I found no measured Canvas versus WebGL data on Intel UHD, so benchmark on the target laptop.
- Designer case studies of distinctive music interfaces were not found.
- The cost of `backdrop-filter` and large blurs is unverified.

## 9. Web platform constraints

### Takeaway
Audio-making tabs get protection from throttling, while paused, silent or reloaded ones lose it. Design every state around that.

### Cited Findings
- `solid/doc` An AudioContext created before a gesture starts suspended. Check `state`, and don't show a pause button unless audio is running. Installed PWAs and the Media Engagement Index can relax the rule. [Chrome](https://developer.chrome.com/blog/autoplay)
- `solid/doc` Pages that are visible or made sound in the last 30 s get minimal throttling. Hidden pages drop to once a second. After 5 minutes hidden, chain count ≥5 and 30 s of silence, they drop to once a minute. Silent tracks don't count, and the article doesn't name Web Audio specifically. [Chrome](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- `solid/doc` Memory Saver exempts active audio and pinned tabs. Energy Saver can stop CPU-heavy background tabs on battery, except those playing audio. [Google](https://support.google.com/chrome/answer/12929150)
- `solid/doc` Schedule on the audio clock, and have `requestAnimationFrame` read `currentTime`. [web.dev](https://web.dev/articles/audio-scheduling)
- `solid/doc` `outputLatency` estimates device latency (Baseline 2025). [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- `solid/doc` Media Session exposes metadata and media keys but has limited availability, so feature-detect it. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- **Conflict:** Chrome's docs say Web Audio shows no media notification unless played through an audio element. [Chrome](https://developer.chrome.com/blog/media-notifications/) A Mozilla bug claims Chrome has since decoupled this. [Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=2067534)
- `practitioner` Okabe-Ito hex values are #E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7 and #000000. [R docs](https://www.rdocumentation.org/packages/factoextra/versions/2.2.0/topics/factoextra_palette)
- `anecdotal` The 8% of men figure appears only on a [commercial blog](https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference).
- `solid/doc` [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) (standard feature, not re-read this session).

### Inferences
- Decoded stereo at 44.1 kHz in 32-bit float is about 21 MB per minute, or about 85 MB for four minutes (my arithmetic, assuming float32 storage). Keep few decoded buffers.
- Red/green frequency coding is a weak fit for colour-blind users. Blue and orange, plus luminance and labels, is safer.

### Gaps
- Per-tab memory caps and Wake Lock on localhost are unverified.
- Keyboard shortcut conventions were not researched.
- Whether Web Audio counts as "sound" for throttling needs a test on the target browser.

## Design implications for Selecta

All of this is my judgement. Timings are starting values to test. I use "seam" for a transition.

### Screens

**1. Start** (first run only)
- Folder path and a live count ("1,389 files, 47 set aside as probably not music").
- One large **Start the set** button, which doubles as the audio gesture.
- One honest line: "Early sets use simpler blends. Wordplay arrives as songs get analysed."
- Aim for first sound within minutes using a quick pass on a sample, then confirm the target by measurement.

**2. Deck** (home)
- Huge title and artist.
- One whole-song strip: single-hue amplitude, played part dimmed, plain section words, seam marker with countdown.
- Next-song card and a seam glyph (shape plus colour).
- Steering row: Less, More, Skip, Lock.
- Pending chips, a Why chip, and "Set ready for 38 min".

**3. Arc** (set plan)
- 60-90 minute timeline with song blocks, seam glyphs and lock pins.
- Energy curve with presets (Slow burn, Peak time, Wind down).
- Drawing shows a feasibility band and a best-fit line, with the old plan ghosted behind.
- Global controls use named stops: Smooth / Balanced / Flashy, and Wordplay Never / Sometimes / Often. Each states its consequence.

**4. Crate** (library)
- Search-first virtualised table with filter chips: Ready, Unsure, Not yet, Set aside.
- Row actions: Play next, Lock, Never play.
- One-tap BPM ×2 and ÷2, then tap tempo.
- Edits are marked "yours" and survive re-analysis.
- Probable non-music goes to a reversible review queue.

**5. Why drawer**
- One true sentence first, factors on expansion, never raw scores.
- History of past seams, with replay of rendered transitions as a small delight.

**6. Workshop** (analysis status)
- Tier counts instead of one percentage: Playable, Mixable, Wordplay-ready.
- Running tally ("Learned: chorus at 0:48, 3 word links") and last-finished time.
- Reasons for pausing ("playback first", "on battery").
- A range estimate ("a few days if left on"), a failure list, Pause, and Analyse next.
- An overnight digest on return.

**7. Stage** (fullscreen or TV)
- Phone-level density, large lyrics, an energy field, no chrome, and essentials inside a 5% margin.

### Interaction rules
1. Acknowledge every control within 100 ms, and label when it lands ("at next seam, 0:42").
2. Use undo, never confirmation, for steering. Repeated nudges merge into one chip ("+2 energy").
3. Chips move through Planned, Rendering, Locked and Landed. After Locked, undo applies to the following seam, and the chip says so.
4. Skip never waits on a render, because most skips come early. Keep a generic fast exit ready at all times. Pressing Skip again means "now".
5. Locks, Never play and overrides persist until the user changes them.
6. Thumbs rate the seam, appear after it lands, and fade if ignored. Never ask why. The first response states an effect ("fewer cuts like that").
7. The machine speaks only when asked, or when it broke a promise ("Wordplay wasn't rendered in time, used a blend").
8. If the next wordplay won't render in time, degrade quietly and log it in Why.
9. Keyboard: Space pause, N skip, ↑/↓ energy, L lock, Z undo, W wordplay, E why, F stage, / search.

### A wordplay transition, moment by moment

| When | What happens |
|---|---|
| Minutes ahead | The queue shows a wordplay glyph, never the word. |
| About 30 s | Seam countdown appears. "Use a smooth blend" is available until Locked. |
| About 2 bars | Controls and background fall to about 40% opacity, with lyrics unchanged. No label or countdown. |
| 1-2 beats before the word | The word gains weight and accent colour, ahead of the sung syllable, on the audio clock adjusted by `outputLatency`. |
| The cut | The word holds its exact position while the rest of A's line clears. B's line assembles around it: a typographic match cut, with the word as the hinge. |
| +1-3 s | B's title settles below, and the Deck returns. |
| +8-12 s | Quiet thumbs and Why chip, gone by about 20 s. |
| Why opened | "'fire' to 'fire', 3 BPM apart, second wordplay in 40 min (you set Sometimes)." |

**Fallbacks**
- Line-level timing only: no pre-lighting. The word appears on the cut.
- No lyrics: the word appears alone as type on the cut.
- Reduced motion: weight and colour only, no movement or flash.
- Offer a manual sync nudge, since `outputLatency` is only an estimate.

### Deliberately leave out
- Faders, EQ, knobs, jog wheels and hot cues.
- Beat ticks, phase-aligned waveforms and frequency colouring.
- BPM or Camelot codes on the Deck (keep them in Crate and Why).
- Voice host, chat box and AI sparkle iconography.
- "Why did you skip?" prompts and star ratings.
- Confetti, "WORDPLAY!" banners and wordplay countdowns.
- A single overall percentage, fake progress, live FFT, and confirmation dialogs on steering.

### Technical UI constraints
- **Gesture:** every load starts in a real "Resume set" state, because a discarded or reloaded tab needs a new gesture. Never show Pause until `state` is running.
- **State:** the plan, queue and analysis live in the local backend, and the tab only renders them. Analysis must not run in the page, given Energy Saver.
- **Scheduling:** queue rendered audio well ahead on the audio clock. Warn that a paused set in a hidden tab gets throttled, and reconcile the display when the tab becomes visible.
- **Graphics:** Canvas 2D with layered canvases and precomputed peaks. Render lyrics as DOM, not canvas text. Cap ambient visuals at 30 fps, and step down automatically when frame times slip. Offer Butterchurn-style WebGL 2 only in Stage, as opt-in.
- **Audio safety:** use a larger `latencyHint` since nothing is played live, allocate up front, and avoid GC in worklets. Test with analysis running at full load.
- **Media keys:** route through an `<audio>` element if testing shows Web Audio alone won't register. Map next to Skip and previous to Undo.
- **Accessibility:** beat-reactive light stays under three flashes per second and off by default in Stage. Encode meaning with shape, luminance and words, using blue/orange-family colours.
- **Memory:** keep only the current and next rendered segments decoded.
