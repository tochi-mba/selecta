# Selecta

On Windows, Workshop's **Add desktop shortcut** creates a Selecta icon. The launcher reuses the local server when available, otherwise starts it and waits before opening an Edge app window (or your default browser if Edge is unavailable). The shortcut uses this installation's Python environment, so keep the project folder in place. Startup errors appear in a dialog; server output is recorded in `%LOCALAPPDATA%/selecta/desktop-server.log` under the default data location.

An auto DJ for your own music folder. Point it at a folder and it plays a set in your browser, with transitions chosen and rendered like a really good DJ would, including wordplay cuts where a word in one song hands off to the same word in the next.

It runs entirely on your PC. Your music never leaves your machine, and no audio is ever stored in this repo.

**Status: early build.** You can build a mix, edit how every song hands over to the next, hear each seam, play the set and save it as a file. Whether it sounds good is still being judged by ear, reel by reel. See [docs/acceptance.md](docs/acceptance.md) for exactly what works and what doesn't.

## What makes it different

- **It searches everything.** No person can hold every line, melody and groove of a whole library in their head. Selecta can.
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

## What is deliberately local

The server binds to `127.0.0.1`, rejects foreign Host headers and exposes originals only through
validated song IDs. Audio, model weights, stems, caches, databases and rendered mixes are ignored
by Git. LRCLIB receives only track metadata when you explicitly run the lyrics command.

## Licence

GPL-3.0-or-later, because the audio engine depends on [pedalboard](https://github.com/spotify/pedalboard) and Rubber Band. Some optional model weights have their own non-commercial terms. They download to your machine and aren't part of this repo, so check them before distributing anything built on Selecta.
