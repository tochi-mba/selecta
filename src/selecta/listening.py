"""Persistent paired trials. Condition identities stay outside listener-facing records.

With `core.engine_store` on, on a library past `lib0010listening`, every read and write goes
through `engine_store.listening` (one operation, one write); off, the statements below, as before.
"""

from __future__ import annotations

import json
import random
import sqlite3
import uuid
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from selecta import flags

MIGRATION = "lib0010listening"


def store_of(conn):
    """The engine store the study reads and writes through, or None for the old path: flag on,
    the file past `lib0010listening`, and `conn` holding no writes a store write would wait on."""
    if not flags.on("core.engine_store") or conn.in_transaction:
        return None
    from selecta.engine_store import library

    try:
        if not _made_by_the_migration(conn):
            return None
        return library.store_of(conn)
    except (library.LibraryNotReady, sqlite3.Error):
        return None


def _made_by_the_migration(conn: sqlite3.Connection) -> bool:
    from selecta.engine_store import library

    stamp = library.stamp_of(conn)
    return stamp is not None and library.includes(stamp, MIGRATION)


def _seam_key(condition: dict) -> str | None:
    key = condition.get("seam_key")
    if key is None:
        return None
    if not isinstance(key, str) or not key.strip() or len(key) > 80:
        raise ValueError("A seam key must be a short nonempty string")
    return key


def register_comparison(
    conn, settings, study: str, pair: str, conditions: list[dict], seed: int = 42
):
    """Import two declared same-context renders, preserving original files.

    Context declarations are retained for audit; their musical truth still needs review.
    Study audio lives outside the evictable seam cache.
    """
    if not study.strip() or not pair:
        raise ValueError("Study and pair identifiers are required")
    if len(conditions) != 2 or not conditions[0].get("context"):
        raise ValueError("Two renders with explicit source context are required")
    if conditions[0]["context"] != conditions[1].get("context"):
        raise ValueError("Both conditions must declare identical source cues and context")
    if not all(condition.get("renderer") for condition in conditions):
        raise ValueError("Record the renderer version for both conditions")
    for condition in conditions:
        if "method" in condition and (
            not isinstance(condition["method"], str) or not condition["method"].strip()
        ):
            raise ValueError("Method labels must be nonempty strings")
        _seam_key(condition)
    first, sr = sf.read(conditions[0]["path"], always_2d=True)
    second, other_sr = sf.read(conditions[1]["path"], always_2d=True)
    if sr != other_sr:
        raise ValueError("Comparison sample rates must match")
    first, second, report = prepare_comparison(first, second, sr)
    root = settings.home / "listening-audio"
    root.mkdir(parents=True, exist_ok=True)
    keys = []
    for audio, metadata in zip((first, second), conditions, strict=True):
        key = "study-" + uuid.uuid4().hex
        sf.write(root / f"{key}.flac", audio, sr, subtype="PCM_24")
        (root / f"{key}.json").write_text(
            json.dumps(
                {
                    "source": str(Path(metadata["path"]).resolve()),
                    "context": metadata["context"],
                    "renderer": metadata["renderer"],
                    "method": metadata.get("method"),
                    "preparation": report,
                }
            ),
            "utf-8",
        )
        keys.append(key)
    trials = create_trials(conn, study, [{"pair": pair, "conditions": keys}], seed)
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        stored.add_methods(
            store,
            [
                (key, metadata["method"].strip(), metadata["renderer"], _seam_key(metadata))
                for key, metadata in zip(keys, conditions, strict=True)
                if metadata.get("method")
            ],
        )
        return trials
    with conn:
        for key, metadata in zip(keys, conditions, strict=True):
            if metadata.get("method"):
                conn.execute(
                    "INSERT INTO listening_methods(condition,method,renderer) VALUES(?,?,?)",
                    (key, metadata["method"].strip(), metadata["renderer"]),
                )
    return trials


def prepare_comparison(
    first: np.ndarray, second: np.ndarray, sample_rate: int, target_lufs: float = -18.0
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Match excerpt loudness at a shared peak-safe target; never time-stretch a trial.

    Caller must establish matching source cues and context before using these arrays.
    This checks audio integrity and length, not musical equivalence of those cues.
    """
    clips = [np.asarray(clip, dtype=float) for clip in (first, second)]
    if sample_rate <= 0 or not np.isfinite(target_lufs):
        raise ValueError("A valid sample rate and loudness target are required")
    if clips[0].shape != clips[1].shape:
        raise ValueError("Comparison clips must have identical duration and channel layout")
    for clip in clips:
        if clip.ndim != 2 or clip.shape[1] != 2 or len(clip) < sample_rate:
            raise ValueError("Use stereo excerpts at least one second long")
        if not np.isfinite(clip).all() or np.max(np.abs(clip)) > 1:
            raise ValueError("Comparison audio contains non-finite or out-of-range samples")
    meter = pyln.Meter(sample_rate)
    loudness = [float(meter.integrated_loudness(clip)) for clip in clips]
    if not all(np.isfinite(value) for value in loudness):
        raise ValueError("Silent excerpts cannot be loudness matched")
    peak_db = [float(20 * np.log10(np.max(np.abs(clip)))) for clip in clips]
    target = min(
        target_lufs, *(level - peak - 1 for level, peak in zip(loudness, peak_db, strict=True))
    )
    matched = [
        clip * 10 ** ((target - level) / 20) for clip, level in zip(clips, loudness, strict=True)
    ]
    return (
        matched[0],
        matched[1],
        {
            "sample_rate": sample_rate,
            "frames": len(clips[0]),
            "original_lufs": loudness,
            "target_lufs": target,
            "sample_peak_ceiling_db": -1.0,
        },
    )


def initialise(conn: sqlite3.Connection) -> None:
    """Make the study's tables if they aren't there. With `core.engine_store` on, the library
    migration `lib0010listening` has made them, so nothing is created at run time."""
    if flags.on("core.engine_store") and _made_by_the_migration(conn):
        return
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_methods ("
        "condition TEXT PRIMARY KEY, method TEXT NOT NULL, renderer TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_quality (trial TEXT NOT NULL, "
        "listener TEXT NOT NULL, "
        "option TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 5), "
        "tags TEXT NOT NULL, PRIMARY KEY(trial,listener,option))"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_trials ("
        "id TEXT PRIMARY KEY, study TEXT NOT NULL, pair TEXT NOT NULL, "
        "mapping TEXT NOT NULL, seed INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_responses ("
        "trial TEXT NOT NULL REFERENCES listening_trials(id), listener TEXT NOT NULL, "
        "choice TEXT NOT NULL, setup TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, "
        "PRIMARY KEY(trial,listener))"
    )
    conn.commit()


def create_trials(conn: sqlite3.Connection, study: str, pairs: list[dict], seed: int) -> list[str]:
    """Each pair supplies a stable pair ID and two distinct rendered condition IDs.

    Rendering, equal-context and loudness checks must precede registration. This
    module randomizes identities; it does not assert those audio checks happened.
    """
    if not study.strip() or not pairs:
        raise ValueError("A study needs a name and at least one pair")
    for pair in pairs:
        if not pair.get("pair") or len(pair.get("conditions", [])) != 2:
            raise ValueError("Each trial needs a pair ID and two conditions")
        if len(set(pair["conditions"])) != 2:
            raise ValueError("The two rendered conditions must be distinct")
    initialise(conn)
    rng = random.Random(seed)
    rows = []
    for pair in pairs:
        conditions = list(pair["conditions"])
        rng.shuffle(conditions)
        mapping = json.dumps(dict(zip(("a", "b"), conditions, strict=True)))
        rows.append((uuid.uuid4().hex, study, pair["pair"], mapping, seed))
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        stored.create_trials(store, rows)
        return [row[0] for row in rows]
    with conn:
        for row in rows:
            conn.execute(
                "INSERT INTO listening_trials(id,study,pair,mapping,seed) VALUES(?,?,?,?,?)", row
            )
    return [row[0] for row in rows]


def public_trials(conn: sqlite3.Connection, study: str) -> list[dict]:
    """Expose opaque trial IDs and A/B handles, never pair or condition metadata."""
    initialise(conn)
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        return [{"id": trial, "options": ["a", "b"]} for trial in stored.trial_ids(store, study)]
    return [
        {"id": row[0], "options": ["a", "b"]}
        for row in conn.execute(
            "SELECT id FROM listening_trials WHERE study=? ORDER BY rowid", (study,)
        )
    ]


def trial_mapping(conn: sqlite3.Connection, trial: str) -> str | None:
    """A trial's private mapping JSON, for serving its audio; None when there is no such trial."""
    initialise(conn)
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        return stored.mapping(store, trial)
    row = conn.execute("SELECT mapping FROM listening_trials WHERE id=?", (trial,)).fetchone()
    return None if row is None else row[0]


def respond(
    conn: sqlite3.Connection,
    trial: str,
    listener: str,
    choice: str,
    setup: str,
    quality: dict | None = None,
) -> None:
    quality = {} if quality is None else quality
    if not isinstance(quality, dict):
        raise ValueError("Quality ratings must be keyed by a or b")
    allowed_tags = {"beat", "downbeat", "mid-vocal", "key", "energy", "contrast", "cut-off ending"}
    for option, score in quality.items():
        if (
            option not in {"a", "b"}
            or not isinstance(score, dict)
            or type(score.get("grade")) is not int
            or not 1 <= score["grade"] <= 5
        ):
            raise ValueError("Each quality grade must be an integer from 1 to 5 for A or B")
        if not isinstance(score.get("tags", []), list) or any(
            tag not in allowed_tags for tag in score.get("tags", [])
        ):
            raise ValueError("Unknown transition issue tag")
    if choice not in {"a", "b", "tie", "cannot_judge"}:
        raise ValueError("Choose a, b, tie, or cannot_judge")
    if not listener.strip() or not setup.strip():
        raise ValueError("A listener ID and listening setup are required")
    initialise(conn)
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        grades = [
            (option, score["grade"], json.dumps(score.get("tags", [])))
            for option, score in quality.items()
        ]
        stored.respond(store, trial, listener, choice, setup, grades)
        return
    if conn.execute("SELECT 1 FROM listening_trials WHERE id=?", (trial,)).fetchone() is None:
        raise ValueError("Unknown listening trial")
    with conn:
        conn.execute(
            "INSERT INTO listening_responses(trial,listener,choice,setup) VALUES(?,?,?,?) "
            "ON CONFLICT(trial,listener) DO UPDATE SET "
            "choice=excluded.choice,setup=excluded.setup, "
            "updated_at=CURRENT_TIMESTAMP",
            (trial, listener, choice, setup),
        )
        conn.execute(
            "DELETE FROM listening_quality WHERE trial=? AND listener=?", (trial, listener)
        )
        for option, score in quality.items():
            conn.execute(
                "INSERT INTO listening_quality(trial,listener,option,grade,tags) "
                "VALUES(?,?,?,?,?)",
                (trial, listener, option, score["grade"], json.dumps(score.get("tags", []))),
            )


def study_summary(conn: sqlite3.Connection, study: str) -> dict:
    """Descriptive counts; repeated listeners are not independent experiments."""
    initialise(conn)
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import listening as stored

        found = stored.study_rows(store, study)
        trials, labels = found["trials"], found["labels"]

        def answers(trial: str) -> list:
            return found["answers"][trial]

        def graded(trial: str, listener: str) -> list:
            return found["grades"].get((trial, listener), [])
    else:
        trials = conn.execute(
            "SELECT id,mapping FROM listening_trials WHERE study=?", (study,)
        ).fetchall()
        labels = {
            row[0]: (row[1], row[2])
            for row in conn.execute("SELECT condition,method,renderer FROM listening_methods")
        }

        def answers(trial: str) -> list:
            return conn.execute(
                "SELECT listener,choice FROM listening_responses WHERE trial=?", (trial,)
            ).fetchall()

        def graded(trial: str, listener: str) -> list:
            return conn.execute(
                "SELECT option,grade FROM listening_quality WHERE trial=? AND listener=?",
                (trial, listener),
            ).fetchall()

    conditions, listeners = {}, set()
    methods: dict[str, dict[str, dict]] = {}
    unlabelled = 0
    choices = {"a": 0, "b": 0, "tie": 0, "cannot_judge": 0}
    unanswered = missing = 0
    for trial, mapping_json in trials:
        mapping = json.loads(mapping_json)
        responses = answers(trial)
        unanswered += not responses
        for listener, choice in responses:
            listeners.add(listener)
            choices[choice] += 1
            grades = graded(trial, listener)
            missing += 2 - len(grades)
            for option, grade in grades:
                result = conditions.setdefault(mapping[option], {"rated": 0, "bad": 0})
                result["rated"] += 1
                result["bad"] += grade <= 2
                label = labels.get(mapping[option])
                if label is None:
                    unlabelled += 1
                else:
                    method, renderer = label
                    group = methods.setdefault(method, {}).setdefault(
                        renderer, {"rated": 0, "bad": 0}
                    )
                    group["rated"] += 1
                    group["bad"] += grade <= 2
    for result in conditions.values():
        result["bad_transition_rate"] = result["bad"] / result["rated"]
    for versions in methods.values():
        for result in versions.values():
            result["bad_transition_rate"] = result["bad"] / result["rated"]
    return {
        "trials": len(trials),
        "trials_without_any_response": unanswered,
        "listeners": len(listeners),
        "choices": choices,
        "missing_version_grades_in_responses": missing,
        "conditions": conditions,
        "methods": methods,
        "grades_without_method_labels": unlabelled,
    }
