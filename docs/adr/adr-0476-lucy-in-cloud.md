# ADR-0476 - Lucy in Cloud: the full conversation over the catalogue and recipes

- **Decision:** Proposed (the owner asked for "the full convo" in browser-first Cloud on 2026-11-24; approval is the owner's).
- **Implementation:** In progress on branch `feat/controller` (PR #133). See "What is built" at the end.
- **Independent verification:** None.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-24; `feat/controller` at `a8a7469a`.
- **Existing ADR owners:** ADR-0311 (Lucy's agent run), ADR-0404 (the Lucy AI gateway), ADR-0458 (catalogue and portable recipes), ADR-0475 (the account's current mix). None is replaced.
- **Flag:** `lucy.cloud_conversation` (in `src/selecta/flags/lucy.json`, cloud mode only, requires `lucy` and `cloud.local_media`). Off: the Cloud shell keeps Lucy's settings card only, as before.

## The problem

Local Lucy talks to a model about a library the desktop server has analysed: every song has a tempo, key, energy and lyrics in the local SQLite library, and proposals are plans over analysed transitions that become local drafts. Cloud has none of that. The music files stay on the person's devices; the account keeps a catalogue of song details (title, artist, album, duration), the mixes as recipes over catalogue songs, and settings. Cloud had only Lucy's settings card.

## What local Lucy depends on, and what Cloud does instead

| Local piece | Local-only dependency | In Cloud |
| --- | --- | --- |
| `lucy/conversations.py`, `events.py`, `schema.py` | the desktop SQLite file | new tenant tables (below), per workspace and person |
| `lucy/agent.py` run loop | in-process runner, SQLite events, one WeftAI "plan" tool | `lucy/cloud_agent.py`: the same states and events, each turn admitted by the gateway, a few plain named tools |
| `lucy/tools*.py`, `planning.py`, `repair.py` | analysed library, seams, renders | `lucy/cloud_tools.py`: catalogue search, artists, the current mix, saved mixes, two proposal tools |
| `lucy/proposals.py`, `commit.py` | local drafts and rendered transitions | `lucy/cloud_proposals.py`: a proposal is a list of catalogue songs; accepting it writes a recipe revision |
| `lucy/memory.py`, listening history | local play log | not in Cloud yet; Lucy says so |
| `lucy/settings.py` provider and budgets | bring-your-own key | server policy through `selecta.ai.gateway`; the person's choices from `/api/account/lucy` |

## Routes

All under `/api/lucy/...` in the Cloud app, flag `lucy.cloud_conversation`, tenant-scoped by the signed-in principal and `X-Workspace-ID`, and further scoped to the person: a conversation belongs to the workspace and the user who started it, and any other user (or workspace) gets exactly the answer a made-up id gets (404). Reads need `mixes.read`; anything that writes a recipe needs `mixes.edit`.

The paths and answer shapes are the ones the local page already reads (`web/src/lucy/client.ts`), so the page is reused unchanged:

- `GET /api/lucy/status`: the person's choices in the local status shape; the provider is shown as the plan's Lucy level, never a model or key.
- `PUT /api/lucy/settings`: only `enabled`, `phases` and `privacy`; anything else is refused (422), as `/api/account/lucy` does.
- `GET|POST /api/lucy/conversations`, `GET|PATCH|DELETE /api/lucy/conversations/{id}`.
- `POST /api/lucy/conversations/{id}/turns`, `/stop`, `/retry`; `GET /api/lucy/conversations/{id}/events.json?after=N`.
- `GET /api/lucy/revisions/{id}`, `/diff`, `/readiness`; `POST /api/lucy/revisions/{id}/edit`; `POST /api/lucy/proposals/{id}/current`.
- `POST /api/lucy/approvals`, `POST /api/lucy/commits`, `GET /api/lucy/commits/{key}`.
- `GET /api/lucy/memory`: says there is no Cloud memory yet (empty, history off).

## Storage

New module `selecta.lucy.cloud_schema` (registered in `persistence/registry.py`), migration `bf0476lucy01` with the forced PostgreSQL workspace isolation policy every tenant table has:

- `lucy_cloud_conversations` (workspace, user, title, scope, archived, times, last user text)
- `lucy_cloud_messages` (conversation, seq, role, turn, run, content, status, meta)
- `lucy_cloud_turns` (conversation, client id for idempotent sends, text, status, the gateway run id)
- `lucy_cloud_events` (an ordered log per conversation; the browser reads it with a cursor)
- `lucy_cloud_proposals` (each revision of a proposal: target mix and its base revision, or a new mix; the song ids; summary; whether it was saved and as which recipe revision)

No file path, device or audio detail is ever stored; song ids point at the catalogue.

## One turn through the gateway

1. `POST .../turns` stores the turn and the person's message, then admits it with `gateway.plan_turn` in the workspace transaction (tier from the plan, request class from the words: a whole new mix is `planning`, anything else `everyday`). A refusal (the account's run slot is busy, Lucy paused) is answered at once as 409 with the gateway's own words, and nothing is counted.
2. The turn runs on a worker thread. If the plan is the built-in planner (allowance used, dollar ceiling reached, no model reachable), Lucy answers honestly in plain words: which of those it is, when turns come back (the month's reset date), and a simple catalogue search for what was asked. She never pretends a model answered.
3. Otherwise `gateway.provider_settings_for` gives the provider (the key comes from the deployment's secret reference, never from anything the person typed) and the loop runs with the plan's ceilings: cycles, seconds, output tokens and the per-turn cost cap.
4. `gateway.finish_turn` settles it with the real tokens (cache reads and writes counted separately); a failed or stopped turn is given back.

## Streaming to the browser

Cloud's API sits behind a bearer token, and `EventSource` cannot send one. The page's stream (`web/src/lucy/stream.ts`) already falls back to reading `events.json` with a cursor; in Cloud it starts there, through the authenticated Cloud request, and asks every 500 ms while the page is visible (the local page's polling cadence is 1.5 s). Text deltas are batched on the server (about every 150 ms) so a reply is a handful of rows, and the deltas of a finished reply are pruned, since `message.completed` carries the full text. The workspace stream (`/api/events`) is not used for deltas: it is a durable outbox for state changes, not a token stream.

## Lucy's tools in Cloud

Plain named tools with small schemas, which a small model calls reliably:

- `search_songs(query, limit)`: catalogue songs matching words in title, artist or album.
- `list_artists(query)`: artists with song counts, to check before claiming the library has someone.
- `get_current_mix()`: the account's current mix, numbered, with total length.
- `list_mixes()`: the saved mixes.
- `propose_mix_change(add, remove, move, summary)`: a change to the current mix, by song id and 1-based position.
- `propose_new_mix(name, song_ids, summary)`: a new mix.

Results go back to the model as compact JSON that holds only catalogue metadata (id, title, artist, album, duration). Song text is untrusted data: the system prompt says so, and a title that reads like an instruction is just a title.

Proposals are never applied by the model. The person sees the songs in Lucy's pane and presses "Save" (the local Approve flow): saving writes the next revision of the target recipe through `local_media.recipes.edit` with the base revision the proposal was made from, so a mix changed meanwhile is refused as stale rather than overwritten; a new mix is created with `recipes.create`. "Save and play" also makes it the account's current mix (ADR-0475 R8); the browser's own player starts it.

## What Lucy honestly cannot know in Cloud

No audio is analysed on the server, so there is no tempo, key, energy or genre for a song, and no listening history. Lucy must say so when asked ("tempo isn't measured in the browser yet") rather than invent numbers. She may use general knowledge about artists to guess a style (for example that an artist is known for Afrobeats), and says it is a guess from the artist, not something measured. She never claims a song is in the library unless a tool returned it.

## Privacy

Only catalogue metadata and the conversation go to the model: no file paths (the catalogue refuses them at registration), no device names, no lyrics, no listening history. The person's settings are respected: with Lucy off or the chat phase off, turns are refused with the same words as local mode; with proposals off, the proposal tools are not offered; with commit off, saving is refused. Lyric snippets and listening history are not sent in this version whatever the setting says, because Cloud has no listening history and the lyric store holds only what Word connections looked up; the settings keep their meaning for when they are wired. Memory across conversations is not kept in Cloud yet; Lucy says what she does keep (this conversation) when asked.

## Product decisions in this ADR

- A conversation is private to the person who started it, even inside a shared workspace.
- One turn at a time per account (the gateway's run slot); a second send while Lucy is answering is refused with "Lucy is still answering your last message", not queued.
- Saving a proposal changes the mix it was made for (a new recipe revision); the page's "Save as draft" wording is kept for now.

## What is built

See the "Lucy in Cloud" section of PR #133 for the current state; it is kept up to date there.
