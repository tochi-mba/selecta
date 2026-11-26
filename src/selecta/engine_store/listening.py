"""The listening study through the engine store: blind trials, their private labels, answers
and 1 to 5 grades (docs/engineering/engine-store-discovery.md, "The listening study").

`listening.py` keeps every rule (what a trial may hold, what an answer must say); with
`core.engine_store` on, what it reads and writes goes through here. One operation is one write:
an answer and its grades land together. Desktop only: the study is the owner's own tool, so these
tables are on `schema.library_metadata` and Cloud has none.

A grade can be joined to a rendered seam (`seam_grades`): a condition is a seam when it is a
`seams.key` itself (a trial made from the seam cache), or when its manifest named one
(`listening_methods.seam_key`).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import now
from selecta.engine_store.schema import (
    LISTENING_TABLES,
    listening_methods,
    listening_quality,
    listening_responses,
    listening_trials,
    seams,
)


def add_methods(store: EngineStore, rows: Sequence[tuple[str, str, str, str | None]]) -> None:
    """Each condition's private label: (condition, method, renderer, seam key or None)."""
    with store.write() as connection:
        for condition, method, renderer, seam_key in rows:
            connection.execute(
                sa.insert(listening_methods).values(
                    workspace_id=store.workspace_id,
                    condition=condition,
                    method=method,
                    renderer=renderer,
                    seam_key=seam_key,
                )
            )


def create_trials(store: EngineStore, rows: Sequence[tuple[str, str, str, str, int]]) -> None:
    """New trials (id, study, pair, mapping JSON, seed), numbered after the last, in one write."""
    with store.write() as connection:
        last = connection.execute(
            sa.select(sa.func.max(listening_trials.c.ordinal)).where(
                store.mine(listening_trials)
            )
        ).scalar()
        for offset, (trial, study, pair, mapping, seed) in enumerate(rows, start=1):
            connection.execute(
                sa.insert(listening_trials).values(
                    workspace_id=store.workspace_id,
                    id=trial,
                    study=study,
                    pair=pair,
                    mapping=mapping,
                    seed=seed,
                    ordinal=(last or 0) + offset,
                )
            )


def trial_ids(store: EngineStore, study: str) -> list[str]:
    """A study's trials in the order they were registered."""
    ordinal = listening_trials.c.ordinal
    with store.read() as connection:
        return list(
            connection.execute(
                sa.select(listening_trials.c.id)
                .where(store.mine(listening_trials), listening_trials.c.study == study)
                # a trial an older app added after the move has no number: after the rest
                .order_by(ordinal.is_(None), ordinal, listening_trials.c.id)
            ).scalars()
        )


def mapping(store: EngineStore, trial: str) -> str | None:
    """A trial's private mapping JSON, or None when there is no such trial."""
    with store.read() as connection:
        return connection.execute(
            sa.select(listening_trials.c.mapping).where(
                store.mine(listening_trials), listening_trials.c.id == trial
            )
        ).scalar()


def respond(
    store: EngineStore,
    trial: str,
    listener: str,
    choice: str,
    setup: str,
    grades: Sequence[tuple[str, int, str]],
) -> None:
    """One answer and its grades (option, grade, tags JSON), replacing this listener's earlier
    ones, in one write. ValueError, writing nothing, for a trial that isn't there."""
    with store.write() as connection:
        there = connection.execute(
            sa.select(listening_trials.c.id).where(
                store.mine(listening_trials), listening_trials.c.id == trial
            )
        ).first()
        if there is None:
            raise ValueError("Unknown listening trial")
        mine = sa.and_(
            store.mine(listening_responses),
            listening_responses.c.trial == trial,
            listening_responses.c.listener == listener,
        )
        stamp = now()
        changed = connection.execute(
            sa.update(listening_responses)
            .where(mine)
            .values(choice=choice, setup=setup, updated_at=stamp)
        ).rowcount
        if not changed:
            connection.execute(
                sa.insert(listening_responses).values(
                    workspace_id=store.workspace_id,
                    trial=trial,
                    listener=listener,
                    choice=choice,
                    setup=setup,
                    updated_at=stamp,
                )
            )
        connection.execute(
            sa.delete(listening_quality).where(
                store.mine(listening_quality),
                listening_quality.c.trial == trial,
                listening_quality.c.listener == listener,
            )
        )
        for option, grade, tags in grades:
            connection.execute(
                sa.insert(listening_quality).values(
                    workspace_id=store.workspace_id,
                    trial=trial,
                    listener=listener,
                    option=option,
                    grade=grade,
                    tags=tags,
                )
            )


def study_rows(store: EngineStore, study: str) -> dict[str, Any]:
    """What `listening.study_summary` counts, read at one moment: the trials and their mappings,
    each trial's answers, each answer's grades, and every condition's label."""
    with store.read() as connection:
        trials = [
            (row[0], row[1])
            for row in connection.execute(
                sa.select(listening_trials.c.id, listening_trials.c.mapping).where(
                    store.mine(listening_trials), listening_trials.c.study == study
                )
            )
        ]
        ids = [trial for trial, _mapping in trials]
        answers: dict[str, list[tuple[str, str]]] = {trial: [] for trial in ids}
        grades: dict[tuple[str, str], list[tuple[str, int]]] = {}
        if ids:
            for row in connection.execute(
                sa.select(
                    listening_responses.c.trial,
                    listening_responses.c.listener,
                    listening_responses.c.choice,
                ).where(store.mine(listening_responses), listening_responses.c.trial.in_(ids))
            ):
                answers[row[0]].append((row[1], row[2]))
            for row in connection.execute(
                sa.select(
                    listening_quality.c.trial,
                    listening_quality.c.listener,
                    listening_quality.c.option,
                    listening_quality.c.grade,
                ).where(store.mine(listening_quality), listening_quality.c.trial.in_(ids))
            ):
                grades.setdefault((row[0], row[1]), []).append((row[2], int(row[3])))
        labels = {
            row[0]: (row[1], row[2])
            for row in connection.execute(
                sa.select(
                    listening_methods.c.condition,
                    listening_methods.c.method,
                    listening_methods.c.renderer,
                ).where(store.mine(listening_methods))
            )
        }
    return {"trials": trials, "answers": answers, "grades": grades, "labels": labels}


def seam_grades(store: EngineStore) -> list[dict[str, Any]]:
    """Every 1 to 5 grade given to a condition that is a rendered seam of this workspace, with
    that seam's key: the join from a grade to the seam's facts (`seams.pair`)."""
    with store.read() as connection:
        keys = set(connection.execute(sa.select(seams.c.key).where(store.mine(seams))).scalars())
        named = {
            row[0]: row[1]
            for row in connection.execute(
                sa.select(listening_methods.c.condition, listening_methods.c.seam_key).where(
                    store.mine(listening_methods), listening_methods.c.seam_key.is_not(None)
                )
            )
        }
        mappings = {
            row[0]: json.loads(row[1])
            for row in connection.execute(
                sa.select(listening_trials.c.id, listening_trials.c.mapping).where(
                    store.mine(listening_trials)
                )
            )
        }
        rows = connection.execute(
            sa.select(
                listening_quality.c.trial,
                listening_quality.c.listener,
                listening_quality.c.option,
                listening_quality.c.grade,
                listening_quality.c.tags,
            )
            .where(store.mine(listening_quality))
            .order_by(listening_quality.c.trial, listening_quality.c.listener)
        ).all()
    found = []
    for trial, listener, option, grade, tags in rows:
        condition = mappings.get(trial, {}).get(option)
        key = named.get(condition, condition)
        if isinstance(key, str) and key in keys:
            found.append(
                {"key": key, "grade": int(grade), "tags": json.loads(tags), "listener": listener,
                 "trial": trial}
            )
    return found


def table_rows(store: EngineStore) -> dict[str, list[dict[str, Any]]]:
    """Every listening row of this workspace, by table, for the tests."""
    answer = {}
    with store.read() as connection:
        for table in LISTENING_TABLES:
            keys = list(table.primary_key.columns)
            rows = connection.execute(sa.select(table).where(store.mine(table)).order_by(*keys))
            answer[table.name] = [dict(row) for row in rows.mappings()]
    return answer


__all__ = [
    "add_methods",
    "create_trials",
    "mapping",
    "respond",
    "seam_grades",
    "study_rows",
    "table_rows",
    "trial_ids",
]
