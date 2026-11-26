"""One name for the engine versions every hosted output hash carries (T-20261125-184c).

The API declares each job's output namespace from its own `ANALYSIS_VERSION`, `RENDER_VERSION`,
`PROXY_VERSION` and `EXPORT_VERSION`; a worker computes the hash it publishes under from its
own. During a deploy where the two differ, the worker's upload lands outside the declared
namespace, the gateway refuses the slot (`invalid_output_slots`) and the job fails. So:

- a worker reports `engine_build()` when it registers (`workers.remote`);
- the gateway (built from the same commit as the API) refuses a worker whose build differs,
  at registration and at every later claim or token refresh, with HTTP 409
  `engine_build_mismatch` naming both builds, and records it for the Workers page
  (`admin_metrics` `gateway.refused_build`, and `admin.hosted_status.gateway`'s
  `refused_builds`);
- the worker treats that answer as final and exits (`workers.remote.WorkerOutdated`), so its
  pool starts a fresh container on the image deployed now. Its jobs wait in the queue, they
  don't fail.

A worker that reports no build (one built before this rule) is let through, as before. The
deploy order that keeps the window short is in `docs/saas/launch-operator-checklist.md`: the API
and the gateway first, then `modal deploy` of the workers.
"""

from __future__ import annotations

MISMATCH = "engine_build_mismatch"
REFUSED_METRIC = "gateway.refused_build"


def engine_build() -> str:
    """`a<analysis>.r<render>.p<proxy>.x<export>`: equal on both sides, or outputs can't land."""
    from selecta.config import ANALYSIS_VERSION
    from selecta.seam_kinds import RENDER_VERSION
    from selecta.work.proxies import PROXY_VERSION
    from selecta.workers.export_join import EXPORT_VERSION

    return f"a{ANALYSIS_VERSION}.r{RENDER_VERSION}.p{PROXY_VERSION}.x{EXPORT_VERSION}"


__all__ = ["MISMATCH", "REFUSED_METRIC", "engine_build"]
