# To-do list

Everything still to do on SelectaDJ lives here, one small file per item in `docs/todo/items/`.
One file per item means two people (or agents) can add and close items at the same time without
ever editing the same file.

## Use it

```
python scripts/todo.py list                      # everything not done, most urgent first
python scripts/todo.py list --who owner          # only what needs the owner
python scripts/todo.py list --area lucy
python scripts/todo.py add "Title" --area lucy --priority high --who claude --source "where it came from" --body "what is wrong, what good looks like"
python scripts/todo.py set T-20261124-a1b2 --status doing
python scripts/todo.py done T-20261124-a1b2 --commit abc1234
python scripts/todo.py check                     # what the test runs
```

## Fields

| Field | Values |
|---|---|
| `id` | `T-YYYYMMDD-xxxx`, made by `add`; the file name starts with it |
| `title` | one line, says what is wrong or what is wanted |
| `area` | admin, billing, branding, ci, devices, docs, editor, infra, legal, library, local-app, lucy, rooms, security, shell, storage |
| `status` | open, doing, blocked, done, dropped |
| `priority` | now (broken for customers), high (before launch), normal, later |
| `who` | claude (code or settings Claude can do), owner (money, legal, accounts only the owner can act on), either |
| `created` | the date it was added |
| `source` | where it came from: a walkthrough, a doc, a PR, the owner's words |
| `commit` | the commit that settled it, once done |

Under the header, write what is wrong, where, and what good looks like. Add dated notes as it
moves.

## Rules

- Found something and not fixing it this minute? Add an item. Nothing lives only in a chat.
- Starting work on one: `set --status doing`. Finished: `done --commit`, in the same commit as
  the fix where you can.
- Never delete an item. `dropped` with a note says why it was not done.
- An item for the owner says exactly what they need to do or decide, in plain words.
- `tests/test_todo.py` fails if any item is malformed.
