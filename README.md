# SelectaDJ

SelectaDJ is a REX Technologies product.

SelectaDJ supports the browser's **Install app** action in Chrome and Edge through its web app manifest. Open `http://127.0.0.1:8733/` in your browser and use the install icon in the address bar, or the browser menu's install-app action. Installation creates a standalone browser app; the local SelectaDJ server must be running to access the music library and render mixes.


An auto DJ for your own music folder. Point it at a folder and it plays a set in your browser, with transitions chosen and rendered like a really good DJ would, including wordplay cuts where a word in one song hands off to the same word in the next.

It runs entirely on your PC. Your music never leaves your machine, and no audio is ever stored in this repo.

This README describes **local mode**. The optional SelectaDJ Cloud edition has a separate
[mode-by-mode guarantee table](docs/saas/README.md#guarantees-by-runtime-mode); adding Cloud does
not weaken local mode's privacy, storage, network, or user-control guarantees.

**Status: early build.** You can build a mix, edit how every song hands over to the next, hear each seam, play the set and save it as a file. Whether it sounds good is still being judged by ear, reel by reel. See [docs/acceptance.md](docs/acceptance.md) for exactly what works and what doesn't.

## What makes it different

- **It searches across your library.** Lyric links and ordered harmonic candidates can reveal connections to audition. Verified melody, sample and rhythm discovery remain unfinished.
- **It gets more than one take.** A live DJ gets one shot. SelectaDJ renders a transition, measures the result, and repairs what failed before you ever hear it.
- **It explains itself, but only when asked.** The plan stays visible and the machine stays quiet.

## Quick start (local development)

You only need **one command** to start the Python API and hot-reloading website. From the repo root,
install [uv](https://docs.astral.sh/uv/), [Node.js 22.12+](https://nodejs.org/),
[pnpm](https://pnpm.io/), and [ffmpeg](https://ffmpeg.org/download.html) (needed to analyse
or play music). The launcher installs the project's Python and web dependencies and reports
what it is doing:

```text
Windows Command Prompt: dev.cmd
Windows PowerShell:      .\dev.cmd
macOS/Linux:             uv run python -x dev.cmd
```

The launcher opens the site when ready, prints its local URL, and streams server and website logs
as you develop. It checks the API's health, the local SQLite schema, Vite, and the Vite-to-API
proxy before announcing that the **development stack is online**. The full `/api/status` endpoint
loads and summarises your music library and can take longer. Its first result is checked separately:
if it's slow, the launcher warns you but still opens the website so you can debug it. The
`--check` smoke test fails if this full summary does not answer.

If you see `[WARNING] Library summary is slow or unavailable`, use the named `[STATUS]`
steps in the API console to locate the blocker. After 10 seconds a watchdog prints the blocked
stage; after 30 seconds it prints the Python stack. The `--isolated` option starts with a
separate empty library and is useful for distinguishing slow existing data from an app defect.
Frequent health probe access lines are hidden by default; `--verbose` restores them.
Use `dev.cmd --check` for a startup smoke test, or `dev.cmd doctor` for prerequisites and
troubleshooting. See [Working on Selecta](#working-on-selecta) below for all options.

To run a production-style local build without hot reloading, use the underlying commands:

```bash
uv sync
cd web
pnpm install --frozen-lockfile
pnpm build
cd ..
uv run selecta web
```

The first screen asks where your music is, then reads it and analyses it in the background. Pick a
mix on the Explore page and press play. Its seams start rendering by themselves, ahead of everything
else, and you can change how any song hands over to the next on the Edit page.

Drafts let you build another mix without touching what's playing. **Prioritize** one and it renders
in the background once the current mix is done. On any seam, **Shape it yourself with stems** puts
both songs' voice, drums, bass and melody on a grid you can hear instantly, and SelectaDJ can arrange
it or fine tune yours. Rate what you make, and it learns from that.

Requests let you ask for a song while a mix plays. SelectaDJ finds a spot where it fits without
forcing a bad transition, and shows it faded in Edit until its transitions are ready. Requests are
planned together, so no song is used twice and each spot goes to one request at a time. If a song
doesn't fit anywhere, **Find a bridge** goes through your whole library for the best way to reach
it, and you choose. A bridge joins all at once, when every transition in it is ready, and nothing
in it can play before that.

Songs you add to your music folder come in by themselves within about a minute, once they've
finished copying, and go on to be analysed. With nothing else to do, SelectaDJ tries out the best
transitions across your library at the lowest priority, giving way to anything else straight away,
and stops at 80% of its storage limit.

## Cloud development on your PC

The explicit `dev.cmd cloud` command starts the real Cloud API, its migrations and
background worker, together with a **local-only** identity provider (WorkOS-compatible),
disk-backed object storage, pretend Stripe billing and a hot-reloading Cloud site. No
paid account or hosted service is required. It uses a separate
`.cache/selecta-cloud/` data folder, never your existing local music library.

```cmd
dev.cmd cloud --seed
```

On the first run, `--seed` creates a Premium demo workspace with eight synthetic audio
files and the login **dev@selectadj.test / selectadj-dev**. Subsequent launches can
omit `--seed`; its data and sign-in sessions persist. Open the website URL the launcher
prints (normally http://127.0.0.1:5173), sign in, or create a different account.
Verification/reset emails appear in the local inbox at `/dev/mail` on that site.
The site and identity pages run on loopback only; pretend Stripe never charges a card.

Use `dev.cmd cloud --check` to start all services, validate identity, API readiness,
workers and Vite proxies, then stop them cleanly. `--no-browser`, `--verbose`,
`--startup-timeout 300`, `--api-port`, `--site-port`, `--identity-port`,
`--data-dir` and `--isolated` are supported. `--isolated` uses a separate
`.cache/selecta-cloud-isolated/` folder. Cloud mode requires uv, Node.js 22.12+,
pnpm and FFmpeg on your PATH. Use Ctrl+C to stop launcher-owned services. No
production WorkOS key or live Stripe key is allowed; the launcher refuses them.

This is **Cloud application development**, not hosted deployment. It does not start
managed R2, production WorkOS/Stripe or a remote worker gateway. To test PostgreSQL
instead of SQLite, set `SELECTA_DEV_DATABASE_URL` to a development database
connection URL before launching. Normal `dev.cmd` continues running local mode.
## Working on Selecta

**One command starts local development:** the Python API (auto-reloads when code changes) and the
Vite site (hot-reloads as you edit), with its API proxy. Use `dev.cmd` from Windows Command Prompt,
`.\\dev.cmd` in PowerShell, or `uv run python -x dev.cmd` on macOS/Linux. You can also
double-click `dev.cmd` on Windows. It uses the project root regardless of your current directory.

```bash
dev.cmd
```

You need [uv](https://docs.astral.sh/uv/), [Node.js 22+](https://nodejs.org/), and
[pnpm](https://pnpm.io/) on your PATH. The launcher checks Node is at least 22.12 and prepares Python dependencies through
`uv run` and performs an incremental, lockfile-checked `pnpm install` itself.
Install [ffmpeg](https://ffmpeg.org/download.html) for music analysis and playback; missing ffmpeg
is reported prominently rather than hidden. No production Cloud credentials or hosted services are
needed for **local mode**. Set `SELECTA_HOME` to use a separate development library, otherwise
the usual user data folder is used.

You can see progress while it starts. Every stage is labelled, API and site output are prefixed,
and until ready the launcher reports which of the API, website, and Vite API proxy is still
pending. When healthy, it prints working URLs (normally `http://127.0.0.1:5173/` for the site,
`http://127.0.0.1:8733/` for the API) and opens the browser. It periodically reports that
the processes are alive. Press Ctrl+C or close the window to stop **only processes it started**.

```text
18:44:00 [SETUP  ] Step 1/4 - Checking the local environment
18:44:00 [SETUP  ] Step 2/4 - Preparing browser dependencies
18:44:02 [SETUP  ] Step 3/4 - Starting hot-reloading API and website
18:44:02 [START  ] API: ...
18:44:02 [START  ] SITE: ...
18:44:02 [SETUP  ] Step 4/4 - Waiting for API, site and API proxy
18:44:03 [WAIT   ] 0s elapsed; waiting for api, proxy. Logs appear above as they arrive.
18:44:05 [OK     ] API: responding
18:44:05 [OK     ] PROXY: responding
18:44:05 [READY  ] Website (hot reload): http://127.0.0.1:5173/
```

Example only; your times, paths, and ports will differ. Occupied ports are reported and the
next free port is selected, rather than silently using a different checkout's server.
Use `--reuse-server` only when you deliberately want to connect to an existing Selecta API.
The existing server is never stopped when this launcher exits.

| Command | What it does |
|---|---|
| `dev.cmd` | Start the full **local** API + Vite dev stack and open the browser |
| `dev.cmd --no-browser` | Start the stack without opening a browser |
| `dev.cmd --check` | Start both services, verify API/site/proxy, then cleanly stop |
| `dev.cmd doctor` | Show Python, uv, Node, pnpm, ffmpeg, local mode and data configuration |
| `dev.cmd --api-port 8740 --site-port 5180` | Request different starting ports |
| `dev.cmd --reuse-server` | Explicitly reuse an existing API on port 8733 |
| `dev.cmd --isolated` | Use a separate development-only library without touching your existing library or migrating legacy data |
| `dev.cmd --verbose` | Show detailed Uvicorn logs |
| `dev.cmd --startup-timeout 300` | Allow more time for first startup or slow data migration |
| `dev.cmd test` | Run local lint, Python, TypeScript, web unit/build and Edge browser checks |

For non-Windows systems, replace the `dev.cmd` prefix with `uv run python -x dev.cmd`.
The `--check` option is useful after setup, and `doctor` is useful when the prerequisite
check reports something missing. For a fast macOS/Linux doctor that skips project dependency
installation, use `uv run --no-sync python -x dev.cmd doctor`; the Windows command does that
automatically. Setting `SELECTA_MODE=cloud` before a normal `dev.cmd` launch is rejected; use
`dev.cmd cloud` for the explicit, isolated development stack. A hosted deployment
still needs separate gateway, identity, storage and database configuration.

**CI runs more than `dev.cmd test`.** In particular, GitHub Actions also runs PostgreSQL
isolation tests, the feature-flag sweep, Cloud browser tests, coverage aggregation, and CodeQL.
A passing local test command does *not* guarantee every CI check has passed. See
[the testing guide](docs/engineering/testing.md) to run those jobs separately.

```bash
dev.cmd test
# Or individual checks:
uv run pytest
cd web
pnpm test
pnpm build
pnpm e2e
pnpm e2e:flags
pnpm e2e:cloud
```

`pnpm e2e` runs browser tests in Edge against a real local test server with a synthetic library
(`tests/e2e_server.py`), so no personal audio is involved. Run `pnpm build` first; tests exercise
the built site.

No file in the project goes over 1,000 lines. `tests/test_file_length.py` enforces it, and CI runs it
as its own step. When a file gets close, split it by what the pieces do.

Use `selecta beat-check` to verify beats, downbeats and keys by ear before analysing the whole
library. Use `selecta discover` after lyrics are ready to fill the Found screen's Seam Book.

For a resumable harmonic search across every analysed pair, run
`selecta discover --exhaustive --pair-limit 1000`. Run it again to continue until the remaining
count reaches zero. Unchanged comparisons, including non-matches, are reused. New or changed
analysis adds work. Discovery gives way to current mix rendering; it does not approve matches
for automatic use.

## Feature flags

Every feature has a flag, listed in [docs/flags.md](docs/flags.md) and defined in
`src/selecta/flags/*.json`, which the server, the site, the CLI and the tests all read. Flags are
for developers: set `SELECTA_FLAGS` before starting Selecta, and restart to change it.

```bash
SELECTA_FLAGS="-requests -move.*" uv run selecta web
```

`-name` turns a flag off, `+name` turns one on, `area.*` reaches every flag in an area, `minimal`
turns off everything that isn't core and `all` turns everything on. A flag that needs one that's off
is off too, and core flags can't be turned off. `uv run selecta flags` shows what's on and why.

A feature that's off is gone, as if it had never been built: its routes answer 403 `flag_off`, its
background work stops, its CLI commands say so, and the site shows no link, tab, button, shortcut,
command or word about it. Turning a flag off never deletes anything. What someone already chose
with it (never-play songs, priorities, corrections, ratings, shaping) is kept and still counts; only
a transition move that's off can't be used, so a seam set to it is planned again.

When adding a feature, give it a flag in the registry with its routes, CLI commands, the pages it
shows on and the words that name it, then gate it in the site with `useFlag`, `<Flag>` or a
`flag` field on the shell's lists. `uv run selecta flags --markdown docs/flags.md` updates the
catalog. `pnpm e2e:flags` checks every page with each feature off.

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

Open Workspace's Learning section (`/listening`) and enter the study code, a listener nickname and listening
setup. Method names stay hidden there. `selecta listening-report heldout-v1` reports missing
responses, missing quality grades, and bad-transition rates (grades 1–2). Optional private `method`
labels group results across pairs, with renderer versions kept separate. Old unlabelled clips stay
unlabelled; their methods are not guessed. These are descriptive counts, not evidence of statistical
superiority or independent listeners. The full evaluation still requires the planned stratified
pairs and human ratings.

## What is deliberately local

The server binds to `127.0.0.1`, rejects foreign Host headers and exposes originals only through
validated song IDs. Audio, model weights, stems, caches, databases and rendered mixes are ignored
by Git. LRCLIB receives artist, title, album and duration during lyric lookup. Adding a music folder starts lookup automatically, and so do new songs that turn up in a folder already added; the lyrics command can also start it. Turning off the `lyrics.lookup` flag stops all of these. Audio files are never sent to LRCLIB.

## Licence

GPL-3.0-or-later, because the audio engine depends on [pedalboard](https://github.com/spotify/pedalboard) and Rubber Band. Some optional model weights have their own non-commercial terms. They download to your machine and aren't part of this repo, so check them before distributing anything built on Selecta.
