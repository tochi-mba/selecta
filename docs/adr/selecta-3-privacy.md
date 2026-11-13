# Selecta 3.0: privacy, file access and the installed app

Covers S3-0072-01, S3-0072-02, S3-0072-03, S3-0072-05, S3-0072-06, S3-0072-07, S3-0053-02 and S3-0071-04's folder half. This was written from reading the code. Installed-app behaviour in S3-0072-04 still needs a person.

## What leaves this PC

| What | Sent to | When | Exactly what |
|---|---|---|---|
| Lyric lookup | `lrclib.net` | After a folder is added, when new songs arrive, and on `selecta lyrics` | Artist, title, album and duration. Never audio, never a path |
| Key model | `raw.githubusercontent.com` (S-KEY, pinned commit, checked against a pinned hash) | Once, on first analysis | A plain download. Nothing about your library is sent |
| Stem model | The Demucs model's own host, through `demucs` | Once, on first separation | A plain download. Nothing about your library is sent |
| Lucy, with a remote provider (added later by the Lucy programme) | `api.anthropic.com` or `api.openai.com`, or a URL you set | Only after you choose a remote provider and give consent; the built-in provider sends nothing | The conversation and the song details Lucy needs. The key stays on the server (`src/selecta/lucy/settings.py`, ADR-0330) |

Cloud-only transactional email can use `api.postmarkapp.com` or `api.resend.com`. These are configured by the cloud service and are never contacted by the local music server.

Rechecked on 2026-11-11 against every remote address in `src/selecta` (`tests/test_s3_docs_contracts.py`); Cloud hosts belong to Cloud mode and its own docs. Nothing else goes anywhere: no analytics, telemetry, remote fonts, icons or scripts. Copy on the first screen and in Sources says the lyric lookup part out loud, and the wording matches the table above. An automated browser test records every request during navigation and fails on any that isn't to the local server.

"Your audio stays on this PC" is the claim the app makes, and it's accurate. It deliberately doesn't claim "nothing leaves this PC", which wouldn't be.

## Who can reach the server

| Check | Where | Effect |
|---|---|---|
| Listens on `127.0.0.1` only | `cli.py` | Nothing off this machine can connect |
| `Host` must be local | `local_only` in `api.py` | A DNS rebinding page gets 403 |
| `Origin` must be local on anything that changes state | `local_only` in `api.py` | Another website can't make your browser change things |
| Audio by song id, not by path | `/api/songs/{id}/audio` | A request can't name a file. The id is looked up in the library |
| Export name is reduced with `Path(name).name` | `/api/exports/{name}` | `..` can't leave the exports folder |
| Seam key is reduced with `Path(key).name` | `/api/seams/{key}/*` | Same |
| Stale writes refused | `x-mix-order` middleware | A page that's out of date can't change the wrong song |
| Repeated operations answered once | `x-operation-id` middleware | A retry can't do it twice |

The Selecta 3 additions keep to this. `GET /api/folders/check` is read-only, answers only about the folder it was asked about, and returns no listing. Job records name a file, never a path. Nothing was loosened.

## Paths the page can see

The page sees your watched folders' paths, because they're yours and you typed them. It never gets a song's path: readiness reports "The file isn't where it was", not where it was. Diagnostics has no paths and no song names, by construction.

## Choosing a folder: why there's no folder picker

`window.showDirectoryPicker()` gives the page a sandboxed handle, not a path. The local Python server reads files by path, and a browser won't reveal one. Reading the files through the handle and uploading them would be a different product, with the audio going through the browser.

A native dialog opened by the server would work but needs its own review: it opens on the server's desktop, can appear behind the browser, and adds a route that makes the machine do something visible on request.

**Decision:** paste a path, validated by the server. `GET /api/folders/check` says plainly whether it's missing, not a folder, not readable, already added, inside something already added, or has no audio, before anything is read. A disconnected drive reads as missing, and its songs are kept. Symlinks are resolved before comparing, so a link can't add the same folder twice. If a native picker is wanted later, it should be its own reviewed change.

## New dependencies

None were added for this work: no runtime dependency, no UI library, no font and no CDN. `package.json` runtime dependencies are unchanged. New features use the platform: `<dialog>`-style overlays built on existing code, `inert`, `visualViewport` and `BroadcastChannel`.

Audit on 2026-11-10: two runtime dependencies have been added since, both by the Cloud programme. `@noble/hashes` 2.4.0 (MIT) hashes upload parts in the browser and makes no request. `@workos-inc/authkit-react` 0.16.3 (MIT) signs a Cloud listener in through WorkOS, which is a remote host, and is covered by [Cloud authentication](../saas/07a-authentication.md). Both are imported only under `web/src/cloud/`, which `RuntimeApp.tsx` loads lazily in Cloud mode, so the built local page never loads them: in a local build they sit only in the `CloudRoot` chunk. `web/e2e/s3-0072-local-requests.e2e.ts` and `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer' fail on any request from the local app that isn't to the local server.

There's no Content Security Policy header today. Nothing here needs external sources, so one could be added later without changing the app, as its own reviewed change.

## Diagnostics and shared material

- The diagnostics panel shows human-readable reasons first and raw values second. Copy is an explicit button and goes only to your clipboard.
- Fixtures in the repo use made-up songs from `tests/e2e_server.py`. Screenshots used as evidence come from that library, never a real one.
- A blind study's screenshots must not show its code alongside its method, and the page itself never reveals the method.

## What "offline" means

Selecta's server runs on this PC, so "offline" here means the page can't reach it. It is not offline music playback.

| Situation | What it says |
|---|---|
| Server stopped, first load, already set up | Can't reach Selecta. Your library, mixes and ratings are safe. Start it again and this page picks up |
| Server stopped, first load, never set up | Can't reach Selecta, with no claim about a library |
| Server stops mid-session | A banner: what's on screen may be out of date, and anything already loaded keeps playing |
| A watched folder's drive is gone | That folder says it can't be found right now, and its songs are kept |
| A song's file has moved | That song says its file is missing |
| Installed app opened with no server | The same "Can't reach Selecta" page, because there's no service worker pretending otherwise |

There is no service worker, and adding one was rejected: it would imply offline ability that doesn't exist, and could serve an old page after an update.

## Installed app

The manifest stays as it was (`display: standalone`, start URL `/`), and any address reloads correctly because the server's page list knows every address. `theme-color` now has a dark and a light value so the title bar matches. A real install on Chrome and Edge, including closing and reopening with and without the server, still needs a person to try it.
