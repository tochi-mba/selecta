"""Where the cloud keeps targeting rules, their history and staff previews (ADR-0414).

`flag_rules` holds each flag's current rules, in order. Every change, including a staff preview
switched on or off, also writes one row to `flag_rule_versions`: an immutable copy of that flag's
whole rule list, with who made the change and why. Versions count up across every flag, so the
highest one names the state of all of them, and a process can tell from one number whether its
snapshot is behind. Rolling back copies an earlier version's rules into a new version, so history
only ever grows.

Saving checks everything first and refuses with every problem at once: a flag that isn't in the
registry, a core flag, a flag that runs the admin console or staff routes (`UNTARGETABLE`), and
rules whose params don't make sense. Some changes are allowed but deserve a second look, such as a
new salt that reshuffles a rollout; those come back as warnings with the saved version.

A staff preview switches one flag on for the staff member's own account only, for QA. It's still
a rule, so it can't reach past the build, the mode or the plan, and a kill switch beats it.

These functions take a connection inside `persistence.transaction(engine)`, so a rule change and
its audit record can be written in one transaction. `RulesCache` keeps the snapshot each process
decides with. On PostgreSQL every change sends `pg_notify('selecta_flag_rules', version)` in its
transaction, so `RulesCache.listen` hears it on every API instance and the worker gateway as soon
as it commits and reloads at once; `refresh_if_stale` bounds how old a snapshot can get if a
notification is lost (5 s in both services, the kill-switch target).
"""

from __future__ import annotations

import difflib
import fnmatch
import threading
import time
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection, Engine

from selecta import flags, persistence
from selecta.flags.matching import Rule, RuleKind, RuleSnapshot

JSON = sa.JSON().with_variant(JSONB(), "postgresql")
FlagId = sa.String(120)

# Flags nobody can target: the admin console and staff routes, so an admin can't lock themselves
# out. A trailing `*` matches every flag that starts that way.
UNTARGETABLE = ("admin", "admin.*", "staff", "staff.*")
MAX_RULES = 100
PREVIEW_TTL = 24 * 60 * 60
# The admin page warns when one flag changes this often (docs/saas/11b-feature-flags.md §11B.7).
FLAP_CHANGES = 3
FLAP_WINDOW = 10 * 60
# Serialises version numbers on PostgreSQL. SQLite's BEGIN IMMEDIATE already does.
_VERSION_LOCK = 0x53454C4543544146
CHANNEL = "selecta_flag_rules"
SCOPE_KEY = "selecta.flag_rules.pending"

flag_rules = sa.Table(
    "flag_rules",
    persistence.metadata,
    sa.Column("flag_id", FlagId, primary_key=True),
    sa.Column("position", sa.Integer, primary_key=True),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("params", JSON, nullable=False),
    sa.Column("enabled", sa.Boolean, nullable=False),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("updated_at", persistence.Epoch, nullable=False),
)

flag_rule_versions = sa.Table(
    "flag_rule_versions",
    persistence.metadata,
    sa.Column("version", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("flag_id", FlagId, nullable=False, index=True),
    # "rules", "rollback", "preview_on" or "preview_off"
    sa.Column("change", sa.String(16), nullable=False),
    sa.Column("rules", JSON, nullable=False),
    sa.Column("subject_user_id", persistence.Id, nullable=True),
    sa.Column("rolled_back_to", sa.Integer, nullable=True),
    sa.Column("author", sa.String(200), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("created_at", persistence.Epoch, nullable=False, index=True),
)

flag_previews = sa.Table(
    "flag_previews",
    persistence.metadata,
    sa.Column("flag_id", FlagId, primary_key=True),
    sa.Column("user_id", persistence.Id, primary_key=True),
    sa.Column("created_by", sa.String(200), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("created_at", persistence.Epoch, nullable=False),
    sa.Column("expires_at", persistence.Epoch, nullable=True, index=True),
)

user_flag_preferences = sa.Table(
    "user_flag_preferences",
    persistence.metadata,
    sa.Column(
        "user_id", persistence.Id, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    ),
    sa.Column("flag_id", FlagId, primary_key=True),
    sa.Column("enabled", sa.Boolean, nullable=False),
    sa.Column("updated_at", persistence.Epoch, nullable=False),
)


class RuleError(ValueError):
    """Rules that can't be saved, with every reason."""

    def __init__(self, problems: Sequence[str]) -> None:
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


@dataclass(frozen=True)
class Saved:
    version: int
    flag_id: str
    rules: tuple[Rule, ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class Version:
    version: int
    flag_id: str
    change: str
    rules: tuple[Rule, ...]
    author: str
    reason: str
    created_at: float
    subject_user_id: str | None = None
    rolled_back_to: int | None = None


def is_untargetable(flag_id: str, patterns: Collection[str] = UNTARGETABLE) -> bool:
    return any(fnmatch.fnmatchcase(flag_id, pattern) for pattern in patterns)


def problems(
    flag_id: str,
    rules: Sequence[Rule],
    *,
    registry: Mapping[str, flags.Flag] | None = None,
    untargetable: Collection[str] = UNTARGETABLE,
) -> list[str]:
    """Everything that stops these rules being saved for this flag."""
    registry = flags.registry() if registry is None else registry
    flag = registry.get(flag_id)
    if flag is None:
        close = difflib.get_close_matches(flag_id, list(registry), n=3)
        hint = f" Did you mean {', '.join(close)}?" if close else ""
        return [f"{flag_id!r} isn't a flag.{hint}"]
    if flag.core:
        return [f"{flag_id} is core, so it can't be targeted: {flag.core}"]
    if is_untargetable(flag_id, untargetable):
        return [f"{flag_id} runs the admin console or staff routes, so it can't be targeted"]
    found: list[str] = []
    if len(rules) > MAX_RULES:
        found.append(f"a flag can have at most {MAX_RULES} rules")
    for position, rule in enumerate(rules, start=1):
        if not isinstance(rule, Rule):
            found.append(f"rule {position} isn't a Rule")
            continue
        found += [f"rule {position}: {problem}" for problem in rule.problems]
        if flag.kind == "experiment" and rule.kind == RuleKind.KILL_SWITCH:
            found.append(
                f"rule {position}: an experiment can't have a kill switch; end the experiment"
            )
    return found


def _rollouts(rules: Sequence[Rule]) -> list[Rule]:
    return [rule for rule in rules if rule.kind == RuleKind.PERCENTAGE and rule.enabled]


def warnings(before: Sequence[Rule], after: Sequence[Rule], recent_changes: int = 0) -> list[str]:
    """Changes that are allowed but worth a second look before they go out."""
    found: list[str] = []
    old_salts = {rule.params.get("salt", "") for rule in _rollouts(before)}
    new_salts = {rule.params.get("salt", "") for rule in _rollouts(after)}
    if old_salts and new_salts and not new_salts <= old_salts:
        found.append("a new salt reshuffles who is in the rollout: some accounts lose the feature")
    old_percent = {
        rule.params.get("salt", ""): rule.params.get("percent") for rule in _rollouts(before)
    }
    for rule in _rollouts(after):
        was = old_percent.get(rule.params.get("salt", ""))
        if was is not None and rule.params.get("percent", 0) < was:
            found.append("lowering a rollout takes the feature away from accounts that have it")
            break
    if recent_changes + 1 >= FLAP_CHANGES:
        minutes = FLAP_WINDOW // 60
        found.append(f"this flag has changed {recent_changes + 1} times in {minutes} minutes")
    return found


def _require_who(author: str, reason: str) -> None:
    missing = [
        name for name, value in (("author", author), ("reason", reason)) if not value.strip()
    ]
    if missing:
        raise RuleError([f"every change needs {' and '.join(missing)}"])


def _next_version(conn: Connection) -> int:
    if persistence.is_postgres(conn):
        conn.execute(sa.text("SELECT pg_advisory_xact_lock(:key)"), {"key": _VERSION_LOCK})
    latest = conn.execute(sa.select(sa.func.max(flag_rule_versions.c.version))).scalar()
    return int(latest or 0) + 1


def current_version(conn: Connection) -> int:
    """The newest version of any flag's rules, or 0 before the first change."""
    latest = conn.execute(sa.select(sa.func.max(flag_rule_versions.c.version))).scalar()
    return int(latest or 0)


def _row_rule(row: sa.Row) -> Rule:
    return Rule(kind=row.kind, params=dict(row.params or {}), enabled=bool(row.enabled))


def current_rules(conn: Connection, flag_id: str) -> tuple[Rule, ...]:
    query = (
        sa.select(flag_rules).where(flag_rules.c.flag_id == flag_id).order_by(flag_rules.c.position)
    )
    return tuple(_row_rule(row) for row in conn.execute(query))


def _write(
    conn: Connection,
    flag_id: str,
    rules: tuple[Rule, ...],
    *,
    author: str,
    reason: str,
    change: str,
    replace_rules: bool = True,
    rolled_back_to: int | None = None,
    subject_user_id: str | None = None,
) -> Saved:
    version = _next_version(conn)
    now = persistence.db_now(conn)
    before = current_rules(conn, flag_id)
    recent = conn.execute(
        sa.select(sa.func.count())
        .select_from(flag_rule_versions)
        .where(flag_rule_versions.c.flag_id == flag_id)
        .where(flag_rule_versions.c.created_at >= now - FLAP_WINDOW)
    ).scalar_one()
    if replace_rules:
        conn.execute(sa.delete(flag_rules).where(flag_rules.c.flag_id == flag_id))
        if rules:
            conn.execute(
                sa.insert(flag_rules),
                [
                    {
                        "flag_id": flag_id,
                        "position": position,
                        "kind": rule.kind,
                        "params": rule.to_dict()["params"],
                        "enabled": rule.enabled,
                        "version": version,
                        "updated_at": now,
                    }
                    for position, rule in enumerate(rules)
                ],
            )
    conn.execute(
        sa.insert(flag_rule_versions).values(
            version=version,
            flag_id=flag_id,
            change=change,
            rules=[rule.to_dict() for rule in rules],
            subject_user_id=subject_user_id,
            rolled_back_to=rolled_back_to,
            author=author,
            reason=reason,
            created_at=now,
        )
    )
    if persistence.is_postgres(conn):
        # Delivered on commit only, so no instance reloads for a change that rolled back.
        conn.execute(
            sa.text("SELECT pg_notify(:channel, :version)"),
            {"channel": CHANNEL, "version": str(version)},
        )
    said = warnings(before, rules, int(recent)) if replace_rules else []
    return Saved(version, flag_id, rules, tuple(said))


def save(
    conn: Connection,
    flag_id: str,
    rules: Sequence[Rule],
    *,
    author: str,
    reason: str,
    registry: Mapping[str, flags.Flag] | None = None,
    untargetable: Collection[str] = UNTARGETABLE,
) -> Saved:
    """Replace one flag's rules and write a new version. Raises `RuleError` with every problem."""
    rules = tuple(rules)
    _require_who(author, reason)
    found = problems(flag_id, rules, registry=registry, untargetable=untargetable)
    if found:
        raise RuleError(found)
    return _write(conn, flag_id, rules, author=author, reason=reason, change="rules")


def _version_row(row: sa.Row) -> Version:
    return Version(
        version=int(row.version),
        flag_id=row.flag_id,
        change=row.change,
        rules=tuple(Rule.from_dict(item) for item in row.rules or ()),
        author=row.author,
        reason=row.reason,
        created_at=float(row.created_at),
        subject_user_id=row.subject_user_id,
        rolled_back_to=row.rolled_back_to,
    )


def get_version(conn: Connection, version: int) -> Version | None:
    query = sa.select(flag_rule_versions).where(flag_rule_versions.c.version == version)
    row = conn.execute(query).first()
    return None if row is None else _version_row(row)


def rollback(
    conn: Connection,
    version: int,
    *,
    author: str,
    reason: str,
    registry: Mapping[str, flags.Flag] | None = None,
    untargetable: Collection[str] = UNTARGETABLE,
) -> Saved:
    """Restore a flag's rules as they were at `version`, as a new version. The old rules are
    checked again, since the registry or the plans may have changed since."""
    _require_who(author, reason)
    earlier = get_version(conn, version)
    if earlier is None:
        raise LookupError(f"There's no version {version} of the flag rules.")
    found = problems(earlier.flag_id, earlier.rules, registry=registry, untargetable=untargetable)
    if found:
        raise RuleError([f"version {version} can't be restored as it is", *found])
    return _write(
        conn,
        earlier.flag_id,
        earlier.rules,
        author=author,
        reason=reason,
        change="rollback",
        rolled_back_to=version,
    )


def history(
    conn: Connection,
    flag_id: str | None = None,
    *,
    limit: int = 50,
    before: int | None = None,
) -> list[Version]:
    """Changes newest first, for one flag or all of them. `before` pages back from a version."""
    query = sa.select(flag_rule_versions).order_by(flag_rule_versions.c.version.desc())
    if flag_id is not None:
        query = query.where(flag_rule_versions.c.flag_id == flag_id)
    if before is not None:
        query = query.where(flag_rule_versions.c.version < before)
    return [_version_row(row) for row in conn.execute(query.limit(limit))]


def set_preview(
    conn: Connection,
    flag_id: str,
    user_id: str,
    *,
    author: str,
    reason: str,
    ttl: float | None = PREVIEW_TTL,
    registry: Mapping[str, flags.Flag] | None = None,
    untargetable: Collection[str] = UNTARGETABLE,
) -> Saved:
    """Switch a flag on for the staff member's own account (`author` is their user id) until
    `ttl` seconds from now, or until cleared when `ttl` is None."""
    _require_who(author, reason)
    if user_id != author:
        raise RuleError(["a preview is for your own account only"])
    found = problems(flag_id, (), registry=registry, untargetable=untargetable)
    if found:
        raise RuleError(found)
    if ttl is not None and ttl <= 0:
        raise RuleError(["a preview needs a time to run, in seconds, above 0"])
    now = persistence.db_now(conn)
    match = (flag_previews.c.flag_id == flag_id) & (flag_previews.c.user_id == user_id)
    conn.execute(sa.delete(flag_previews).where(match))
    conn.execute(
        sa.insert(flag_previews).values(
            flag_id=flag_id,
            user_id=user_id,
            created_by=author,
            reason=reason,
            created_at=now,
            expires_at=None if ttl is None else now + ttl,
        )
    )
    rules = current_rules(conn, flag_id)
    return _write(
        conn,
        flag_id,
        rules,
        author=author,
        reason=reason,
        change="preview_on",
        replace_rules=False,
        subject_user_id=user_id,
    )


def clear_preview(
    conn: Connection, flag_id: str, user_id: str, *, author: str, reason: str
) -> Saved | None:
    """Switch a preview off. None when there wasn't one."""
    _require_who(author, reason)
    match = (flag_previews.c.flag_id == flag_id) & (flag_previews.c.user_id == user_id)
    if conn.execute(sa.delete(flag_previews).where(match)).rowcount == 0:
        return None
    rules = current_rules(conn, flag_id)
    return _write(
        conn,
        flag_id,
        rules,
        author=author,
        reason=reason,
        change="preview_off",
        replace_rules=False,
        subject_user_id=user_id,
    )


def expire_previews(conn: Connection) -> int:
    """Delete previews that have ended. They already stopped counting when they ended."""
    now = persistence.db_now(conn)
    ended = flag_previews.c.expires_at.is_not(None) & (flag_previews.c.expires_at <= now)
    return int(conn.execute(sa.delete(flag_previews).where(ended)).rowcount or 0)


def load_snapshot(conn: Connection) -> RuleSnapshot:
    """Every flag's rules and the previews still running, read in one transaction so the
    version matches what was read."""
    version = current_version(conn)
    rules: dict[str, list[Rule]] = {}
    query = sa.select(flag_rules).order_by(flag_rules.c.flag_id, flag_rules.c.position)
    for row in conn.execute(query):
        rules.setdefault(row.flag_id, []).append(_row_rule(row))
    now = persistence.db_now(conn)
    previews: dict[str, dict[str, float | None]] = {}
    running = flag_previews.c.expires_at.is_(None) | (flag_previews.c.expires_at > now)
    for row in conn.execute(sa.select(flag_previews).where(running)):
        ends = None if row.expires_at is None else float(row.expires_at)
        previews.setdefault(row.flag_id, {})[row.user_id] = ends
    return RuleSnapshot(
        version=version,
        rules={flag_id: tuple(found) for flag_id, found in rules.items()},
        previews=previews,
    )


def orphans(
    conn: Connection,
    *,
    registry: Mapping[str, flags.Flag] | None = None,
    untargetable: Collection[str] = UNTARGETABLE,
) -> list[str]:
    """Stored rules that name a flag that's gone, or one that can't be targeted any more. CI
    fails on these until a migration cleans them up."""
    registry = flags.registry() if registry is None else registry
    found: list[str] = []
    stored = sa.select(flag_rules.c.flag_id).distinct().order_by(flag_rules.c.flag_id)
    for (flag_id,) in conn.execute(stored):
        flag = registry.get(flag_id)
        if flag is None:
            found.append(f"{flag_id} has rules but isn't a flag any more")
        elif flag.core or is_untargetable(flag_id, untargetable):
            found.append(f"{flag_id} has rules but can't be targeted any more")
    return found


def user_preferences(conn: Connection, user_id: str) -> dict[str, bool]:
    """The user's Labs opt-ins and explicit feature opt-outs."""
    rows = conn.execute(
        sa.select(user_flag_preferences.c.flag_id, user_flag_preferences.c.enabled).where(
            user_flag_preferences.c.user_id == user_id
        )
    )
    return {flag_id: bool(enabled) for flag_id, enabled in rows}


def set_user_preference(
    conn: Connection,
    user_id: str,
    flag_id: str,
    enabled: bool,
    *,
    entitled: Collection[str],
    plan_gated: Collection[str],
    registry: Mapping[str, flags.Flag] | None = None,
) -> None:
    """Store an opt-in only for an entitled Cloud beta; a preference cannot grant a plan feature."""
    registry = flags.registry() if registry is None else registry
    flag = registry.get(flag_id)
    if flag is None or flag.kind != "beta" or "cloud" not in flag.modes:
        raise RuleError(["only Cloud beta features can be changed in Labs"])
    if type(enabled) is not bool:
        raise RuleError(["a Labs choice must be true or false"])
    if enabled and flag_id in plan_gated and flag_id not in entitled:
        raise RuleError(["this plan does not include that beta feature"])
    if conn.dialect.name == "postgresql":
        insert = postgresql.insert(user_flag_preferences)
    elif conn.dialect.name == "sqlite":
        insert = sqlite.insert(user_flag_preferences)
    else:
        raise RuntimeError(f"Unsupported database: {conn.dialect.name}")
    now = persistence.db_now(conn)
    conn.execute(
        insert.values(
            user_id=user_id, flag_id=flag_id, enabled=enabled, updated_at=now
        ).on_conflict_do_update(
            index_elements=[user_flag_preferences.c.user_id, user_flag_preferences.c.flag_id],
            set_={"enabled": enabled, "updated_at": now},
        )
    )


class RulesCache:
    """One process's snapshot of the rules, so a flag decision never costs a query.

    `snapshot` loads on first use. `refresh_if_newer` rereads only when the database has a newer
    version (pass the version a NOTIFY carried to skip even that query when it's no newer), and
    `refresh_if_stale` does the same at most every `max_age` seconds, the backstop for a missed
    NOTIFY. Readers take the snapshot reference and keep it for their request; it never changes
    under them."""

    def __init__(
        self,
        engine: Engine,
        *,
        max_age: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._engine = engine
        self._max_age = max_age
        self._clock = clock
        self._lock = threading.Lock()
        self._snapshot: RuleSnapshot | None = None
        self._checked_at = float("-inf")

    @property
    def snapshot(self) -> RuleSnapshot:
        if self._snapshot is None:
            self.refresh_if_newer()
        assert self._snapshot is not None
        return self._snapshot

    @property
    def version(self) -> int:
        return self.snapshot.version

    def refresh_if_newer(
        self,
        version: int | None = None,
        connection: Connection | None = None,
    ) -> bool:
        """Reload when the stored rules are newer than the snapshot. True when it reloaded."""
        held = self._snapshot
        if version is not None and held is not None and version <= held.version:
            return False
        with self._lock:
            if connection is None:
                with persistence.transaction(self._engine) as conn:
                    latest = current_version(conn)
                    held = self._snapshot
                    if held is not None and latest <= held.version:
                        self._checked_at = self._clock()
                        return False
                    self._snapshot = load_snapshot(conn)
            else:
                latest = current_version(connection)
                held = self._snapshot
                if held is not None and latest <= held.version:
                    self._checked_at = self._clock()
                    return False
                # Read through the caller's transaction, which may hold its own uncommitted rule
                # writes: this transaction decides with it, and the shared cache only takes it
                # once the transaction has committed, never if it rolls back.
                loaded = load_snapshot(connection)
                scope = persistence.transaction_scope(connection)
                if scope is not None:
                    scope[(SCOPE_KEY, id(self))] = loaded
                persistence.after_commit(connection, lambda: self._adopt(loaded))
                return True
            self._checked_at = self._clock()
            return True

    def _adopt(self, loaded: RuleSnapshot) -> None:
        with self._lock:
            held = self._snapshot
            if held is None or loaded.version > held.version:
                self._snapshot = loaded
            self._checked_at = self._clock()

    def snapshot_for(self, connection: Connection) -> RuleSnapshot:
        """The snapshot to decide with inside `connection`'s transaction: one this transaction
        loaded (`refresh_if_newer(connection=...)`), else the shared one. A cold cache is loaded
        through `connection`, never a second connection."""
        scope = persistence.transaction_scope(connection)
        if scope is not None and (SCOPE_KEY, id(self)) in scope:
            return scope[(SCOPE_KEY, id(self))]
        if self._snapshot is None:
            self.refresh_if_newer(connection=connection)
            if scope is not None and (SCOPE_KEY, id(self)) in scope:
                return scope[(SCOPE_KEY, id(self))]
            if self._snapshot is None:  # outside `transaction()`: nowhere to keep it but here
                return load_snapshot(connection)
        return self._snapshot

    def listen(self, listener) -> None:
        """Reload whenever `listener` (a `persistence.listen.PgListener`) hears a rule change,
        and check once after each (re)connect, since changes made while away weren't heard."""

        def heard(payload: str | None) -> None:
            try:
                version = int(payload) if payload is not None else None
            except ValueError:
                version = None
            self.refresh_if_newer(version)

        listener.subscribe(CHANNEL, heard)

    def refresh_if_stale(self, connection: Connection | None = None) -> bool:
        if self._snapshot is not None and self._clock() - self._checked_at < self._max_age:
            return False
        return self.refresh_if_newer(connection=connection)

    def invalidate(self) -> None:
        """Forget the snapshot; the next read loads a fresh one."""
        with self._lock:
            self._snapshot = None
            self._checked_at = float("-inf")
