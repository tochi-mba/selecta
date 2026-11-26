# The Lucy slice

ADR-0479, Phase 7. Lucy's Desktop tables (her conversations, turns, runs, event log, proposals
and revisions, approvals, commit records, memory, permission requests, and the player's
listening history she learns from) move onto the engine store, behind `core.engine_store` (off
by default). Code: `engine_store/lucy/` (the store side: `conversations.py`, `events.py`,
`proposals.py`, `memory.py`), `lucy/backing.py` (which path), `lucy/runs.py` and
`lucy/commit_store.py` (Lucy's own operations on the store), and every module of `lucy/` that
touches a table, unchanged in its rules. Migration: `lib0011lucy` (library chain only). The
store's rules are in [engine-store.md](engine-store.md).

## Where the tables were, and how they are adopted

They were never in `db.SCHEMA`: `lucy.schema.ensure` made them with `executescript` the first
time any Lucy route ran. `lib0011lucy` runs those exact statements (`CREATE TABLE IF NOT
EXISTS`, a test holds its copy equal to `lucy.schema.SCHEMA`), then adopts each table in place
as the earlier slices did: `workspace_id` (default `local`) and its index. No row is copied or
rewritten and every key stays (`lucy_events.id` keeps its AUTOINCREMENT order); a library holds
one workspace. With the flag on and the file stamped past `lib0011lucy`
(`library.includes`), `ensure` runs no DDL.

| Table | One row is |
|---|---|
| `lucy_conversations` | a conversation: title, scope, its proposal, `next_seq`, `pruned_through` |
| `lucy_messages`, `lucy_turns` | a message at the server's sequence; a send, once per client id |
| `lucy_runs` | one attempt to answer a turn: state, ceilings, usage |
| `lucy_events` | the ordered log every live view replays |
| `lucy_proposals`, `lucy_revisions` | a pointer and its immutable snapshots |
| `lucy_approvals`, `lucy_commits` | a host-issued token; a save's receipt by idempotency key |
| `lucy_memory`, `lucy_permissions` | a fact Lucy keeps; a request the person decides |
| `listening_events` | a real play from the player, kept only with history on |

All twelve are declared on `schema.library_metadata`, so no Cloud migration or check sees them.

## One operation, one write

Each public function in `lucy/` asks `backing.store_of(conn)`:

- Flag off (or the file not past `lib0011lucy`): `None`, without a statement, and the function
  runs its old body, the very statements and commits as before.
- A connection holding uncommitted writes (`conn.in_transaction`) stays on the old path too.
- Otherwise one `engine_store.lucy.Tx` (`backing.reading` or `backing.writing`), SQLAlchemy Core
  only. An event appended inside a write is announced to the live streams (`events.LATEST`)
  only after it commits.

What used to be several commits for one act is now one write: a turn, its user message, the
turns it supersedes, the new title and their events; a revision, its pointer and its event (a
stale expectation refuses the whole write); a rename and its event; a branch and its copied
messages; a permission's answer, the songs it moves up and its event; learned taste replaced
whole; a restart's recovery of every unfinished run.

## Streaming

A reply streams as many short writes, each on its own: one event (`message.delta` every few
characters), the text so far once a second (`runs.save_text`), a state, a usage. The page's
reads are deferred reads and never wait behind them. A reply cut off midway leaves exactly
what the last write left: the message `streaming` with the text it had, the run and turn
unfinished. `agent.recover` (one write) then marks the run, the message and the turn
`interrupted` with its event, the same rows on both paths
(`test_a_reply_cut_off_midway_is_closed_whole`).

## Saving a revision is one write

`commit_store.commit` reads first: the commit already made under this key, the approval, the
fresh preflight, whether the revision is still current, and for save-and-play whether every
clip is still playable. Then ONE store write: the approval is used (`used=0` to `1`, or the
write refuses), the draft is made from the frozen order through `StoreMixes` on the same
transaction (`mix.create_draft`), marked ready-only, played when asked (`mix.play_draft`
writes the current mix and its Undo there too), and the commit record and its event are
written. A failure anywhere leaves no draft, no change to the mix, the approval unused and no
record (`test_saving_a_revision_is_all_or_nothing`), so a retry starts clean. The old path
records `pending` first and reconciles after a crash; the store path never leaves `pending`,
and still reconciles one the old path left. Lucy's writes to the mix were already
`mix.py`'s functions; only her raw `UPDATE drafts SET ready_only` was not, and is now in the
same transaction.

## Faults found on the way

- No positional INSERT in Lucy's modules: every one names its columns.
- `SELECT *` on her tables is read only by column name (`_shape`, `_turn`, `_message`), so the
  added `workspace_id` never reaches an answer; the store's rows carry it and are read the same
  way. Two route reads that returned whole rows (`lucy_runs` in the snapshot and diagnostics)
  pick their columns by name.
- The old `conversations.delete` relies on `ON DELETE CASCADE` for messages, turns, runs,
  proposals and revisions; the store names each delete, so it does not depend on the pragma.
- `memory.play_counts` used SQLite's `datetime('now', '-N days')`; the store compares with the
  same cut-off computed in Python, in the form SQLite writes.

## Tests

`tests/test_engine_store_lucy.py` builds a library with today's old path holding conversations
(open, archived), turns, messages, a proposal with two revisions, a saved commit, a failed one
and one left pending, permissions pending, allowed and denied, memory and listening history.
It proves: the migration's DDL equals `ensure`'s; flag off leaves the schema unchanged with no
stamp; the migration keeps every row; every Lucy operation (about seventy calls) gives the same
answers and rows through the store as the old path on a copy, with one ticking clock and
counted ids; a cut-off reply is closed whole; a save is all or nothing; backup carries the
tables. The API and agent tests also pass with the flag on for every test (checked locally).

## Backup, restore and account data

A backup is the whole library file, so Lucy's tables travel with it and a restore brings them
back (`test_backup_carries_lucys_tables`). `backup._check_database` requires only the library's
own tables and counts songs, drafts and ratings: a library that never used Lucy is a valid
backup, and the counts stay what the restore preview has always shown. The Desktop has no
"export my data" that lists Lucy's conversations; Cloud's account export reads Cloud Lucy's
tables (`routes/cloud_export.py`), untouched here.

## Desktop Lucy and Cloud Lucy

Cloud Lucy (ADR-0476) has her own multi-tenant tables, made by `bf0476lucy01` with the forced
workspace policy: `lucy_cloud_conversations`, `_turns`, `_messages`, `_events`, `_proposals`.
They are not these tables and nothing here changes them. Conversations, turns, messages and
events are close cousins (Cloud adds the owner `user_id` and a device on each turn, and keeps
epoch times); proposals differ in kind (Cloud keeps one row per revision with catalogue song ids
and saves to a recipe revision; the Desktop keeps a pointer, immutable snapshots, approvals and
commit records that make a draft). Cloud has no runs, memory, permissions or listening history
tables. Sharing one set later would mean a common shape for the first four and a decision on
proposals; that is to-do T-20261126-83c2, not work for now.
