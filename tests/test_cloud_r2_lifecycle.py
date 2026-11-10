"""R2 bucket lifecycle rules as code (ADR-0397 SC-0397-05).

`infra/r2/lifecycle.tf.json` (OpenTofu JSON for the Cloudflare provider) must abort incomplete
multipart uploads in staging after 1 day, delete staged objects after 2, and expire exports no
later than the longest plan keeps them. These tests parse it and check it against the storage
key layout and the plan catalogue. Applying it and the staging check are separate.
"""

from __future__ import annotations

import json
from pathlib import Path

from selecta.billing.plans import CATALOGUE
from selecta.storage.artifacts import DEFAULT_BUCKETS
from selecta.storage.keys import export_key, staging_key

LIFECYCLE = Path(__file__).resolve().parents[1] / "infra" / "r2" / "lifecycle.tf.json"
DAY = 86_400


def config() -> dict:
    return json.loads(LIFECYCLE.read_text("utf-8"))


def rules(bucket: str) -> list[dict]:
    return config()["resource"]["cloudflare_r2_bucket_lifecycle"][bucket]["rules"]


def ages(bucket: str, transition: str, key: str) -> list[int]:
    return [
        rule[transition]["condition"]["max_age"]
        for rule in rules(bucket)
        if rule["enabled"] and transition in rule and key.startswith(rule["conditions"]["prefix"])
    ]


def test_every_bucket_is_managed_with_the_names_the_app_uses():
    data = config()
    resources = data["resource"]["cloudflare_r2_bucket_lifecycle"]
    assert set(resources) == {"originals", "derived", "exports", "staging"}
    for name, resource in resources.items():
        assert resource["bucket_name"] == f"${{var.bucket_{name}}}"
        assert data["variable"][f"bucket_{name}"]["default"] == getattr(DEFAULT_BUCKETS, name)
        ids = [rule["id"] for rule in resource["rules"]]
        assert len(ids) == len(set(ids))
        for rule in resource["rules"]:
            for transition in ("abort_multipart_uploads_transition", "delete_objects_transition"):
                if transition in rule:
                    assert rule[transition]["condition"]["type"] == "Age"


def test_staging_aborts_multipart_after_one_day_and_deletes_after_two():
    key = staging_key("0" * 32)
    assert ages("staging", "abort_multipart_uploads_transition", key) == [DAY]
    assert ages("staging", "delete_objects_transition", key) == [2 * DAY]


def test_exports_expire_no_later_than_the_longest_plan_keeps_them():
    key = export_key("1" * 32, "2" * 32)
    longest = max(plan.export_retention_days for plans in CATALOGUE.values() for plan in plans)
    assert longest == 90
    assert ages("exports", "delete_objects_transition", key) == [longest * DAY]
    assert ages("exports", "abort_multipart_uploads_transition", key) == [DAY]


def test_originals_and_derived_never_expire_by_rule():
    for bucket in ("originals", "derived"):
        assert all("delete_objects_transition" not in rule for rule in rules(bucket))
        assert ages(bucket, "abort_multipart_uploads_transition", "w/x") == [DAY]
