# Selecta

Selecta supports the browser's **Install app** action in Chrome and Edge through its web app manifest. Open `http://127.0.0.1:8733/` in your browser and use the install icon in the address bar, or the browser menu's install-app action. Installation creates a standalone browser app; the local Selecta server must be running to access the music library and render mixes.


An auto DJ for your own music folder. Point it at a folder and it plays a set in your browser, with transitions chosen and rendered like a really good DJ would, including wordplay cuts where a word in one song hands off to the same word in the next.

It runs entirely on your PC. Your music never leaves your machine, and no audio is ever stored in this repo.

**Status: early build.** You can build a mix, edit how every song hands over to the next, hear each seam, play the set and save it as a file. Whether it sounds good is still being judged by ear, reel by reel. See [docs/acceptance.md](docs/acceptance.md) for exactly what works and what doesn't.

## What makes it different

- **It searches across your library.** Lyric links and ordered harmonic candidates can reveal connections to audition. Verified melody, sample and rhythm discovery remain unfinished.
- **It gets more than one take.** A live DJ gets one shot. Selecta renders a transition, measures the result, and repairs what failed before you ever hear it.
- **It explains itself, but only when asked.** The plan stays visible and the machine stays quiet.

## Setup

You'll need [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) and [ffmpeg](https://ffmpeg.org/) on your PATH.

```bash
uv sync
cd web
pnpm install
pnpm build
cd ..
uv run selecta web
```

The first screen asks where your music is, then reads it and analyses it in the background. Pick a
mix on the Mixes page and press play. Its seams start rendering by themselves, ahead of everything
else, and you can change how any song hands over to the next on the Edit page.

To run the tests:

```bash
uv run pytest
cd web
pnpm test
```

Use `selecta beat-check` to verify beats, downbeats and keys by ear before analysing the whole
library. Use `selecta discover` after lyrics are ready to fill the Found screen's Seam Book.

For a resumable harmonic search across every analysed pair, run
`selecta discover --exhaustive --pair-limit 1000`. Run it again to continue until the remaining
count reaches zero. Unchanged comparisons, including non-matches, are reused. New or changed
analysis adds work. Discovery gives way to current mix rendering; it does not approve matches
for automatic use.

## Blind listening comparisons

Prepare two stereo renders of the same source cues and context. Import them with
`selecta listening-import comparison.json`, using a manifest like this:

```json
{
  "study": "heldout-v1",
  "pair": "song-1-to-song-2",
  "seed": 42,
  "conditions": [
    {
      "path": "C:/audio/adaptive.wav",
      "method": "adaptive",
      "renderer": "commit-or-version",
      "context": {"a": 1, "b": 2, "a_at": 30, "b_at": 16}
    },
    {
      "path": "C:/audio/crossfade.wav",
      "method": "fixed_crossfade",
      "renderer": "baseline-v1",
      "context": {"a": 1, "b": 2, "a_at": 30, "b_at": 16}
    }
  ]
}
```

The importer checks matching duration, channel layout and sample rate, rejects invalid audio,
and matches loudness at a shared peak-safe target. It retains originals and stores study copies
outside the disposable seam cache. Identical context declarations are required, but their musical
truth still needs checking by the person preparing the clips.

Open Workshop's blind comparison panel and enter the study code, a listener nickname and listening
setup. Method names stay hidden there. `selecta listening-report heldout-v1` reports missing
responses, missing quality grades, and bad-transition rates (grades 1–2). Optional private `method`
labels group results across pairs, with renderer versions kept separate. Old unlabelled clips stay
unlabelled; their methods are not guessed. These are descriptive counts, not evidence of statistical
superiority or independent listeners. The full evaluation still requires the planned stratified
pairs and human ratings.

## What is deliberately local

The server binds to `127.0.0.1`, rejects foreign Host headers and exposes originals only through
validated song IDs. Audio, model weights, stems, caches, databases and rendered mixes are ignored
by Git. LRCLIB receives only track metadata when you explicitly run the lyrics command.

## Licence

GPL-3.0-or-later, because the audio engine depends on [pedalboard](https://github.com/spotify/pedalboard) and Rubber Band. Some optional model weights have their own non-commercial terms. They download to your machine and aren't part of this repo, so check them before distributing anything built on Selecta.
