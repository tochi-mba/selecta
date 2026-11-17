"""Hosted-media coexistence for Browser-first Cloud (ADR-0456, ADR-0464, ADR-0465).

- `grandfather`: the completed-upload population, its `cloud.hosted_media` grant rules in the
  runbook's order, and their audit (BF-0465-01).
- `grant`: whether a workspace holds `cloud.hosted_media` without a signed-in principal, the
  predicate quota and meters consult so storage binds only where it costs (BF-0464-02,
  BF-0456-06).
"""

from selecta.hosted_coexistence.grandfather import (
    GRANDFATHER_SALT,
    DetectedWorkspace,
    GrandfatherAudit,
    GrandfatherWorkspace,
    audit_grandfather_rules,
    build_grandfather_rules,
    detected_workspaces,
)
from selecta.hosted_coexistence.grant import (
    hosted_media_decision,
    hosted_media_granted,
    hosted_media_predicate,
)

__all__ = [
    "GRANDFATHER_SALT",
    "DetectedWorkspace",
    "GrandfatherAudit",
    "GrandfatherWorkspace",
    "audit_grandfather_rules",
    "build_grandfather_rules",
    "detected_workspaces",
    "hosted_media_decision",
    "hosted_media_granted",
    "hosted_media_predicate",
]
