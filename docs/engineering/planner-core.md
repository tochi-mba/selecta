# The planner core

ADR-0479 ("One brain, two studios") asks for one planner that the Desktop server and the Cloud API
both run, from song facts alone. `src/selecta/planner_core/` is that planner. It decides; it never
touches audio, files or a database. A studio (the Desktop process, a cloud worker, later the
member's browser) renders, audits and runs the loop, asking the core what to try next.

## What is in the core

| Module | What it decides |
| --- | --- |
| `fit` | Whether two songs belong together: folded tempo gap, level steps, timbre space, the rated limits (`CLOSE_TEMPO`, `FAR_KEYS`, `STEADY_GRID`...), `pulse` and `felt_bpm` |
| `choose` | Every transition candidate between two songs, scored and ranked (`enumerate_candidates`, `styles_for_language`, `fallback_candidate`, `Candidate`) |
| `recipes` | The bar-cue recipes (`Recipe`, `all_recipes`, `blend`, `exits`, `timing`): each builds a `TransitionScript` from facts |
| `repair` | The repair rule: `AuditFacts`, `next_step`, `take_step`, `good_enough`, `closer`, `NEAR_MISS`, `MAX_REPAIRS` |
| `beam` | The order of a mix (`plan_set`, `best_order`, `suggest_next`, `rank_candidates`) |
| `vibes` | Mix ideas: the cards, their traits, and the move planned into each song (`build_vibe`, `seam_choices`) |
| `wordreel` | Which word and voice hand-offs two songs can carry (`modes_for`, `ride_lines`, `rank_links`) |
| `stem_gates` | Cheap gates before any stem split (`find_placement`, `can_arrange`, `can_intertwine`) |
| `memory` | `SeamMemory`, what past renders and ratings say, and `RULES_VERSION` |
| `moods`, `arc` | Lyric themes and energy shapes |
| `harmony` | The roughness kernel and `HARMONY_LIMIT`, shared with the audit's harmony check |
| `moves`, `names` | Which moves this build has on (`move_on`, `sense_on`), and how artists compare (`clean_artist`) |

Every name that moved is still importable from its old home. The modules that moved whole
(`planner/fit`, `memory`, `arc`, `moods`, `beam`, `vibes`, `styles/blend`, `exits`, `timing`) are
the same module object at the old path (a `sys.modules` alias), so imports and test patches there
behave as before. The rest are plain re-exports. `tests/test_planner_core_paths.py` pins both.

## What stays outside, and why

- `planner/choose.py`: the Desktop render-audit loop (`choose_transition`, `Choice`, `Attempt`).
  It renders and audits, so it needs the engine and the audit.
- `planner/wordreel.py`: finding words in the separated voice (`locate_phrase`, `voice_edge`),
  `analyse_links` (SQLite) and `build_takes` (renders).
- `planner/ready.py`, `prepare.py`, `reel.py`, `gridcheck.py`: SQLite, `soundfile` and rendering.
- `styles/wordplay.py`: the word recipes take word timing from the separated voice and import
  `lyrics.align`, which pulls in the job system. They stay until word timing is a fact too.
- `seam_making.py`, `seams.py`, `request_planner.py`: the seam studio and the request book, which
  read and write files. `request_planner._rules()` hashes the core's source files (read at call
  time, not import) to know when its book is stale.

## Entry points and what a caller passes in

Everything takes song facts (`SongInfo`, `Cue`) and plain values. Nothing is fetched inside:

- `choose.enumerate_candidates(a, b, style=None, recipes=None, exits=None, entries=None)`
- `beam.plan_set(songs, start_id, count, ..., memory=SeamMemory, links=..., belongs=...)`
- `vibes.build_vibe(vibe, songs, traits, phrases, ..., memory=SeamMemory, stems=...)` and
  `vibes.traits_of(songs, years)`
- `beam.suggest_next(...)`, `beam.rank_candidates(...)`: `memory` is passed in
- `repair.next_step(options, attempts, max_repairs)`, `repair.take_step(first, second)`

`SeamMemory` is built by the caller from seam records (`SeamMemory.from_states`) and passed in;
the core never reads the seam history. Flags are read through `selecta.flags.on`, which is pure
and bound to the caller's context. `RULES_VERSION` is a plain constant (1), not a hash.

## The repair rule

A studio renders the ranked candidates, audits each take, and turns each audit into
`AuditFacts` (`audit.checks.audit_facts(report)`): whether it passed, and for each failed check
its name, value, limit and the fix it names. Nothing else.

`next_step(options, attempts, max_repairs=4) -> RepairStep` takes the ranked candidates as
`Option`s (`Option.of(candidate)`: move, bars, both cues) and the attempts so far as
`Attempted(option_index, audit_or_None)`. It returns one of:

- `ACCEPT, option`: the last take passed.
- `TRY, option`: render this one next. After a failed take: a shorter overlap of the same move
  for `shorten`; the same move at other cues for `move_cue` or `close_gap`; otherwise another
  move; otherwise anything untried. After a recipe that built no script: the next untried option
  in rank order. Two options with the same move, exit bar, entry bar and length are one attempt.
- `FALLBACK`: nothing left, or more than `max_repairs` renders after the first have failed
  (scripts never built don't count). The studio then renders `fallback_candidate`, a cut.

`take_step(first, second=None)` is the per-take half: `TIGHTEN` when the beat alignment check
failed (the studio measures the offset and renders a second take, keeping the first if it
can't), then `KEEP` with `take` 0 or 1, whichever take is closer to clean (fewer failures, then
less over the limits; a tie keeps the first). `good_enough(facts)` says whether a take that
didn't pass is only a near miss.

Every value has `to_json` and `from_json` (`RULE_SCHEMA = 1`); non-finite numbers are tagged the
same way as in `render/script_json.py`. A browser port can run the same rule against the same
fixtures. `tests/test_planner_core_repair.py` holds them, including a replay of the old loop over
every mix of outcomes.

The Desktop loop (`planner/choose.choose_transition`, `seam_making.tighten_beats`,
`seam_kinds.good_enough`) now calls this rule, with the same choices as before.

## The purity rule and how it is checked

Modules in the core may import only: the standard library (not `sqlite3`), numpy,
`selecta.flags`, `selecta.analysis.song`, `selecta.analysis.key`, `selecta.render.script`,
`selecta.render.sources`, and each other. Imports under `if TYPE_CHECKING:` are allowed, since
they only feed annotations.

`tools/planner_core_pure.py` (run it with `python tools/planner_core_pure.py`) and
`tests/test_planner_core_pure.py` check that three ways: every import statement in the core's
source; a fresh Python that imports every core module with `selecta.analysis.song` stubbed out
must load nothing forbidden (sqlite3, soundfile, librosa, soxr, scipy.signal, torch, demucs,
httpx, SQLAlchemy, the renderer, the DSP, the audit, stems, `selecta.db`, the analysis pipeline,
the lyric client, `selecta.planner`) and read no data file; and with the real
`selecta.analysis.song`, nothing forbidden may load that the song module alone doesn't load.

That stub is the one allowance. `selecta.analysis.song` still imports the analysis pipeline,
sqlite3 and the lyric client at module level for `load_song`; the song-storage slice is moving
those out, and then the allowance goes.

## What is next

- Planning routes in Cloud over the engine store: build `SongInfo` from stored facts, build
  `SeamMemory` from stored seam records, and call `plan_set` / `build_vibe` /
  `enumerate_candidates` in the Cloud API.
- The device job route: send the ranked candidates as scripts plus the rule's `Option`s to the
  member's browser, which renders, audits and posts `AuditFacts` back (or runs a port of
  `next_step` against the shared fixtures).
- Word moves: once word timing is a stored fact, move `styles/wordplay` recipes into the core.
- Drop the `selecta.analysis.song` allowance once `load_song` leaves that module.
