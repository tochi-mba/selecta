"""TransitionScript as JSON, so a cloud worker or the member's browser can render the same script.

The JSON never carries audio or file paths. Each part names its audio with a source reference
(`render.sources.SourceRef`) and carries only the song facts the renderer reads, today the loudness
gain. Floats are written with Python's shortest exact repr, so a script read back renders the
same samples. See docs/engineering/transition-script-json.md.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from selecta.config import ANALYSIS_VERSION
from selecta.render.script import Curve, Echo, Part, TransitionScript, Warp, Wash
from selecta.render.sources import SongFacts, SourceRef

SCHEMA_VERSION = 1
_CURVES = ("gain", "low", "mid", "high")
_OPTIONAL_CURVES = ("highpass", "lowpass", "echo_send", "wash_send")
_TAG = "$type"


class ScriptJsonError(ValueError):
    """A script that can't be written as JSON, or JSON that isn't a script this code reads."""


def _number(value: float) -> float | dict:
    value = float(value)
    if math.isfinite(value):
        return value
    return {_TAG: "float", "value": repr(value)}


def _read_number(value: Any) -> float:
    if isinstance(value, dict) and value.get(_TAG) == "float":
        return float(value["value"])
    return float(value)


def _curve(curve: Curve) -> list[list]:
    return [[_number(t), _number(v)] for t, v in zip(curve.times, curve.values, strict=True)]


def _read_curve(points: list) -> Curve:
    return Curve([(_read_number(t), _read_number(v)) for t, v in points])


def _warp(warp: Warp) -> dict:
    return {
        "output": [_number(t) for t in warp.output],
        "source": [_number(t) for t in warp.source],
    }


def _read_warp(data: dict) -> Warp:
    output = np.array([_read_number(t) for t in data["output"]], dtype=np.float64)
    source = np.array([_read_number(t) for t in data["source"]], dtype=np.float64)
    return Warp(output, source)


def _optional(value: float | None) -> float | dict | None:
    return None if value is None else _number(value)


def _part(part: Part) -> dict:
    if part.source_path and not part.stem:
        # a stem file nobody named; guessing from its file name would be worse than stopping
        raise ScriptJsonError(f"a part of song {part.song.id} plays a file with no stem name")
    data: dict[str, Any] = {
        "source": part.source.to_json(),
        "window_origin": _number(part.window_origin),
        "facts": {"gain_db": _number(part.song.gain_db)},
        "warp": _warp(part.warp),
    }
    for name in _CURVES:
        data[name] = _curve(getattr(part, name))
    for name in _OPTIONAL_CURVES:
        curve = getattr(part, name)
        data[name] = None if curve is None else _curve(curve)
    data["echo"] = (
        None
        if part.echo is None
        else {key: _number(value) for key, value in vars(part.echo).items()}
    )
    data["wash"] = (
        None
        if part.wash is None
        else {key: _number(value) for key, value in vars(part.wash).items()}
    )
    data["render_from"] = _optional(part.render_from)
    data["render_until"] = _optional(part.render_until)
    data["follows_b"] = bool(part.follows_b)
    return data


def _read_part(data: dict, facts_version: int) -> Part:
    ref = SourceRef.from_json(data["source"])
    facts = SongFacts(ref.song, _read_number(data["facts"]["gain_db"]), facts_version)
    moves: dict[str, Any] = {name: _read_curve(data[name]) for name in _CURVES}
    for name in _OPTIONAL_CURVES:
        moves[name] = None if data.get(name) is None else _read_curve(data[name])
    if data.get("echo") is not None:
        moves["echo"] = Echo(**{k: _read_number(v) for k, v in data["echo"].items()})
    if data.get("wash") is not None:
        moves["wash"] = Wash(**{k: _read_number(v) for k, v in data["wash"].items()})
    for name in ("render_from", "render_until"):
        moves[name] = None if data.get(name) is None else _read_number(data[name])
    moves["window_origin"] = _read_number(data["window_origin"])
    moves["follows_b"] = bool(data.get("follows_b", False))
    return Part.from_source(ref, facts, _read_warp(data["warp"]), **moves)


def _meta(value: Any, where: str) -> Any:
    """One meta value as JSON. Each non-JSON kind has its own tag; anything else stops here."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return _number(value)
    if isinstance(value, Curve):
        return {_TAG: "curve", "points": _curve(value)}
    if isinstance(value, (list, tuple)):
        return [_meta(item, f"{where}[{i}]") for i, item in enumerate(value)]
    if isinstance(value, dict):
        if _TAG in value:
            raise ScriptJsonError(f"meta {where} uses the reserved key {_TAG}")
        out = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ScriptJsonError(f"meta {where} has a key that isn't text: {key!r}")
            out[key] = _meta(item, f"{where}.{key}")
        return out
    raise ScriptJsonError(f"meta {where} holds a {type(value).__name__}, which has no JSON form")


def _read_meta(value: Any) -> Any:
    if isinstance(value, list):
        return [_read_meta(item) for item in value]
    if isinstance(value, dict):
        tag = value.get(_TAG)
        if tag == "curve":
            return _read_curve(value["points"])
        if tag == "float":
            return _read_number(value)
        if tag is not None:
            raise ScriptJsonError(f"unknown meta type {tag!r}")
        return {key: _read_meta(item) for key, item in value.items()}
    return value


def to_dict(script: TransitionScript) -> dict:
    """The script as plain JSON data."""
    return {
        "schema": SCHEMA_VERSION,
        "facts_version": ANALYSIS_VERSION,
        "style": script.style,
        "duration": _number(script.duration),
        "overlap": [_number(script.overlap[0]), _number(script.overlap[1])],
        "expects_beats_aligned": bool(script.expects_beats_aligned),
        "quiet_allowed": _number(script.quiet_allowed),
        "a": _part(script.a),
        "b": _part(script.b),
        "extras": [_part(extra) for extra in script.extras],
        "meta": {key: _meta(value, key) for key, value in script.meta.items()},
    }


def from_dict(data: dict) -> TransitionScript:
    if data.get("schema") != SCHEMA_VERSION:
        raise ScriptJsonError(f"script schema {data.get('schema')!r} isn't {SCHEMA_VERSION}")
    version = int(data["facts_version"])
    meta = _read_meta(data.get("meta") or {})
    return TransitionScript(
        style=str(data["style"]),
        duration=_read_number(data["duration"]),
        a=_read_part(data["a"], version),
        b=_read_part(data["b"], version),
        overlap=(_read_number(data["overlap"][0]), _read_number(data["overlap"][1])),
        expects_beats_aligned=bool(data.get("expects_beats_aligned", False)),
        quiet_allowed=_read_number(data.get("quiet_allowed", 0.0)),
        extras=[_read_part(extra, version) for extra in data.get("extras") or []],
        meta=meta,
    )


def to_json(script: TransitionScript) -> str:
    return json.dumps(to_dict(script), allow_nan=False, separators=(",", ":"))


def from_json(text: str) -> TransitionScript:
    return from_dict(json.loads(text))
