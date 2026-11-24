# ADR-0476 - Lucy in Cloud: the full conversation over the catalogue and recipes

- **Decision:** Proposed (the owner asked for "the full convo" in browser-first Cloud on 2026-11-24; approval is the owner's).
- **Implementation:** Built on branch `feat/controller` (PR #133, merged; continued in PR #134). See "What is built" at the end.
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

All under `/api/lucy-cloud/...` in the Cloud app (a prefix of their own, so no route is owned by two flags; the page's client maps `/lucy/...` to it through a transport), flag `lucy.cloud_conversation`, tenant-scoped by the signed-in principal and `X-Workspace-ID`, and further scoped to the person: a conversation belongs to the workspace and the user who started it, and any other user (or workspace) gets exactly the answer a made-up id gets (404). Reads need `mixes.read`; anything that writes a recipe needs `mixes.edit`.

The paths and answer shapes are the ones the local page already reads (`web/src/lucy/client.ts`), so the page is reused unchanged:

- `GET /api/lucy-cloud/status`: the person's choices in the local status shape; the provider is shown as the plan's Lucy level, never a model or key.
- `PUT /api/lucy-cloud/settings`: only `enabled`, `phases` and `privacy`; anything else is refused (422), as `/api/account/lucy` does.
- `GET|POST /api/lucy-cloud/conversations`, `GET|PATCH|DELETE /api/lucy-cloud/conversations/{id}`.
- `POST /api/lucy-cloud/conversations/{id}/turns`, `/stop`, `/retry`; `GET /api/lucy-cloud/conversations/{id}/events.json?after=N`.
- `GET /api/lucy-cloud/revisions/{id}`, `/diff`, `/readiness`; `POST /api/lucy-cloud/revisions/{id}/edit`; `POST /api/lucy-cloud/proposals/{id}/current`.
- `POST /api/lucy-cloud/approvals`, `POST /api/lucy-cloud/commits`, `GET /api/lucy-cloud/commits/{key}`.
- `GET /api/lucy-cloud/memory`: says there is no Cloud memory yet (empty, history off).

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

## Edge cases

Each item names where it is handled; "decided" lines say what happens and why.

1. **How much of the conversation the model sees.** The whole conversation up to a per-plan budget (`cloud_agent.HISTORY_CHARS`: about 3k, 10k and 20k tokens for Free, Standard, Premium) is sent verbatim, newest first; anything older becomes one line listing what the person asked. A tool call and its result are stored inside one answer's note, so a cut never splits them. The fixed instructions and tools are the cached prefix (`cache_control` on the first system block); the evaluation report prints the measured cache reads. Test: `test_a_long_conversation_keeps_recent_turns_verbatim_and_names_older_asks`.
2. **Two devices or tabs at once.** One conversation per person per workspace, read from the server on every device. The gateway's run slot serialises turns per account: a second send while Lucy answers gets 409 "Lucy is still answering your last message", never a queue or an interleave. A resend with the same client id is the same turn. Tests: `test_a_second_send_while_lucy_answers_is_refused_not_counted`, `test_sending_twice_with_the_same_id_is_one_turn`; eval case `rapid`.
3. **A cut-off answer.** The browser closing or losing the network changes nothing on the server: the turn finishes and the page catches up from the event log. A server restart leaves a turn `running`; the next read of the conversation after five minutes marks it interrupted (the partial text stays, the page offers Try again) and settles the gateway run as `abandoned`, which gives the turn back and frees the run slot. Tools are single transactions: a proposal is stored whole or not at all, and nothing a tool does changes a mix. Test: `test_a_turn_left_running_by_a_restart_reads_as_interrupted_and_is_given_back`.
4. **Deleting, exporting, isolation.** Deleting a conversation removes its messages, events and proposals (saved mixes stay). Account deletion removes every row with the workspace's id (generic in `identity/deletion_effects.py`), so these tables are included. The account export now carries `lucy-conversations.json` with the person's conversations. Another member, or another workspace, gets the same 404 as a made-up id. Tests: `test_a_conversation_is_only_ever_its_owners`, `test_the_account_export_carries_the_persons_conversations`, the tenant matrix and the side-effect map rows.
5. **Flag off.** `lucy.cloud_conversation` off: the routes are refused by the flag guard, and the shell keeps Lucy off, so `/mixes/lucy` shows the "only on your computer" page and Make a Mix shows no Lucy link. Test: "keeps Lucy's conversation closed in the browser while lucy.cloud_conversation is off" (`LocalFirstShell.test.tsx`).
6. **Plan changes mid-conversation.** The tier is read from the entitlement at every turn's admission, so an upgrade or downgrade applies to the next turn with no error. A turn already running finishes on the model it started with (the run is pinned). When the allowance runs out, the next turn is answered by the built-in words: why, when turns come back, and a library search; the conversation stays readable. Test: `test_turns_run_out_and_lucy_says_so_without_a_model`.
7. **The dollar ceiling.** Stepping down a model is silent to the person (no error); Billing's Lucy lines say "usually answered by" so the plan never promises a model a heavy month can take away.
8. **Provider failures.** The Anthropic SDK retries 429, 529 and 5xx twice with backoff; after that the person reads "Lucy is busy right now. Try again in a moment; this didn't use one of your turns" (failed and incomplete runs are refunded by `finish_turn`). A refusal says "I can't help with that one"; an empty answer is replaced by a plain sentence; a max-tokens cut-off ends with "(That answer got too long; ask me for the rest.)". Tests: `test_a_provider_failure_ends_the_turn_truthfully_and_gives_it_back`, `test_a_blank_model_answer_is_never_a_blank_bubble`.
9. **The key.** It comes only from the deployment's secret reference (`env:ANTHROPIC_API_KEY`); it is never in an event, a log line, an error the person sees or the evaluation report (the report holds words, answers and numbers only). `ANTHROPIC_WORKSPACE_ID`, when set, is sent as `anthropic-workspace-id` (needed for organization-scoped user keys). Test: `test_the_provider_names_the_anthropic_workspace_only_when_one_is_set`.
10. **Untrusted text.** Song titles, artists and albums reach the model only inside tool results, as JSON strings; the instructions say such text is data. The evaluation library holds two titles that give orders, and three cases check Lucy treats them as names. Rooms, folder names and guest requests are not given to Lucy in this version.
11. **Tools stay inside the account.** Every tool reads with the caller's workspace id from the same tables and functions the routes use (`local_media.store`, `recipes`, `current_mix`), and saving goes through `recipes.edit` or `create` with the stale check, behind the same flag and `mixes.edit` permission. Nothing destructive happens in a turn: every change is a proposal the person saves. Lucy is told to ask before proposing to remove more than three songs or to clear or replace a mix.
12. **Playback.** Decided: Lucy never starts playback. "Save and play" makes the saved mix the account's current mix (ADR-0475 R8); what plays, and where, is then the shell's: its player follows the single device rule and the "Where should the music play?" picker. Lucy answers "play it on the kitchen speaker" by pointing at Play and the picker.
13. **What can play.** Search and mix results mark songs no open device holds (`not_on_an_open_device`, only once any device reports holdings) and songs marked never play; Lucy is told to leave never-play songs out unless named and to say when a song only plays once a device that has it is open. Test: `test_never_play_songs_are_marked_for_lucy`; eval cases `never-play`, `never-play-named`.
14. **A phone with no music.** Lucy needs no music on the device: a phone can propose and save a mix, which becomes the account's mix, and the laptop (or "Play on") plays it under ADR-0475.

### Several devices and tabs on one conversation (G)

15. **Live sync.** Every open device and tab reads the same per-conversation event log (`events.json` with a cursor, every 500 ms while visible), so a message sent on the phone and the answer's text appear on the laptop within half a second; a device that reconnects carries on from its last event id, and a gap or an unknown shape makes it reload the snapshot. Polling, not push, is the decided transport: a bearer token can't ride on an `EventSource`, and the workspace outbox is for state changes, not tokens.
16. **One turn at a time.** Decided by the server with the gateway's conditional lease write (`ai_concurrency`, one statement, not read-then-write). The losing device gets 409 `busy` with "Lucy is answering a message from {device}. Send this again when she's done; your words are kept." The words stay in its box and it sends on one press (chosen over sending by itself, so nothing is sent the person didn't see go). Test: `test_the_device_that_loses_the_race_is_told_which_device_lucy_is_answering` (two truly concurrent requests; it also runs on PostgreSQL when the suite has one).
17. **Server order.** Each message has a server `seq` and every page sorts by it, never by a device clock. A send is keyed by its client id (unique per conversation, kept for the conversation's life), so a retry, at once or minutes later, is the same turn; two copies arriving together resolve to the first. Test: `test_one_send_retried_at_once_is_one_turn_and_order_is_the_servers`.
18. **Stop from any device.** The stop route marks the turn `stopping`; the process running it hears at once, and another server reads the mark within a second. Every device sees the turn cancelled; the answer ends "(Stopped. Nothing was changed.)" or says a proposal was already made. Tools are proposals, so nothing half-applied exists. Tests: `test_a_stop_from_another_device_ends_the_answer_everywhere_and_says_so`, `test_a_stop_mark_alone_stops_a_turn_another_server_is_running`.
19. **Joining mid-answer.** The snapshot rebuilds a streaming answer's text from its deltas up to the cursor it hands out, so the joining device then reads exactly the rest. Test: `test_a_device_joining_mid_answer_gets_the_text_so_far_then_exactly_the_rest`.
20. **Drafts.** Unsent words are kept per device and per conversation in that browser (`lucy/unsent.ts`), never synced; an incoming turn never clears the box, never takes focus, and a reader scrolled up gets "New messages (n)" instead of a jump (`useStickToBottom`; `LucyComposer.focus.test.tsx`, `LucyLxPage.test.tsx`).
21. **One save, from any device.** Lucy asks for confirmation in words; the only action is the person's Save, bound to the exact revision and its hash, expiring after five minutes and refused when the proposal is no longer current or the mix changed. The first save wins; a second device's save answers 409 `already_saved` and changes nothing; the same device's retry with its own key gets its first answer. Every device hears `commit.updated`. A "yes" typed later is just a message to Lucy, who can only make a new proposal. Test: `test_a_proposal_saved_on_one_device_cannot_be_saved_again_from_another`.
22. **"Here".** Each turn carries the device it was typed on (`device_id`, checked to belong to the workspace; stored with its name), and Lucy's "Right now" block says it. Two devices with one name: she is told to ask. A named device not open: the block says "not open" and she says so. Test: `test_lucy_is_told_the_sending_device_and_fresh_state_each_turn`, `test_a_device_id_from_another_account_is_ignored`.
23. **Fresh state.** The "Right now" block is read before each model call (devices, open or not, holdings, the speaker and its state, the default speaker, the current mix) and the instructions say it wins over earlier turns. Eval cases `stale-state`, `devices-now`. Not given yet: the playing position and room requests.
24. **The world changing mid-action.** Lucy's only action is a proposal; saving reports the real outcome (a recipe revision, or the stale/deleted refusal in the preflight), and playback starts only through the shell's player, which reports its own result. She never claims success from intent: the instructions forbid saying she saved or played anything.
25. **Two people.** Conversations are per person. Playback sessions are per workspace (ADR-0475); when the speaker device belongs to another member, the block says so and Lucy is told to say whose session it is and ask before suggesting a change to what plays. She cannot take over herself.
26. **Hand actions during a turn.** Lucy has no skip, add-next, volume or remove-from-queue tool; a mix change is a proposal saved against the revision it was made from, so a change made by hand meanwhile makes the save stale rather than doubled.
27. **Rooms.** Guests never talk to Lucy and guest request text is not given to her in this version; "play what guests asked for" is answered by pointing at the Rooms page (eval `room-guests`).

### The conversation over time (H)

28. **Delete on one device.** Deleting removes the conversation for every device at once (their next read is 404 and the page says it isn't here any more; each device's unsent draft stays in its own browser). Deleting while Lucy answers stops the answer first, and a running turn writes nothing into a deleted conversation, so neither a late event nor a retried send (404) brings it back. A new conversation has a new id. Test: `test_a_conversation_deleted_mid_answer_stays_deleted`.
29. **Signing out.** Signing out on one device ends nothing elsewhere; a signed-out device's token stops working, so its next poll is refused and it reads nothing more. A session that expires mid-answer gets the sign-in prompt from the Cloud request layer; the turn finishes on the server and is there after signing back in.
30. **Older turns.** The one line of older asks is built deterministically from the stored messages at each turn, so every device and server builds the same one; it is not stored. Every message stays readable in the page (the snapshot holds the whole conversation; paging is not built and will be needed for very long conversations). A message over 4,000 characters is refused with its count on the page and with 422 on the server.
31. **Counting.** A turn is counted once, on the server, when the gateway admits it (on accept, before any model call), however many devices watch; a failed or stopped turn is given back. Two sends racing for the last turn: one is counted. Test: `test_two_sends_racing_for_the_last_turn_count_it_once`. Not built: the remaining count updating live on other devices; it updates on the next read of Lucy's settings.
32. **Offline mid-send.** The page keeps the words with "Not sent ... Press Send to try again"; a resend uses the same client id, so it is never two turns (`Lucy.tsx` send, item 17).
33. **Background tab or locked phone.** The event reader pauses after a minute hidden and, on return, reads every event since its cursor; a finished answer's `message.completed` carries the whole text, so the answer is complete, not frozen (`lucy/stream.ts`).
34. **Restart or deploy mid-answer.** The turn is left `running`; the next read after five minutes marks it interrupted (Try again), settles its gateway run as abandoned (turn given back), and the account's run slot frees itself when its lease expires (the plan's turn limit plus a minute), so nothing stays on "Lucy is answering" for ever. Test: `test_a_turn_left_running_by_a_restart_reads_as_interrupted_and_is_given_back`.
35. **Plan and model.** The page shows the plan's Lucy level ("Using Lucy Basic"), never a model, so it is true for every turn; each turn's gateway run records the tier, deployment and class that answered it, for support. Conversations are the same data on every plan, so an upgrade keeps them.
36. **Privacy.** Conversation text is never written to logs or analytics; errors carry codes and ids only. The export carries the conversations; deleting the conversation or the account removes them (there is no stored summary). The model request carries the instructions, the library and state blocks and the conversation; no email or name is sent (device names are, as the person named them).

### The interface on every device (I)

37. **Phone sizes.** Walked at 360x740 and 740x360 on the local stack: no sideways scroll, the message box docks above the player and tab bar in portrait and stays above the keyboard (`--keyboard-inset`). In landscape the box sits in the page flow under the heading and the tabs, one scroll away; long song lists live in the Your mix pane, not in the answer.
38. **Screen reader.** One polite announcement per finished answer, not per token; "Lucy is replying" and stopped are announced; Save and Save and play name what they save (existing `LucyA11y.test.tsx`, `LucyLxAnnounce.test.tsx`).
39. **Motion.** Streaming text is plain text; Still and reduced motion stop the working bar (existing Lucy styles).
40. **Actions from old turns.** Only the current proposal revision can be saved; an older one says "Make this the current revision to save it", and a save checks the mix's current revision and says "Your mix changed since Lucy made this" when it moved.

## What is built

- Server: `selecta.lucy.cloud_schema`, `cloud_store`, `cloud_tools`, `cloud_prompt`, `cloud_agent`, `cloud_proposals`, `cloud_world`, `cloud_routes`; migrations `bf0476lucy01` (tables, isolation policy), `bf0476lucy02` (the device a turn came from), `bf0476lucy03` (one turn in flight per conversation). Practice Lucy for the dev stack: `selecta.devstack.lucy_practice` (`SELECTA_DEV_LUCY_PRACTICE=1`).
- Page: the local Lucy page reused through `setLucyTransport` (`web/src/lucy/client.ts`), opened by the local-first shell at `/mixes/lucy` while `lucy.cloud_conversation` is on. Cloud-only words where Cloud differs (Save, not Save as draft; transitions worked out as the mix plays; one answer at a time); suggested first asks from the person's library; Copy, Try again, Edit and a useful/not useful rating on answers; times on hover, focus or touch; quieter turns.
- Evaluation: `tests/lucy_eval/requests.json` (72 cases), `tests/lucy_eval/library.json`, `tools/lucy_eval.py`.
- Proved in a browser on the practice stack with two devices (laptop 1280x800, phone 360x740): items 15, 16, 18 and 21.

### Built after the first report

- Body limits: settings take at most the named phases and privacy choices; a turn's selection and an edit's op at most four fields.
- Clear in the conversation header (confirms; stops a running answer; every device).
- At most two follow-up asks under the newest answer, only after work they continue.
- "Why these songs", folded, in the mix pane.
- `interactive-widget=resizes-content` in the viewport meta (Android); the shell's `visualViewport` inset already keeps the box above the keyboard on iOS.
- The remaining-turns meter updates on every device (`lucy.turns` on the workspace stream).
- Long conversations open on their newest 80 messages; "Show earlier messages" reads a page at a time.
- Lucy's state block names where the playing mix is (song and time) and the open room's waiting requests as catalogue songs.
- Inline tool cards were already there: one card per tool call, with its own title ("Searching your library", "Proposing a new mix") and state.

### Not built yet

- A real-phone keyboard check (it cannot be emulated here).
- Song titles in the playing position (the session holds an index; the speaker's programme holds the titles).
