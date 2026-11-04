# Selecta

An auto DJ for your own music folder. Point it at a folder and it plays a set in your browser, with transitions chosen and rendered like a really good DJ would, including wordplay cuts where a word in one song hands off to the same word in the next.

It runs entirely on your PC. Your music never leaves your machine, and no audio is ever stored in this repo.

**Status: early build.** See [docs/research.md](docs/research.md) for the thinking behind it.

## What makes it different

- **It searches everything.** No person can hold every line, melody and groove of a whole library in their head. Selecta can.
- **It gets more than one take.** A live DJ gets one shot. Selecta renders a transition, measures the result, and repairs what failed before you ever hear it.
- **It explains itself, but only when asked.** The plan stays visible and the machine stays quiet.

## Setup

You'll need [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) and [ffmpeg](https://ffmpeg.org/) on your PATH.

```bash
uv sync
uv run selecta scan "C:\path\to\your\music"
```

## Licence

GPL-3.0-or-later, because the audio engine depends on [pedalboard](https://github.com/spotify/pedalboard) and Rubber Band. Some optional model weights have their own non-commercial terms. They download to your machine and aren't part of this repo, so check them before distributing anything built on Selecta.
