"""From what someone says to typed, enforceable rules (ADR-0321, ADR-0324, LU-319-01).

Every rule is a `Constraint` with a kind, a target, a value, a strength (hard rules are validators
and are never relaxed silently; soft ones only steer ranking), where it came from, the turn that
made it, which older rule it supersedes, and its status. The latest specific instruction replaces
only the older rule of the same kind and target, never unrelated ones.

The same grammar serves every provider: a model may hand Lucy constraints as structured tool
input, and the built-in provider reads them from text with these patterns. Nothing here invents a
fact: a name that isn't resolved against the library stays a name, and an unknown stays unknown.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from selecta.lucy.ids import new_id

HARD_KINDS = {
    "ready_only",
    "count",
    "exclude_artist",
    "exclude_song",
    "include_song",
    "start_with",
    "end_with",
    "family_only",
    "tempo_range",
    "max_duration",
}
SOFT_KINDS = {
    "prefer_ready",
    "duration",
    "include_artist",
    "family",
    "energy_arc",
    "tempo_near",
    "era",
    "familiarity",
    "mix_style",
}
KINDS = HARD_KINDS | SOFT_KINDS

EXCLUSIVE_GROUPS = {
    "readiness": {"ready_only", "prefer_ready"},
    "length": {"count"},
    "time": {"duration", "max_duration"},
    "opening": {"start_with"},
    "destination": {"end_with"},
    "arc": {"energy_arc"},
    "tempo": {"tempo_range", "tempo_near"},
    "style": {"mix_style"},
    "familiarity": {"familiarity"},
}
"""Kinds where a newer rule replaces any older one, whatever its target."""

FAMILIES = {
    "afro": ("afrobeats", "afrobeat", "afro", "amapiano", "afropop", "afro beats"),
    "dance": ("house", "dance", "edm", "techno", "electronic", "garage", "club"),
    "hiphop": ("hip-hop", "hip hop", "hiphop", "rap", "trap", "drill"),
    "latin": ("latin", "reggaeton", "salsa", "bachata", "dembow"),
    "pop": ("pop",),
    "rnb": ("r&b", "rnb", "r and b", "soul", "neo-soul"),
    "rock": ("rock", "indie", "alternative", "punk"),
}

ARCS = {
    "slow_burn": ("slow burn", "build up", "build it up", "builds up", "warm up", "warm-up"),
    "lift_off": ("lift off", "peak", "big finish", "end on a high", "ramp up", "go hard"),
    "cool_down": ("cool down", "wind down", "come down", "chill out", "end calm", "mellow out"),
    "no_dips": ("no dips", "keep it high", "high energy throughout", "nonstop energy"),
    "steady_low": ("chill", "laid back", "low energy", "relaxed", "calm"),
}

STYLES = {
    "seamless": ("seamless", "smooth", "smoother", "blend", "blends", "beatmatched"),
    "punchy": ("punchy", "quick cuts", "fast transitions", "snappy"),
    "wordplay": ("wordplay", "word links", "word play", "lyric links"),
}

NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "a dozen": 12, "dozen": 12,
    "fifteen": 15, "twenty": 20, "thirty": 30, "a couple": 2, "couple": 2, "a few": 3,
}

READY_ONLY = re.compile(
    r"\b(only|just|strictly|purely)\b[^.?!]{0,40}\b(already|ready|rendered|cached|prepared)\b"
    r"|\bready[- ]only\b|\bno (new )?render(s|ing)?\b|\bnothing (new )?to render\b"
    r"|\bwithout (any )?(new )?render(s|ing)?\b|\bdon'?t render\b|\bno waiting\b"
    r"|\bplay(able)? (right )?now without waiting\b|\balready[- ]rendered transitions only\b",
    re.I,
)
PREFER_READY = re.compile(
    r"\b(prefer|ideally|mostly|where possible|if possible)\b[^.?!]{0,40}\b(ready|rendered)\b",
    re.I,
)
RELAX_READY = re.compile(
    r"\b(you can|it'?s ok(ay)? to|feel free to|allow|go ahead and)\b[^.?!]{0,20}\b"
    r"(render|make new)\b|\bdrop the ready[- ]only\b|\bforget (the )?ready[- ]only\b",
    re.I,
)
COUNT = re.compile(
    r"\b(\d{1,3}|" + "|".join(sorted(map(re.escape, NUMBERS), key=len, reverse=True))
    + r")\s+(songs?|tracks?|tunes|records)\b",
    re.I,
)
DURATION = re.compile(
    r"\b(an?|half an|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b(?!\w)", re.I
)
UNDER_DURATION = re.compile(r"\b(under|less than|at most|no more than|max(imum)?)\s+$", re.I)
TEMPO_RANGE = re.compile(r"\b(?:between\s+)?(\d{2,3})\s*(?:-|to|and)\s*(\d{2,3})\s*bpm\b", re.I)
TEMPO_NEAR = re.compile(r"\b(?:around|about|near|roughly|~)\s*(\d{2,3})\s*bpm\b", re.I)
TEMPO_BOUND = re.compile(r"\b(under|below|over|above|faster than|slower than)\s+(\d{2,3})\s*bpm",
                         re.I)
ERA = re.compile(r"\b(?:19|20)?(\d0)'?s\b|\bthrowbacks?\b|\bnew (stuff|music|songs)\b", re.I)
NAME_STOP = r"(?=$|[.,;!?]| and | but | then | with | please| for | in the | at the | only)"
EXCLUDE = re.compile(
    r"\b(?:no|without|never|not|skip|avoid|exclude)\s+(?:any\s+)?(.+?)" + NAME_STOP, re.I
)
INCLUDE = re.compile(
    r"\b(must (?:include|have)|make sure (?:to )?(?:include|play)|include|add|"
    r"some|a bit of|with)\s+(.+?)" + NAME_STOP,
    re.I,
)
START = re.compile(r"\b(?:start|open|begin|kick off)\s+(?:it\s+)?(?:with|on)\s+(.+?)" + NAME_STOP,
                   re.I)
END = re.compile(
    r"\b(?:end|finish|close|land|wrap up)\s+(?:it\s+)?(?:with|on)\s+(.+?)" + NAME_STOP, re.I
)
FAMILIARITY = re.compile(
    r"\b(my (favou?rites|faves|most played)|songs i love|what i play most)\b"
    r"|\b(something new|deep cuts|songs i (never|rarely) play|discover)\b",
    re.I,
)
QUESTION = re.compile(
    r"^\s*(what|why|how|which|who|when|where|is|are|does|do|did|can you (tell|explain)|"
    r"explain|tell me|show me why)\b|\?\s*$",
    re.I,
)
MAKE = re.compile(
    r"\b(make|build|create|plan|put together|give me|i want|i'?d like|let'?s|mix me|improve|"
    r"need a|can you (make|do|build|put)|another|try again|redo|again)\b",
    re.I,
)
APPROVE = re.compile(r"\b(approve|build (it|the draft)|save (it|this)|ship it|commit)\b", re.I)
REMEMBER = re.compile(r"\bremember (that )?(.+)$", re.I)
FORGET = re.compile(r"\bforget (that |about )?(.+)$", re.I)
GENERIC_WORDS = {
    "songs", "song", "tracks", "track", "music", "repeats", "repeat", "rendering", "renders",
    "waiting", "skips", "breaks", "gaps", "silence", "slow songs", "ballads", "one", "it", "that",
    "this", "them", "more", "less", "new renders", "new transitions", "transitions",
}


@dataclass(frozen=True)
class Constraint:
    kind: str
    target: str
    value: Any
    strength: str
    source: str = "user"
    scope: str = "proposal"
    created_turn: str | None = None
    supersedes: str | None = None
    status: str = "active"
    text: str = ""
    id: str = field(default_factory=lambda: new_id("rule"))

    def as_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict) -> Constraint:
        known = {name for name in Constraint.__dataclass_fields__}
        return Constraint(**{key: value for key, value in data.items() if key in known})


def _rule(kind: str, target: str, value: Any, text: str, turn: str | None,
          strength: str | None = None) -> Constraint:
    if kind not in KINDS:
        raise ValueError(kind)
    chosen = strength or ("hard" if kind in HARD_KINDS else "soft")
    return Constraint(kind, target.casefold().strip(), value, chosen, created_turn=turn, text=text)


def _number(word: str) -> int | None:
    word = word.strip().casefold()
    if word.isdigit():
        return int(word)
    return NUMBERS.get(word)


def _minutes(amount: str, unit: str) -> float:
    amount = amount.casefold()
    value = 0.5 if amount == "half an" else 1.0 if amount in {"a", "an"} else float(amount)
    return value * 60 if unit.casefold().startswith("h") else value


def _family_of(text: str) -> str | None:
    lowered = f" {text.casefold()} "
    for family, words in FAMILIES.items():
        if any(re.search(rf"(?<![\w-]){re.escape(word)}(?![\w-])", lowered) for word in words):
            return family
    return None


def _clean_name(raw: str) -> str | None:
    name = raw.strip(" \"'“”‘’").strip()
    name = re.sub(
        r"^(the song|the track|songs? by|tracks? by|anything by|music by|some|a bit of|"
        r"a little|more|any)\s+",
        "",
        name,
        flags=re.I,
    )
    if not name or name.casefold() in GENERIC_WORDS or len(name) > 80:
        return None
    return name


def parse(text: str, turn: str | None = None) -> list[Constraint]:
    """Every rule a message states. Phrases it can't read are left alone, not guessed at."""
    found: list[Constraint] = []
    lowered = text.casefold()
    if RELAX_READY.search(text):
        found.append(_rule("prefer_ready", "", True, "allow new renders", turn))
    elif READY_ONLY.search(text):
        found.append(_rule("ready_only", "", True, READY_ONLY.search(text).group(0), turn))
    elif PREFER_READY.search(text):
        found.append(_rule("prefer_ready", "", True, PREFER_READY.search(text).group(0), turn))
    for match in COUNT.finditer(text):
        count = _number(match.group(1))
        if count is not None and 1 <= count <= 100:
            found.append(_rule("count", "", count, match.group(0), turn))
    for match in DURATION.finditer(text):
        minutes = _minutes(match.group(1), match.group(2))
        if 5 <= minutes <= 600:
            bounded = UNDER_DURATION.search(text[: match.start()])
            kind = "max_duration" if bounded else "duration"
            found.append(_rule(kind, "", minutes, match.group(0), turn))
    if (match := TEMPO_RANGE.search(text)) is not None:
        low, high = sorted((float(match.group(1)), float(match.group(2))))
        found.append(_rule("tempo_range", "", [low, high], match.group(0), turn))
    elif (match := TEMPO_BOUND.search(text)) is not None:
        bound = float(match.group(2))
        upper = match.group(1).casefold() in {"under", "below", "slower than"}
        found.append(
            _rule("tempo_range", "", [40.0, bound] if upper else [bound, 240.0], match.group(0),
                  turn)
        )
    elif (match := TEMPO_NEAR.search(text)) is not None:
        found.append(_rule("tempo_near", "", float(match.group(1)), match.group(0), turn))
    family = _family_of(text)
    if family is not None:
        strict = re.search(r"\b(only|just|all|strictly|purely|nothing but)\b", lowered)
        kind = "family_only" if strict else "family"
        found.append(_rule(kind, family, family, family, turn))
    for arc, words in ARCS.items():
        if any(word in lowered for word in words):
            found.append(_rule("energy_arc", "", arc, arc, turn))
            break
    for style, words in STYLES.items():
        if any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in words):
            found.append(_rule("mix_style", "", style, style, turn))
            break
    if (match := ERA.search(text)) is not None:
        if match.group(1):
            decade = int(match.group(1))
            start = (1900 if decade >= 30 else 2000) + decade
            found.append(_rule("era", "", [start, start + 9], match.group(0), turn))
        elif "throwback" in match.group(0).casefold():
            found.append(_rule("era", "", "throwbacks", match.group(0), turn))
        else:
            found.append(_rule("era", "", "recent", match.group(0), turn))
    if (match := FAMILIARITY.search(text)) is not None:
        loves = match.group(1) is not None
        found.append(_rule("familiarity", "", "favourites" if loves else "discovery",
                           match.group(0), turn))
    for match in START.finditer(text):
        if (name := _clean_name(match.group(1))) is not None:
            found.append(_rule("start_with", "", name, match.group(0), turn))
    for match in END.finditer(text):
        if (name := _clean_name(match.group(1))) is not None:
            found.append(_rule("end_with", "", name, match.group(0), turn))
    taken = {rule.value for rule in found if rule.kind in {"start_with", "end_with"}}
    for match in EXCLUDE.finditer(text):
        name = _clean_name(match.group(1))
        if name is None or _family_of(name) or READY_ONLY.search(match.group(0)):
            continue
        found.append(_rule("exclude_artist", name, name, match.group(0), turn))
    for match in INCLUDE.finditer(text):
        name = _clean_name(match.group(2))
        if name is None or name in taken or _family_of(name) or COUNT.search(name):
            continue
        hard = match.group(1).casefold().startswith(("must", "make sure"))
        if hard:
            found.append(_rule("include_song", name, name, match.group(0), turn))
        else:
            found.append(_rule("include_artist", name, name, match.group(0), turn))
    return found


def classify(text: str, has_proposal: bool) -> str:
    """What kind of turn this is: a question never builds or revises anything (LU-300-05)."""
    if REMEMBER.search(text) and not MAKE.search(text):
        return "remember"
    if FORGET.search(text) and "ready" not in text.casefold():
        return "forget"
    if APPROVE.search(text):
        return "approve"
    rules = parse(text)
    edits = critique_ops(text)
    if QUESTION.search(text) and not MAKE.search(text) and not edits:
        return "question"
    if MAKE.search(text) and not edits and (not has_proposal or rules or "another" in
                                            text.casefold() or "new" in text.casefold()):
        return "plan"
    if edits or (has_proposal and rules):
        return "revise"
    if rules or MAKE.search(text):
        return "plan"
    return "question" if has_proposal else "chat"


def merge(existing: list[Constraint], incoming: list[Constraint]) -> list[Constraint]:
    """Apply newer rules. Each replaces only what it contradicts or restates (LU-321-03)."""
    merged = list(existing)
    for rule in incoming:
        group = next((kinds for kinds in EXCLUSIVE_GROUPS.values() if rule.kind in kinds), None)
        for index, old in enumerate(merged):
            if old.status != "active":
                continue
            same_slot = (
                (group is not None and old.kind in group)
                or (old.kind == rule.kind and old.target == rule.target)
                or (
                    {old.kind, rule.kind} <= {"exclude_artist", "include_artist", "include_song"}
                    and old.target == rule.target
                )
                or ({old.kind, rule.kind} == {"family", "family_only"})
            )
            if same_slot:
                merged[index] = replace(old, status="superseded")
                rule = replace(rule, supersedes=old.id)
        merged.append(rule)
    return merged


def active(rules: list[Constraint]) -> list[Constraint]:
    return [rule for rule in rules if rule.status == "active"]


def remove(rules: list[Constraint], rule_id: str) -> list[Constraint]:
    """The person removed or relaxed one rule; nothing else changes (LU-321-07)."""
    return [replace(rule, status="removed") if rule.id == rule_id else rule for rule in rules]


def contradictions(rules: list[Constraint]) -> list[dict]:
    """Demands that can't all hold. Reported, never silently resolved (LU-321-05)."""
    live = active(rules)
    problems: list[dict] = []
    excluded = {rule.target for rule in live if rule.kind == "exclude_artist"}
    for rule in live:
        if rule.kind in {"include_artist", "include_song", "start_with", "end_with"}:
            if str(rule.value).casefold() in excluded:
                problems.append({
                    "rules": [rule.id],
                    "text": f"“{rule.value}” is both wanted and ruled out.",
                })
    counts = [rule for rule in live if rule.kind == "count"]
    starts = [rule for rule in live if rule.kind == "start_with"]
    ends = [rule for rule in live if rule.kind == "end_with"]
    if counts and starts and ends:
        if counts[0].value == 1 and starts[0].value.casefold() != ends[0].value.casefold():
            problems.append({
                "rules": [counts[0].id, starts[0].id, ends[0].id],
                "text": "One song can't both start and end on different songs.",
            })
    if counts and starts and ends and counts[0].value > 1:
        if starts[0].value.casefold() == ends[0].value.casefold():
            problems.append({
                "rules": [starts[0].id, ends[0].id],
                "text": "A mix can't start and end on the same song without repeating it.",
            })
    includes = [rule for rule in live if rule.kind == "include_song"]
    if counts and len(includes) > counts[0].value:
        problems.append({
            "rules": [counts[0].id, *(rule.id for rule in includes)],
            "text": f"{len(includes)} songs must be in it, but it only has {counts[0].value}.",
        })
    tempo = next((rule for rule in live if rule.kind == "tempo_range"), None)
    if tempo is not None and tempo.value[0] > tempo.value[1]:
        problems.append({"rules": [tempo.id], "text": "That tempo range is empty."})
    return problems


def describe(rule: Constraint) -> str:
    """Plain words for a rule, without music jargon (LU-309-05)."""
    value = rule.value
    match rule.kind:
        case "ready_only":
            return "Only transitions that are already ready to play"
        case "prefer_ready":
            return "Prefer transitions that are already ready"
        case "count":
            return f"{value} songs"
        case "duration":
            return f"About {round(value)} minutes"
        case "max_duration":
            return f"At most {round(value)} minutes"
        case "exclude_artist":
            return f"No {value}"
        case "exclude_song":
            return f"Leave out “{value}”"
        case "include_artist":
            return f"Some {value}"
        case "include_song":
            return f"Must include {value}"
        case "start_with":
            return f"Start with {value}"
        case "end_with":
            return f"End with {value}"
        case "family_only":
            return f"Only {value}"
        case "family":
            return f"Lean {value}"
        case "tempo_range":
            return f"{round(value[0])}–{round(value[1])} BPM"
        case "tempo_near":
            return f"Around {round(value)} BPM"
        case "energy_arc":
            return {
                "slow_burn": "Build up slowly",
                "lift_off": "Build to a big finish",
                "cool_down": "Wind down",
                "no_dips": "Keep the energy up",
                "steady_low": "Keep it calm",
            }.get(value, str(value))
        case "era":
            return f"{value[0]}s" if isinstance(value, list) else str(value).capitalize()
        case "familiarity":
            return "Songs you play most" if value == "favourites" else "Songs you rarely play"
        case "mix_style":
            return {"seamless": "Smooth blends", "punchy": "Quick, punchy changes",
                    "wordplay": "Word links"}.get(value, str(value))
    return str(value)


CRITIQUE_PATTERNS = (
    ("remove", re.compile(r"\b(remove|drop|take out|cut|get rid of|lose)\s+(.+?)" + NAME_STOP,
                          re.I)),
    ("replace", re.compile(r"\b(swap|replace|change|switch)\s+(.+?)(?:\s+(?:for|with)\s+(.+?))?"
                           + NAME_STOP, re.I)),
    ("move_earlier", re.compile(r"\bmove\s+(.+?)\s+(earlier|up|to the (start|beginning|front))"
                                , re.I)),
    ("move_later", re.compile(r"\bmove\s+(.+?)\s+(later|down|to the (end|back))", re.I)),
    ("lock", re.compile(r"\b(keep|lock)\s+(.+?)(?:\s+where it is|\s+in place)?" + NAME_STOP, re.I)),
    ("unlock", re.compile(r"\bunlock\s+(.+?)" + NAME_STOP, re.I)),
    ("more_songs", re.compile(r"\b(add|another)\s+(\w+)?\s*(more )?(songs?|tracks?)\b", re.I)),
    ("fewer_songs", re.compile(r"\b(shorter|fewer songs|less songs|cut it down)\b", re.I)),
    ("longer", re.compile(r"\b(longer|more songs)\b", re.I)),
)


def critique_ops(text: str) -> list[dict]:
    """Structured edits against the current revision; resolved to exact occurrences later."""
    ops: list[dict] = []
    for kind, pattern in CRITIQUE_PATTERNS:
        for match in pattern.finditer(text):
            if kind == "remove":
                ops.append({"op": "remove", "target": match.group(2).strip()})
            elif kind == "replace":
                ops.append({
                    "op": "replace",
                    "target": match.group(2).strip(),
                    "with": (match.group(3) or "").strip() or None,
                })
            elif kind in {"move_earlier", "move_later"}:
                to_edge = bool(match.group(3))
                ops.append({
                    "op": "move",
                    "target": match.group(1).strip(),
                    "direction": "earlier" if kind == "move_earlier" else "later",
                    "to_edge": to_edge,
                })
            elif kind == "lock":
                target = match.group(2).strip()
                if target.casefold() in {"it", "the energy up", "going", "it going"}:
                    continue
                ops.append({"op": "lock", "target": target})
            elif kind == "unlock":
                ops.append({"op": "unlock", "target": match.group(1).strip()})
            elif kind == "more_songs":
                ops.append({"op": "grow", "by": _number(match.group(2) or "") or 1})
            elif kind == "fewer_songs":
                ops.append({"op": "shrink", "by": 2})
            elif kind == "longer" and not any(item["op"] == "grow" for item in ops):
                # "add two more songs" already said how many; don't grow twice
                ops.append({"op": "grow", "by": 2})
    return ops
