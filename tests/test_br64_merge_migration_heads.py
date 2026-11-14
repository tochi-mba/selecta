"""Cloud migration graph regression for browser control and business people.

The two feature branches were integrated in parallel. A valid Cloud migration must
apply *both* before exposing a single 'head' on new and pre-existing databases.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic.script import ScriptDirectory

from selecta.persistence import make_engine, migrate

MERGED = "br64merge01"


def test_cloud_has_one_migration_head():
    graph = ScriptDirectory.from_config(migrate._config())
    assert graph.get_heads() == [MERGED]
    assert migrate.head() == MERGED
    merge = graph.get_revision(MERGED)
    assert set(merge.down_revision) == {"br6406ctrl01", "bz0452role01"}


@pytest.mark.parametrize("applied_branch", ["br6406ctrl01", "bz0452role01"])
def test_cloud_merge_upgrades_either_existing_branch_without_losing_data(
    tmp_path, applied_branch,
):
    engine = make_engine(f"sqlite:///{tmp_path / f'{applied_branch}.sqlite'}")
    try:
        # A real personal user exists before the two parallel schema expansions.
        migrate.upgrade(engine, "merge_0416_heads")
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO users "
                "(id, auth_subject, email_verified, timezone, age_confirmed, created_at) "
                "VALUES ('preserved-user', 'test|preserved', 1, 'Europe/London', 1, 1)"
            )

        migrate.upgrade(engine, applied_branch)
        migrate.upgrade(engine)

        assert migrate.current(engine) == MERGED
        inspector = sa.inspect(engine)
        assert inspector.has_table("lf_browser_devices")
        assert inspector.has_table("lf_browser_commands")
        assert inspector.has_table("business_members")
        assert inspector.has_table("business_sso_connections")
        with engine.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT id, auth_subject FROM users WHERE id = 'preserved-user'"
            ).one() == ("preserved-user", "test|preserved")
    finally:
        engine.dispose()


def test_cloud_clean_install_applies_both_branches(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'fresh-cloud.sqlite'}")
    try:
        migrate.upgrade(engine)
        assert migrate.current(engine) == MERGED
        tables = set(sa.inspect(engine).get_table_names())
        assert {
            "lf_browser_sessions", "lf_browser_commands",
            "business_members", "business_sso_connections",
        } <= tables
    finally:
        engine.dispose()
