"""Alembic migrations for a Desktop library file (`selecta.sqlite`), run by `engine_store.library`.

A separate chain from the shared Cloud chain (`persistence/migrations`), with its own version
table, because a library file must never receive the Cloud's tables, nor a later Cloud migration
that alters them.
"""
