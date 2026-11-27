"""Identity of a concrete transition render with verified full-mix sources."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping

from selecta.config import SAMPLE_RATE
from selecta.render.script import TransitionScript
from selecta.render.script_json import ScriptJsonError, to_dict
from selecta.seam_kinds import RENDER_VERSION


def concrete_render_key(
    script: TransitionScript,
    verified_sources: Mapping[int | str, str],
    *,
    runtime_version: str,
) -> str | None:
    """Key one render attempt after planning, with workspace IDs replaced by verified hashes.

    The caller supplies verified originals and a runtime version covering decoder and DSP
    dependencies. The initial scope is full mixes. Stem and alternate-file paths need explicit
    content identity for their resolved audio before they can share.
    """
    parts = [script.a, script.b, *script.extras]
    source_hashes = []
    for part in parts:
        source = part.source
        digest = verified_sources.get(source.song)
        if part.source_path or source.role != "mix" or not digest:
            return None
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            return None
        source_hashes.append(digest)

    try:
        spec = to_dict(script)
    except ScriptJsonError:
        return None
    serialized_parts = [spec["a"], spec["b"], *spec["extras"]]
    for part, digest in zip(serialized_parts, source_hashes, strict=True):
        part["source"]["song"] = digest

    payload = {
        "key_version": 1,
        "render_version": RENDER_VERSION,
        "runtime_version": runtime_version,
        "sample_rate": SAMPLE_RATE,
        "script": spec,
    }
    encoded = json.dumps(payload, allow_nan=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
