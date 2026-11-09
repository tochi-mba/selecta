"""Feature flags: one registry for every feature, read by the server, the site, the CLI and tests.

Every feature is listed in the JSON files beside this one, one file per area, with what it is,
what it needs, and the routes, CLI commands and places in the site it owns. The site imports the
same files, so a flag's name can't drift between the two.

Flags are for developers. A build's defaults are the JSON files; `SELECTA_FLAGS` changes them for
one run, for example `SELECTA_FLAGS="-requests -move.*"` or `SELECTA_FLAGS=minimal`. It's read once
per process, so changing a flag means restarting Selecta. Child processes inherit the variable, so
the seam worker and every helper see the same flags as the server that started them.

Core flags are always on: they're listed so the catalog is complete, with the reason they can't be
turned off. A core flag is core where it exists: `modes` says where, so a
cloud-only core flag (account deletion, Stripe webhooks) can never be switched off in the cloud
and simply has nothing to do on the local app. A flag that needs one that's off is off too.
Turning a flag off never deletes anything: it stops the feature being offered, and stops the
work it would do.

Selecta Cloud (ADR-0414) adds optional fields that only the cloud reads, so leaving them out keeps
today's behaviour: `scope` says which id a percentage rollout hashes, `modes` says which runtime
modes the feature makes sense in, `when_off` says whether running work drains or stops, and
`when_locked` says whether a feature the plan doesn't include is hidden or shown as a teaser.
`kind`, `owner` and `review_by` say what sort of flag it is, who looks after it and when a
temporary one should be cleaned up; a `beta` flag is only on for people who switch it on
themselves. The targeting that reads them is in `flags/targeting.py`.
"""

from __future__ import annotations

import datetime as dt
import difflib
import json
import os
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

ENV = "SELECTA_FLAGS"
HERE = Path(__file__).parent
AREAS = (
    "core",
    "listen",
    "mixes",
    "lucy",
    "mymixes",
    "editor",
    "moves",
    "requests",
    "discover",
    "library",
    "learning",
    "workspace",
    "app",
    "tools",
    "cloud",
)

# Places in the site a flag can show up. The browser sweep opens each one with that flag off.
SURFACES = frozenset(
    {
        "listen",
        "stage",
        "mixes",
        "mine",
        "edit",
        "library",
        "discover.words",
        "discover.harmonic",
        "lucy",
        "listening",
        "workshop",
        "workshop.analysis",
        "workshop.sources",
        "workshop.storage",
        "workshop.learning",
        "workshop.diagnostics",
        "overlay.requests",
        "overlay.palette",
        "overlay.help",
        "overlay.activity",
        "overlay.glossary",
        "overlay.inspector",
        "overlay.studio",
        "overlay.export",
        "overlay.shaping",
        "overlay.song_details",
    }
)

FIELDS = {
    "label",
    "about",
    "core",
    "default",
    "requires",
    "routes",
    "surfaces",
    "words",
    "cli",
    "scope",
    "modes",
    "when_off",
    "when_locked",
    "kind",
    "owner",
    "review_by",
}

# The cloud-only fields and the values each may take. The first value is the default.
SCOPES = ("global", "workspace", "user", "guest")
MODES = ("local", "cloud")
WHEN_OFF = ("drain", "stop")
WHEN_LOCKED = ("hide", "teaser")
# A `beta` flag is one people switch on for themselves in the cloud (a "Labs" setting).
KINDS = ("release", "ops", "experiment", "beta")
FLAG_ID = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$")
ROUTE = re.compile(r"^(GET|POST|PUT|PATCH|DELETE) /api/\S+$")
PRESETS = {"minimal": False, "all": True}


class FlagError(ValueError):
    """A flag setting that can't be honoured, said in a way a developer can act on."""


class FlagOff(RuntimeError):
    """Something asked for a feature that's turned off in this build."""

    def __init__(self, flag: Flag) -> None:
        self.flag = flag
        super().__init__(f"{flag.label} is turned off in this build.")


@dataclass(frozen=True)
class Flag:
    id: str
    area: str
    label: str
    about: str
    core: str | None = None
    default: bool = True
    requires: tuple[str, ...] = ()
    routes: tuple[str, ...] = ()
    surfaces: tuple[str, ...] = ()
    words: tuple[str, ...] = ()
    cli: tuple[str, ...] = ()
    scope: str = SCOPES[0]
    modes: tuple[str, ...] = MODES
    when_off: str = WHEN_OFF[0]
    when_locked: str = WHEN_LOCKED[0]
    kind: str = KINDS[0]
    owner: str | None = None
    review_by: str | None = None


@dataclass(frozen=True)
class State:
    on: bool
    # "core", "default", "off by default", "SELECTA_FLAGS", or "needs <flag>"
    why: str


@cache
def registry() -> dict[str, Flag]:
    """Every flag, in the order the area files list them."""
    flags: dict[str, Flag] = {}
    for area in AREAS:
        data = json.loads((HERE / f"{area}.json").read_text("utf-8"))
        for flag_id, spec in data["flags"].items():
            unknown = set(spec) - FIELDS
            if unknown:
                raise FlagError(f"{flag_id} in {area}.json has unknown fields: {sorted(unknown)}")
            if flag_id in flags:
                raise FlagError(f"{flag_id} is listed twice.")
            flags[flag_id] = Flag(
                id=flag_id,
                area=data["area"],
                label=spec["label"],
                about=spec["about"],
                core=spec.get("core"),
                default=bool(spec.get("default", True)),
                requires=tuple(spec.get("requires", ())),
                routes=tuple(spec.get("routes", ())),
                surfaces=tuple(spec.get("surfaces", ())),
                words=tuple(spec.get("words", ())),
                cli=tuple(spec.get("cli", ())),
                scope=spec.get("scope", SCOPES[0]),
                modes=tuple(spec.get("modes", MODES)),
                when_off=spec.get("when_off", WHEN_OFF[0]),
                when_locked=spec.get("when_locked", WHEN_LOCKED[0]),
                kind=spec.get("kind", KINDS[0]),
                owner=spec.get("owner"),
                review_by=spec.get("review_by"),
            )
    return flags


def problems(flags: dict[str, Flag] | None = None) -> list[str]:
    """Everything wrong with the registry, so a test can say all of it at once."""
    flags = registry() if flags is None else flags
    found: list[str] = []
    routes: dict[str, str] = {}
    for flag in flags.values():
        if not FLAG_ID.match(flag.id):
            found.append(f"{flag.id}: ids are lower case words joined by dots")
        if not flag.label.strip() or not flag.about.strip():
            found.append(f"{flag.id}: needs a label and an about")
        for need in flag.requires:
            if need not in flags:
                found.append(f"{flag.id}: requires {need}, which isn't a flag")
            elif flag.core and not flags[need].core:
                found.append(f"{flag.id}: a core flag can't need {need}, which can be turned off")
        if flag.core and not flag.default:
            found.append(f"{flag.id}: a core flag can't be off by default")
        for route in flag.routes:
            if not ROUTE.match(route):
                found.append(f"{flag.id}: {route!r} should look like 'GET /api/path'")
            elif route in routes:
                found.append(f"{route} belongs to both {routes[route]} and {flag.id}")
            routes[route] = flag.id
        for surface in flag.surfaces:
            if surface not in SURFACES:
                found.append(f"{flag.id}: {surface} isn't a known surface")
        found += _cloud_problems(flag)
    for flag in flags.values():
        cycle = _cycle(flags, flag.id)
        if cycle:
            found.append("requires go round in a circle: " + " -> ".join(cycle))
    return found


def _cloud_problems(flag: Flag) -> list[str]:
    """What's wrong with the fields only the cloud reads."""
    found: list[str] = []
    for field, allowed in (
        ("scope", SCOPES),
        ("when_off", WHEN_OFF),
        ("when_locked", WHEN_LOCKED),
        ("kind", KINDS),
    ):
        value = getattr(flag, field)
        if value not in allowed:
            found.append(f"{flag.id}: {field} is {value!r}; it can be {', '.join(allowed)}")
    if not flag.modes:
        found.append(f"{flag.id}: modes can't be empty; leave it out to mean every mode")
    for mode in flag.modes:
        if mode not in MODES:
            found.append(f"{flag.id}: {mode!r} isn't a mode; modes are {', '.join(MODES)}")
    if len(set(flag.modes)) != len(flag.modes):
        found.append(f"{flag.id}: modes lists the same mode twice")
    if flag.owner is not None and (not isinstance(flag.owner, str) or not flag.owner.strip()):
        found.append(f"{flag.id}: owner should be a name, or left out")
    if flag.review_by is not None:
        try:
            dt.date.fromisoformat(str(flag.review_by))
        except ValueError:
            found.append(f"{flag.id}: review_by {flag.review_by!r} isn't a date like 2027-01-31")
    return found


def overdue(today: dt.date | None = None, flags: dict[str, Flag] | None = None) -> list[str]:
    """Flags whose `review_by` date has passed. CI warns about these rather than failing, so a
    temporary rollout flag gets cleaned up instead of piling up."""
    flags = registry() if flags is None else flags
    today = dt.date.today() if today is None else today
    late: list[str] = []
    for flag in flags.values():
        if flag.review_by is None:
            continue
        try:
            due = dt.date.fromisoformat(str(flag.review_by))
        except ValueError:
            continue
        if due < today:
            late.append(f"{flag.id}: was due for review on {due.isoformat()}")
    return late


def _cycle(flags: dict[str, Flag], start: str) -> list[str] | None:
    def walk(flag_id: str, path: tuple[str, ...]) -> list[str] | None:
        for need in flags[flag_id].requires:
            if need == start:
                return [*path, need]
            if need in flags and need not in path:
                found = walk(need, (*path, need))
                if found:
                    return found
        return None

    return walk(start, (start,))


def _unknown(name: str, flags: dict[str, Flag]) -> FlagError:
    close = difflib.get_close_matches(name, list(flags), n=3)
    hint = f" Did you mean {', '.join(close)}?" if close else " `selecta flags` lists them all."
    return FlagError(f"{ENV} names {name!r}, which isn't a flag.{hint}")


def parse(text: str, flags: dict[str, Flag] | None = None) -> dict[str, bool]:
    """What `SELECTA_FLAGS` asks for, read left to right, so `minimal +lucy` works."""
    flags = registry() if flags is None else flags
    asked: dict[str, bool] = {}
    for token in re.split(r"[\s,]+", text.strip()):
        if not token:
            continue
        if token in PRESETS:
            for flag in flags.values():
                if not flag.core:
                    asked[flag.id] = PRESETS[token]
            continue
        want = not token.startswith("-")
        name = token.lstrip("+-")
        if name.endswith("*"):
            prefix = name[:-1]
            matched = [f for f in flags.values() if f.id.startswith(prefix) and not f.core]
            if not matched:
                raise FlagError(f"{ENV} has {token!r}, but no flag that can change starts {prefix}")
            for flag in matched:
                asked[flag.id] = want
            continue
        if name not in flags:
            raise _unknown(name, flags)
        if flags[name].core and not want:
            raise FlagError(f"{name} can't be turned off: {flags[name].core}")
        asked[name] = want
    return asked


def resolve(text: str | None, flags: dict[str, Flag] | None = None) -> dict[str, State]:
    """Each flag's state once the defaults, `SELECTA_FLAGS` and what each one needs are applied."""
    flags = registry() if flags is None else flags
    asked = parse(text or "", flags)
    states: dict[str, State] = {}

    def state(flag_id: str, path: tuple[str, ...] = ()) -> State:
        if flag_id in states:
            return states[flag_id]
        if flag_id in path:
            raise FlagError("requires go round in a circle: " + " -> ".join((*path, flag_id)))
        flag = flags[flag_id]
        if flag.core:
            found = State(True, "core")
        elif flag_id in asked:
            found = State(asked[flag_id], ENV)
        else:
            found = State(flag.default, "default" if flag.default else "off by default")
        if found.on:
            for need in flag.requires:
                if not state(need, (*path, flag_id)).on:
                    found = State(False, f"needs {need}")
                    break
        states[flag_id] = found
        return found

    for flag_id in flags:
        state(flag_id)
    return states


_states: dict[str, State] | None = None


def effective() -> dict[str, State]:
    """This process's flags, read from `SELECTA_FLAGS` the first time they're asked for."""
    global _states
    if _states is None:
        _states = resolve(os.environ.get(ENV, ""))
    return _states


def use(text: str | None) -> None:
    """Replace this process's flags. For tests and the browser-test server only; `None` goes back
    to reading `SELECTA_FLAGS`, the next time a flag is asked for. Nothing caches a flag at
    import, so this takes effect at once."""
    global _states
    _states = None if text is None else resolve(text)


def on(flag_id: str) -> bool:
    states = effective()
    if flag_id not in states:
        raise KeyError(f"There's no flag called {flag_id!r}.")
    return states[flag_id].on


def require(flag_id: str) -> None:
    if not on(flag_id):
        raise FlagOff(registry()[flag_id])


def snapshot() -> dict[str, bool]:
    """Every flag and whether it's on, for `/api/status`."""
    return {flag_id: state.on for flag_id, state in effective().items()}


def turned_off() -> list[str]:
    return [flag_id for flag_id, state in effective().items() if not state.on]


def route_owners() -> dict[str, str]:
    """`"METHOD /api/template"` to the flag that owns it."""
    return {route: flag.id for flag in registry().values() for route in flag.routes}


def cli_owners() -> dict[str, list[str]]:
    """CLI command to the flags that own it. A command owned by several runs if any is on."""
    owners: dict[str, list[str]] = {}
    for flag in registry().values():
        for command in flag.cli:
            owners.setdefault(command, []).append(flag.id)
    return owners


def markdown() -> str:
    """The catalog in `docs/flags.md`. `selecta flags --markdown docs/flags.md` writes it."""
    lines = [
        "# Feature flags",
        "",
        "Every Selecta feature, and the flag that turns it off. This file is generated from",
        "`src/selecta/flags/*.json` by `uv run selecta flags --markdown docs/flags.md`, and a test",
        "fails if it falls behind.",
        "",
        "Flags are for developers. Set `SELECTA_FLAGS` before starting Selecta, then restart to",
        "change it:",
        "",
        "| Write | To |",
        "|---|---|",
        "| `-requests` | turn a flag off |",
        "| `+lucy.voice` or `lucy.voice` | turn a flag on |",
        "| `-move.*` | turn off every flag that starts `move.` |",
        "| `minimal` | turn off everything that isn't core |",
        "| `all` | turn everything on |",
        "",
        "Separate them with spaces or commas; they apply left to right. A flag that needs one",
        "that's off is off too. Core flags can't be turned off. Turning a flag off never deletes",
        "anything. `uv run selecta flags` shows what's on in the current shell and why.",
    ]
    by_area: dict[str, list[Flag]] = {}
    for flag in registry().values():
        by_area.setdefault(flag.area, []).append(flag)
    for area, flags in by_area.items():
        lines += ["", f"## {area}", "", "| Flag | What it is | Needs |", "|---|---|---|"]
        for flag in flags:
            needs = ", ".join(f"`{need}`" for need in flag.requires)
            about = flag.about if not flag.core else f"{flag.about} **Core:** {flag.core}"
            lines.append(f"| `{flag.id}` | **{flag.label}.** {about} | {needs} |")
    return "\n".join(lines) + "\n"
