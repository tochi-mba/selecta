# Transition scripts as JSON

A transition is a `TransitionScript` (`src/selecta/render/script.py`). To render the same script
on Desktop, on a cloud worker or in the member's browser (ADR-0479), it has a JSON form:
`src/selecta/render/script_json.py`, with `to_json` / `from_json` and `to_dict` / `from_dict`.

## The rule

**A script never carries audio or file paths.** Each part names its audio with a source
reference, and whoever renders the script turns that into audio with a `SourceResolver`
(`src/selecta/render/sources.py`). A part that plays a file with no stem name can't be written;
`to_json` raises `ScriptJsonError` rather than guess from the file name.

## Schema (version 1)

```json
{
  "schema": 1,
  "facts_version": 3,
  "style": "bass_swap_blend",
  "duration": 38.5,
  "overlap": [6.0, 30.0],
  "expects_beats_aligned": true,
  "quiet_allowed": 0.0,
  "a": {
    "source": {"song": 12, "role": "mix"},
    "window_origin": 0.0,
    "facts": {"gain_db": -1.25},
    "warp": {"output": [0.0, 38.5], "source": [141.2, 179.7]},
    "gain": [[0.0, 1.0], [24.0, 1.0], [30.0, 0.0]],
    "low": [[17.7, 1.0], [18.3, 0.0]],
    "mid": [[0.0, 1.0]],
    "high": [[0.0, 1.0]],
    "highpass": null, "lowpass": null,
    "echo": null, "echo_send": null,
    "wash": null, "wash_send": null,
    "render_from": null, "render_until": null,
    "follows_b": false
  },
  "b": {"...": "the same shape"},
  "extras": [],
  "meta": {"bars": 16, "swap": 18.0, "swap_at": 0.5, "period": 0.4878}
}
```

- `schema`: this layout's version. A reader refuses any other.
- `facts_version`: `selecta.config.ANALYSIS_VERSION` when the script was written, so a studio
  can tell facts from an older analysis.
- Times are output seconds from the start of the clip, except warp `source` points and stem
  windows, which are song seconds.
- A curve is a list of `[time, value]` points, interpolated linearly. A warp is two equal
  length lists of matched output and source times.
- `echo` holds `delay_seconds`, `feedback`, `wet`, `return_highpass_hz`, `damp_lowpass_hz`.
  `wash` holds `wet`, `decay_seconds`, `damping`, `return_highpass_hz`.
- Floats are written with Python's shortest exact repr, so `from_json(to_json(script))`
  renders the same samples. A value that isn't finite is written `{"$type": "float",
  "value": "inf"}`.

## Source references

| Form | Means |
|---|---|
| `{"song": 12, "role": "mix"}` | The song's full mix |
| `{"song": 12, "role": "stem", "stem": "vocals", "window": {"start": 84.0, "duration": 31.5}}` | One stem of a separated window of the song |

`song` is the song's id where the script was made (a Desktop row id today; Cloud keys songs
by content hash). Stem names are `vocals`, `drums`, `bass`, `other`, and `band`, which is
drums, bass and other summed (`stems.band_of`). `window.start` equals the part's
`window_origin`: the song second where the stem file begins.

Stem parts are made in `styles/wordplay.py` from a `Stem` that `planner/wordreel.py` builds
after `stems.separate_window`; the `Stem` carries its name and window length so the part can
be named. With `render.one_engine` on (phase 2b, 2026-11-25), the Seam Studio, strip and land
and intertwined stems are scripts too (`src/selecta/render/stem_seam.py`): one stem part per
lane, named `vocals`, `drums`, `bass` or `other`, plus a full mix part for B after the overlap.
With the flag off they still mix their own stems and have no JSON form.

## What the renderer needs from song facts

Only the loudness gain, `facts.gain_db` (`SongInfo.gain_db`), read by `_apply_moves` and
`in_context` in `render/engine.py`. A part read from JSON gets a `SongFacts` in place of a
`SongInfo`. `in_context` also needs each side's full mix, which it asks the resolver for with
a mix reference for that part's song.

The audit reads more: `vocals_known` and lyric `lines` for the vocal overlap and phrase
integrity checks, and the song file to sense singing when lyrics are missing. A `SongFacts`
has no lyrics, so a studio auditing a script from JSON passes `vocal_spans` to `audit()`:
`{"a": [(start, end), ...], "b": [...]}` in song seconds. With spans the audit separates
nothing and reads no files. Without them, and with no file to listen to, it takes the careful
path for unknown vocals.

## Source resolvers

```python
class SourceResolver(Protocol):
    def resolve(self, ref: SourceRef, local_path: str | None) -> np.ndarray | str: ...
```

It returns decoded stereo audio at the engine rate, or a local path the engine decodes
through its `SongCache`. `local_path` is the file the part was built with on this machine, if
any. `LocalFiles`, the default for `render()`, `in_context()` and `render_set()`, returns it,
which is exactly what Desktop always did.

## Meta keys

Recipes and the seam pipeline put these in `script.meta`. Plain numbers, text, true or false,
lists and text-keyed objects are written as they are; numpy numbers become plain numbers.

| Key | Set by | Value |
|---|---|---|
| `bars`, `placed_bars`, `exit_bar`, `entry_bar`, `calls` | blend, wordplay, seam_making, studio | integer |
| `period`, `swap`, `swap_at`, `cut`, `b_at`, `handoff`, `voice_end`, `landing`, `roll_start`, `word_stage`, `fast_stage` | blend, exits, wordplay | seconds or a share |
| `echo_wet`, `echo_feedback`, `echo_room_beats`, `wash_wet`, `wash_decay_seconds`, `beat_limit_ms` | exits, wordplay | number |
| `energy_lift`, `source_density`, `acceleration`, `bass_midpoint`, `bass_mid_level` | wordplay `phrase_roll` | number |
| `wordplay` | wordplay | true or false |
| `stem_lanes` | studio, strip and land, stem intertwine (`render.one_engine` on) | true: every extra joins its side's dry signal (`follows_b` says which side), so the audit hears all of a side's lanes, and the seam pipeline tightens its beats and passes vocal spans from its own voice stems |
| `shape` | `phrase_roll` (text), studio (object of side to lane to list of 0 or 1) | as is |
| `arc` | seam_making | list of numbers |
| `vocal_gains` | studio, stem intertwine | `{"a": curve, "b": curve}`, each curve written `{"$type": "curve", "points": [[t, v], ...]}` |

The audit reads `period`, `beat_limit_ms`, `cut`, `wordplay`, `vocal_gains` and `bars`; the
renderer reads `stem_lanes`. Any
other value with no JSON form (a numpy array, an object) makes `to_json` raise
`ScriptJsonError` naming the key, rather than drop it. `$type` is reserved as a meta key.
