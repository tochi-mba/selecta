# Words we use

SelectaDJ runs in three places. The code grew three sets of names for them, and some words mean
two things. From 2026-11-25 (ADR-0477) new docs and all member copy use the words below. Code
identifiers keep their old names until the mechanical rename at the end of that programme; the
last column says what you will meet in the code until then.

## The three places

| Say | Means | In the code today |
|---|---|---|
| **Desktop** | SelectaDJ running on the person's own computer: a local server and its site, no account, music never leaves the machine | `SELECTA_MODE=local`, "local mode", `ShellMode 'local'`, `web/src/App.tsx`, "this PC" |
| **Cloud** | The signed-in SelectaDJ at `app.selectadj.app`. One app, whatever a song's home is | `SELECTA_MODE=cloud`, `web/src/cloud/` |
| **Kiosk** | A venue player for SelectaDJ for Business | `web/src/kiosk/`, `business/` |

## Where a song lives (Cloud)

Members never see a "mode". They see where each song lives. One account can hold both.

| Say | Means | In the code today |
|---|---|---|
| **On this device** | The file stays on the member's device; Cloud knows the song but holds no audio | "local-first", "browser-first", "BF", `experience.local_first`, `cloud.local_first`, `cloud.local_media`, `local_songs` |
| **In your cloud library** | The file was uploaded and is stored with SelectaDJ | "hosted", `experience.hosted`, `cloud.hosted_media`, `cloud.stored_media`, `assets` |

## Where the audio work happens

A **studio** does the audio work: measuring songs, splitting stems, rendering and checking
transitions.

| Say | Means | In the code today |
|---|---|---|
| **Desktop engine** | The full Python engine on the person's computer | `src/selecta/analysis`, `render`, `seams.py`, `stems.py` |
| **Cloud studio** | SelectaDJ's workers running that same engine on uploaded songs | `workers/engine_handlers.py`, `workers/engine_seams.py`, `hosted_render.py` |
| **Device studio** | The member's own browser doing the audio work on songs that stay on the device | `web/src/engine/`, `web/src/dsp/` |

## Planning words

| Say | Means |
|---|---|
| **Song facts** | Measurements of a song: tempo, beat and bar positions, sections, key, loudness, per-bar energy and tone numbers, when singing happens. Never audio |
| **Planner** | The Python code that chooses the song order, where to leave and enter, the move and its length. It runs on Desktop or on the Cloud server, never in a browser |
| **Script** | A transition described as data (`render/script.py` `TransitionScript`), which any studio can render |
| **Seam** | The stretch where one song hands over to the next. Members read "transition" |
| **Move** | A kind of transition: blend, vocal ride, cut, echo out and so on (`seam_kinds.MOVES`) |
| **Audit** | The measurements a rendered seam must pass before anyone hears it (`audit/checks.py`) |

## Words to stop using in member copy and new docs

- **local-first, browser-first, BF**: say "on this device" for where a song lives, or "device
  studio" for where the work happens.
- **hosted**: say "in your cloud library", or "cloud studio".
- **local** on its own: say "Desktop", or "on this device". The word meant both.
- **mode** for the two Cloud cases: there is one Cloud.

## Words that keep two meanings, so say which

- **Workspace**: the account's workspace (tenancy), and the Workspace page in the shell.
- **Library**: the person's songs as a list, wherever they live.
