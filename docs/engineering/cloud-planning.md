# Planning in Cloud from song facts

ADR-0479 phase 4, second part. A member's device measures its songs and saves the **facts**
(measurements, never audio) to the account; Cloud runs the same planner core Desktop runs
(`docs/engineering/planner-core.md`) over those facts and answers with decisions as data. A
studio (the member's browser, later a cloud worker) renders the scripts, audits them and
follows the repair rule. Code: `src/selecta/cloud_brain/`, `src/selecta/engine_store/facts.py`
and `facts_store.py`. Flag: `cloud.brain` (needs `cloud.local_media`).

## Routes

Every route is signed in, works in the caller's workspace (`X-Workspace-ID` as elsewhere) through
the engine store, and answers `403 flag_off` while `cloud.brain` is off. They don't read
`core.engine_store`: that flag guards how Desktop opens its library file.

| Route | Needs | Does |
|---|---|---|
| `PUT /api/song-facts/{song_id}` | `library.write` | Save a device's facts for one catalogue song |
| `GET /api/song-facts?after=&limit=` | `library.read` | Which songs have facts, by id, with implementation and source; `next` pages on |
| `PUT /api/song-facts/{song_id}/correction` | `library.write` | `{bpm, camelot}`, each or both null; both null clears |
| `DELETE /api/song-facts/{song_id}/correction` | `library.write` | Clear the correction |
| `POST /api/planning/candidates` | `library.read` | Ranked transitions from A into B, with scripts |
| `POST /api/planning/candidates/script` | `library.read` | One more option's script, by index |
| `POST /api/planning/next-step` | `library.read` | `repair.next_step`; reads nothing stored |
| `POST /api/planning/take-step` | `library.read` | `repair.take_step`; reads nothing stored |
| `POST /api/planning/order` | `library.read` | A mix's order and the move into each song |
| `POST /api/planning/ideas` | `library.read` | The idea cards the songs support |

## Facts in

`PUT /api/song-facts/{song_id}`, `Content-Type: application/json` (anything else is 415):

```json
{"content_sha256": "64 hex", "audio_id": "a1:64 hex", "implementation": "web-dsp-1+web-beatthis-small0-1",
 "bpm": 122.0, "constant_tempo": true, "grid_confidence": 0.91, "beats_per_bar": 4,
 "key": "A minor", "camelot": "8A", "key_confidence": 0.7, "key_agrees_chroma": true,
 "lufs": -9.1, "peak_db": -0.3, "energy": 0.62,
 "sections": [{"start_bar": 0, "end_bar": 16, "label": "intro", "energy": 0.4,
               "group": 0, "chorus_prob": 0.0}],
 "arrays": {"beats": {"dtype": "<f8", "shape": [480], "data": "base64..."}, "...": {}}}
```

- `content_sha256` or `audio_id` (at least one) must be this song's: its catalogue hash, a hash it
  is also known by (`local_song_hashes`), or its audio id. Otherwise 409 `song_mismatch`.
- `implementation` must be on the server's device allowlist,
  `engine_store.facts.DEVICE_IMPLEMENTATIONS`: `web-dsp-1` (clients that sent no beat source),
  `web-dsp-1+web-onset-comb-beats-1` and `web-dsp-1+web-beatthis-small0-1` (the port with its beat
  source, docs/engineering/device-beats.md); add a new one there and to `RANK`.
- Answer: `{song_id, implementation, source: "device", measured_at, replaced}`. The time is the
  server's, never the device's.

**Arrays.** Base64 of little-endian values, in exactly one type each, with a declared shape whose
byte length must match. The seven the planner reads (`analysis.song.SONG_ARRAYS`), and
optionally the drum pattern pair `pattern_bars` (`<f4`, bars by 32, 0 to 1) and `swing_bars`
(`<f4`, bars, 0.4 to 0.7), both or neither (docs/engineering/device-analysis.md); any other
name is 422 `unknown_array`. Each is a measurement, not sound:

| Name | Type, shape | What it is |
|---|---|---|
| `beats` | `<f8`, (beats) | Beat times in seconds, rising, at least 0.1 s apart |
| `bar_starts` | `<i4`, (bars) | Which beat starts each bar, rising |
| `energy_bars` | `<f4`, (bars) | Each bar's energy, 0 to 1 |
| `low_share_bars` | `<f4`, (bars) | Each bar's share of energy below 200 Hz, 0 to 1 |
| `rms_db_bars` | `<f4`, (bars) | Each bar's level in dB |
| `chroma_bars` | `<f4`, (bars, 12) | Each bar's 12 pitch-class weights, 0 to 1 |
| `mfcc_bars` | `<f4`, (bars, 13 to 20) | Each bar's averaged tone numbers |

A bar is about two seconds; a per-bar average of a spectrum cannot be turned back into the audio
it came from, and nothing finer than a beat is accepted. The waveform peaks, raw beats and raw
downbeats Python also keeps are never accepted.

**Limits** (`engine_store.facts`, from what the Python analysis can produce; refused, never
clamped, 422 with `code` and `field`): every number finite; tempo 30 to 300; confidences and
energy 0 to 1; 2 to 12 beats a bar; LUFS -70 to 10; peak -120 to 24 dB; bar level -120 to 120 dB;
tone numbers within 2000; key like `A minor` and the Camelot code naming the same key; 1 to 512
sections in order inside the song, labelled intro, verse, chorus, break or outro. The song's
catalogue duration (2 hours at most) must be known (409 `duration_unknown`); beats number 16 to
duration / 0.1 + 1 and sit inside it; every bar array has one entry per bar. The body is refused
with 413 past 4 MB before more is read (the API's own 8 MB limit is behind it). Any key containing
path, folder, file, handle, url or dir, at any depth, is 422 `paths_never_reach_cloud`. A workspace
holds facts for at most 20,000 songs (the catalogue's device report limit): 409 `too_many`.

Storage: the `analysis` row, and the arrays as an `.npz` under
`engine_store.songs.features_key(workspace, catalogue hash, version)` in the private derived
bucket, so `engine_store.songs.load_song` reads exactly what was saved. A device implementation's
`version` is its own (1001 for `web-dsp-1`, 1002 with the interim beat source, 1003 with Beat
This), so it never shares a key with the Python analysis.
Facts stay in the account's workspace, never in `shared_derivations`.

## Which measurement wins

Each row records `implementation` and `source` (`es0479prov01`; `lib0005provenance` on Desktop,
where null means the app's own Python analysis at the row's version). One function,
`engine_store.facts.wins(new, old)`:

1. A `worker` measurement beats a `device` one.
2. From the same source, the higher-ranked implementation wins (`RANK`, lowest first:
   `web-dsp-1`, `web-dsp-1+web-onset-comb-beats-1`, `web-dsp-1+web-beatthis-small0-1`, then
   `python-beatthis-3`; anything unlisted ranks lowest). So a song the browser measures again with
   Beat This replaces its interim measurement, and never a worker's or the Python analysis's.
3. At equal rank, the newer wins.

A losing write is 409 `outranked` and changes nothing. Whether the fit gates (`planner_core.fit`)
hold on device facts is its own to-do item.

## Planning out

**Candidates.** `{a, b, move?, leave_after?, scripts?}`: the Desktop seam request's constraints (a
move asked for by name, from `planner_core.recipes.all_recipes`; how long A must play). The pool is
exactly the Desktop choose loop's: `enumerate_candidates(a, b, move, exits=exits_after(a,
leave_after))`, ranked, at most 300. With `language` (the member's transition feel: `balanced`,
`seamless`, `punchy`, `wordplay`) and no move named, only that feel's family is kept
(`styles_for_language`), and a pair with none of it keeps every move: the Desktop mix build's own
rule (`planner_core.beam._best_move`). The browser sends the feel a pair's mix was ordered with
(web/src/cloud/mixFeel.ts), the same for its script requests. Answer:

```json
{"schema": 1, "max_repairs": 4, "fingerprint": "64 hex", "scripted": 8,
 "options": [{"index": 0, "option": {"move": "...", "bars": 16, "exit_cue": [], "entry_cue": []},
              "score": 0.81, "reasons": ["..."], "script": {}, "has_script": true}],
 "fallback": {"index": -1, "option": {}, "script": {}, "has_script": true}}
```

`script` is `render.script_json.to_dict` of the recipe's script; null with `has_script: false`
when the recipe builds none there (the rule steps over it without counting a render). Only the
first `scripts` options (default 8, at most 16) carry one: the rule renders at most
`MAX_REPAIRS` + 1 = 5 takes, so 8 covers a loop that walks in rank order with room for recipes
that build nothing. The rule can jump down the list (another move after a failure), so a studio
asks `POST /api/planning/candidates/script` with `{a, b, move, leave_after, language, option, fingerprint}`;
a changed list (the songs' facts changed) is 409 `plan_changed`.

**Next step.** `{options: [Option JSON], attempts: [{option, audit: AuditFacts JSON | null}],
max_repairs?}` returns `RepairStep.to_json()`; `take-step` takes `{first, second?}`. Pure: these
let a studio with no port of the rule follow it, and are the reference for the shared fixtures.

**Order.** `{songs: [ids], idea?, count?, start?, end?, language?, stems?, energy_arc?, seed?}`
mirrors the Desktop "make a mix" build (`routes/mixes.play_vibe`): the idea (default `pick`),
how many songs, the first song, the destination, the transition feel, the stems preference and
the energy shape (0 to 100). Songs the member keeps out of mixes are left out as on Desktop.
Answer: `{idea, name, order: [ids], steps: [{from, to, move, transition, reason}], not_measured,
never_play}`. Too few measured songs that suit the idea is 409 `too_few_measured`, naming them.
`ideas` takes `{songs, language?}` and answers `{ideas: [cards], not_measured}`.

**Seam memory.** Cloud keeps no seam history yet (it moves with the seams slice), so every plan
passes an empty `SeamMemory`, and no word links (`phrases` is empty), as on a Desktop library with
neither. The release year is unknown in Cloud, so traits have none.

**Cost.** At most 60 songs per order or ideas request (as the hosted plan); songs are read in one
transaction (`engine_store.songs.load_songs`) and then each song's arrays. Routes run in the
server's thread pool, off the event loop. Rate limits on top of the account's: `planning` 60 a
minute (burst 20) for `POST /api/planning/*`, `song_facts` 300 a minute (burst 100) for the facts
upload (`ratelimit.STRICT`).

## What a studio does with the answers

1. Ask for candidates. Render option 0's script; audit it; turn the report into `AuditFacts`.
2. Run `take_step` (tighten the beats when the beat check failed), then `next_step` over the
   options and the attempts so far: `ACCEPT`, `TRY` another index (fetch its script if it wasn't
   sent), or `FALLBACK` to the cut in `fallback`.
3. Keep the clip on the device. Nothing rendered is sent back in this phase.

## Uploaded music

A hosted analysis (`workers.engine_handlers.analyse`) can also become the facts of the catalogue
song with the same bytes, as `worker` facts: `facts_store.record_worker_analysis(store, artifacts,
sha256, analysis_npz)`. The hosted session doesn't call it yet; see the to-do item "Hosted analysis
should also write song facts".

## Export and deletion

The account export adds `song-facts.json` (the workspace's `analysis`, `song_overrides`,
`ratings` and `local_song_hashes` rows) and each measured song's arrays under
`song-facts/features/` (`cloud_brain.export`). Account deletion removes every row carrying the
workspace id and every object under its prefix, the features included.

## Next

- The browser measuring songs and sending facts (`web/src/dsp`, `cloud.device_analysis`).
- The device job route: claim, render, audit and report from the member's own studio.
- The cloud studio rendering these scripts for songs in the cloud library.
- Seam memory in Cloud once seam records move to the store.
