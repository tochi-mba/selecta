"""The infrastructure code describes the stack ADR-0409 chose (SC-0409-01, SC-0409-02).

Parsed and checked here without the vendors' tools: the Render blueprint (YAML), the OpenTofu
for Cloudflare (structure and invariants; `tofu validate` runs where OpenTofu is installed), the
Modal worker app (Python syntax and settings), the service image and the smoke test. Recreating
staging from these files is the step a person still does with real accounts.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import httpx
import pytest
import yaml
from cloud_helpers import make_cloud_app
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
INFRA = ROOT / "infra"
sys.path.insert(0, str(INFRA / "deploy"))
import smoke  # noqa: E402

ENVIRONMENTS = ("staging", "production")


def blueprint() -> dict:
    return yaml.safe_load((INFRA / "render" / "render.yaml").read_text("utf-8"))


def environments() -> dict[str, dict]:
    (project,) = blueprint()["projects"]
    return {env["name"]: env for env in project["environments"]}


def test_render_has_staging_and_a_protected_production():
    found = environments()
    assert set(found) == set(ENVIRONMENTS)
    assert found["production"]["protectedEnvironment"] is True


@pytest.mark.parametrize("name", ENVIRONMENTS)
def test_render_runs_api_gateway_and_two_maintenance_copies_in_frankfurt(name):
    env = environments()[name]
    services = {service["dockerCommand"].split()[1]: service for service in env["services"]}
    assert set(services) == {"web", "gateway", "maintain"}
    assert all(service["region"] == "frankfurt" for service in env["services"])
    assert services["web"]["healthCheckPath"] == services["gateway"]["healthCheckPath"]
    assert services["maintain"]["type"] == "worker" and services["maintain"]["numInstances"] == 2
    (database,) = env["databases"]
    assert database["region"] == "frankfurt" and database["ipAllowList"] == []
    # Each service reads its own database URL variable from this environment's database.
    for service in env["services"]:
        urls = [item for item in service["envVars"] if "fromDatabase" in item]
        assert [item["fromDatabase"]["name"] for item in urls] == [database["name"]]


def test_no_audio_worker_runs_on_render():
    for env in environments().values():
        for service in env["services"]:
            assert "selecta.workers" not in service["dockerCommand"]
            assert service["dockerCommand"].split()[1] in {"web", "gateway", "maintain"}


def test_render_never_holds_a_secret_value_in_the_repo():
    for group in blueprint()["envVarGroups"]:
        for item in group["envVars"]:
            secretish = re.search(r"KEY|SECRET|TOKEN|PEPPER|HEADERS|URL|HOSTS|ORIGINS|ISSUER|"
                                  r"AUDIENCE|PRICES|CLIENT_ID", item["key"])
            if secretish:
                assert item.get("sync") is False and "value" not in item, item["key"]


def test_every_env_var_render_sets_is_one_the_code_reads():
    read = set()
    for path in (ROOT / "src" / "selecta").rglob("*.py"):
        read |= set(re.findall(r'"((?:SELECTA|OTEL|ANTHROPIC)_[A-Z0-9_]+)"',
                               path.read_text("utf-8")))
    read.add("OTEL_EXPORTER_OTLP_HEADERS")  # read by the OpenTelemetry exporter itself
    set_by_render = {item["key"] for group in blueprint()["envVarGroups"]
                     for item in group["envVars"]}
    for env in environments().values():
        for service in env["services"]:
            set_by_render |= {item["key"] for item in service["envVars"] if "key" in item}
    assert sorted(set_by_render - read) == []


def render_service(env: dict, command: str) -> dict:
    (service,) = [s for s in env["services"] if s["dockerCommand"].split()[1] == command]
    return service


def render_items(env: dict, command: str) -> list[dict]:
    """Every variable a service gets: its own and those of the groups it pulls in."""
    service = render_service(env, command)
    groups = {group["name"]: group["envVars"] for group in blueprint()["envVarGroups"]}
    found = []
    for item in service["envVars"]:
        found += groups[item["fromGroup"]] if "fromGroup" in item else [item]
    return found


def render_values(env: dict, command: str) -> dict[str, str]:
    return {item["key"]: item["value"] for item in render_items(env, command) if "value" in item}


_R2 = ("SELECTA_R2_ACCOUNT_ID", "SELECTA_R2_ACCESS_KEY_ID", "SELECTA_R2_SECRET_ACCESS_KEY",
       "SELECTA_R2_JURISDICTION", "SELECTA_R2_BUCKET_ORIGINALS", "SELECTA_R2_BUCKET_DERIVED",
       "SELECTA_R2_BUCKET_EXPORTS", "SELECTA_R2_BUCKET_STAGING")
_OTEL = ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS")


def read_at_start() -> dict[str, set[str]]:
    """What each Render service reads when it starts (docs/saas/launch-operator-checklist.md
    Section 11, Required column, plus telemetry). Names come from the code where it has them."""
    from selecta.admin import dmca
    from selecta.observability.leader_metrics import BACKUP_ENV
    from selecta.rooms.wiring import PEPPER_ENV
    from selecta.work.autoscale_leader import MODAL_ENV

    return {
        "web": {
            "SELECTA_MODE", "SELECTA_ENV", "SELECTA_DATABASE_URL", "SELECTA_ALLOWED_HOSTS",
            "SELECTA_ALLOWED_ORIGINS", "SELECTA_WORKOS_CLIENT_ID", "SELECTA_AUTH_ISSUER",
            "SELECTA_AUTH_AUDIENCE", "SELECTA_WORKOS_API_KEY", "SELECTA_WORKOS_WEBHOOK_SECRET",
            PEPPER_ENV, "SELECTA_STRIPE_SECRET_KEY", "SELECTA_STRIPE_WEBHOOK_SECRETS",
            "SELECTA_STRIPE_PRICES", "SELECTA_CHECKOUT_CONSENT_VERSION", "SELECTA_IP_HASH_KEY",
            "ANTHROPIC_API_KEY", "SELECTA_STAFF_ORGANIZATION_ID", "SELECTA_CLIENT_IP_HEADER",
            *_R2, *_OTEL,
        },
        "gateway": {
            "SELECTA_MODE", "SELECTA_ENV", "SELECTA_GATEWAY_DATABASE_URL",
            "SELECTA_GATEWAY_ALLOWED_HOSTS", "SELECTA_WORKER_TOKEN_SECRET",
            "SELECTA_WORKER_BOOTSTRAP_TOKEN", *_R2, *_OTEL,
        },
        "maintain": {
            "SELECTA_MODE", "SELECTA_ENV", "SELECTA_MAINTENANCE_DATABASE_URL",
            "SELECTA_STRIPE_SECRET_KEY", "SELECTA_STRIPE_PRICES", "SELECTA_WORKOS_API_KEY",
            "SELECTA_R2_BUCKET_DELETION_LEDGER", PEPPER_ENV, *BACKUP_ENV, *MODAL_ENV, dmca.ENV,
            *_R2, *_OTEL,
        },
    }


@pytest.mark.parametrize("name", ENVIRONMENTS)
def test_every_variable_a_service_reads_at_start_is_declared_in_the_blueprint(name):
    env = environments()[name]
    for command, needed in read_at_start().items():
        declared = {item["key"] for item in render_items(env, command)}
        assert sorted(needed - declared) == [], (name, command)


def test_the_checklist_lists_what_each_render_service_reads():
    """The test's lists and the operator checklist's Required column name the same settings, so
    a new one has to land in both (and so in the blueprint)."""
    doc = (ROOT / "docs" / "saas" / "launch-operator-checklist.md").read_text("utf-8")
    rows = {"web": "| Cloud API on Render", "gateway": "| Worker gateway on Render",
            "maintain": "| Maintenance service"}
    for command, start in rows.items():
        (row,) = [line for line in doc.splitlines() if line.startswith(start)]
        required = row.split("|")[2]
        named = set(re.findall(r"(?:SELECTA|ANTHROPIC)_[A-Z0-9_]+", required))
        fallbacks = {"SELECTA_DATABASE_URL"} if command != "web" else set()
        assert sorted(named - fallbacks - read_at_start()[command]) == [], command


# --- OpenTofu ---------------------------------------------------------------------------------


def tofu() -> str:
    files = sorted((INFRA / "cloudflare").glob("*.tf"))
    return "\n".join(path.read_text("utf-8") for path in files)


def _without_strings(text: str) -> str:
    text = re.sub(r"#.*", "", text)
    return re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)


def test_the_opentofu_is_balanced():
    for path in (INFRA / "cloudflare").glob("*.tf"):
        bare = _without_strings(path.read_text("utf-8"))
        for opening, closing in ("{}", "[]", "()"):
            assert bare.count(opening) == bare.count(closing), (path.name, opening)


def resources(kind: str) -> dict[str, str]:
    found = {}
    for match in re.finditer(rf'resource "{kind}" "(\w+)" \{{(.*?)\n\}}', tofu(), re.S):
        found[match.group(1)] = match.group(2)
    return found


def test_every_r2_bucket_is_in_the_eu_jurisdiction_and_backups_live_in_another_account():
    buckets = resources("cloudflare_r2_bucket")
    assert {"data", "backup", "db_dumps"} <= set(buckets)
    for name, body in buckets.items():
        assert 'jurisdiction  = "eu"' in body, name
    for name in ("backup", "db_dumps"):
        assert "provider      = cloudflare.backup" in buckets[name]
        assert "var.backup_account_id" in buckets[name]
        assert '"InfrequentAccess"' in buckets[name]
    assert "var.account_id" in buckets["data"]


def test_the_edge_has_pages_dns_and_rate_limits():
    assert resources("cloudflare_pages_project")
    assert {"api", "gateway", "web"} <= set(resources("cloudflare_dns_record"))
    (rules,) = resources("cloudflare_ruleset").values()
    assert '"http_ratelimit"' in rules


def test_every_variable_used_is_declared_and_each_environment_sets_the_rest():
    text = tofu()
    declared = set(re.findall(r'variable "(\w+)"', text))
    used = set(re.findall(r"var\.(\w+)", text))
    assert used <= declared
    with_default = set(re.findall(r'variable "(\w+)" \{[^}]*default', text, re.S))
    from_env = {"cloudflare_api_token", "backup_api_token", "account_id", "backup_account_id",
                "zone_id"}  # TF_VAR_* from release.sh, never in a file
    for name in ENVIRONMENTS:
        tfvars = (INFRA / "cloudflare" / "env" / f"{name}.tfvars").read_text("utf-8")
        given = set(re.findall(r"^(\w+)\s*=", tfvars, re.M))
        assert given | with_default | from_env == declared, name
        assert f'environment           = "{name}"' in tfvars
        assert not given & from_env
        assert (INFRA / "cloudflare" / "env" / f"{name}.backend.hcl").is_file()
    assert set(re.findall(r'export TF_VAR_(\w+)=', (INFRA / "deploy" / "release.sh")
                          .read_text("utf-8"))) == from_env


def test_no_secret_value_is_written_in_the_opentofu():
    assert not re.search(r'(token|secret|key)\s*=\s*"[^"$]', tofu(), re.I)


def tofu_bucket_names(environment: str) -> dict[str, str]:
    """The R2 bucket names main.tf creates for an environment, read from its locals."""
    text = tofu()
    (local,) = re.findall(r"^locals \{(.*?)\n\}", text, re.S | re.M)
    (prefix,) = re.findall(r'prefix\s*=\s*"([^"]+)"', local)
    (kinds,) = re.findall(r"buckets\s*=\s*\[([^\]]*)\]", local)
    stem = prefix.replace("${var.environment}", environment)
    names = {kind: f"{stem}-{kind}" for kind in re.findall(r'"([\w-]+)"', kinds)}
    assert '"${local.prefix}-db-dumps"' in text
    names["db-dumps"] = f"{stem}-db-dumps"
    return names


@pytest.mark.parametrize("name", ENVIRONMENTS)
def test_storage_defaults_and_the_blueprint_name_the_buckets_opentofu_creates(name, monkeypatch):
    from selecta.storage import api as storage_api

    made = tofu_bucket_names(name)
    for kind in ("originals", "derived", "exports", "staging"):
        assert storage_api.default_bucket(kind, name) == made[kind]
        monkeypatch.delenv(f"SELECTA_R2_BUCKET_{kind.upper()}", raising=False)
    monkeypatch.setenv("SELECTA_ENV", name)
    resolved = storage_api.buckets()
    assert (resolved.originals, resolved.derived, resolved.exports, resolved.staging) == (
        made["originals"], made["derived"], made["exports"], made["staging"])
    env = environments()[name]
    for command in ("web", "gateway", "maintain"):
        values = render_values(env, command)
        assert values["SELECTA_ENV"] == name, command
        for kind in ("originals", "derived", "exports", "staging"):
            assert values[f"SELECTA_R2_BUCKET_{kind.upper()}"] == made[kind], (command, kind)
    maintain = render_values(env, "maintain")
    assert maintain["SELECTA_R2_BUCKET_DELETION_LEDGER"] == made["deletion-ledger"]
    assert maintain["SELECTA_BACKUP_BUCKET"] == made["db-dumps"]


def test_r2_cors_allows_only_the_app_origin_to_get_put_and_read_etags():
    (cors,) = resources("cloudflare_r2_bucket_cors").values()
    assert 'toset(["originals", "derived", "exports", "staging"])' in cors
    assert "deletion-ledger" not in cors
    assert "cloudflare_r2_bucket.data[each.key].name" in cors
    assert 'jurisdiction = "eu"' in cors
    (origins,) = re.findall(r"origins\s*=\s*\[([^\]]*)\]", cors)
    assert re.findall(r'"([^"]*)"', origins) == ["https://${var.web_hostname}"]
    (methods,) = re.findall(r"methods\s*=\s*\[([^\]]*)\]", cors)
    assert sorted(re.findall(r'"(\w+)"', methods)) == ["GET", "HEAD", "PUT"]
    (exposed,) = re.findall(r"expose_headers\s*=\s*\[([^\]]*)\]", cors)
    assert re.findall(r'"([^"]*)"', exposed) == ["ETag"]
    assert "*" not in cors


# --- Modal and the image ----------------------------------------------------------------------


def modal_functions() -> dict[str, ast.FunctionDef]:
    source = (INFRA / "modal" / "selecta_workers.py").read_text("utf-8")
    return {node.name: node for node in ast.parse(source).body
            if isinstance(node, ast.FunctionDef)
            and any("app.function" in ast.unparse(d) for d in node.decorator_list)}


def served_pool(node: ast.FunctionDef) -> str:
    (pool,) = re.findall(r"_serve\('([\w-]+)'\)", ast.unparse(node))
    return pool


def test_the_modal_app_runs_every_pool_in_the_eu_and_scales_to_zero():
    source = (INFRA / "modal" / "selecta_workers.py").read_text("utf-8")
    functions = modal_functions()
    assert {"cpu_light", "cpu_heavy", "gpu_stems"} <= set(functions)
    for node in functions.values():
        (decorator,) = node.decorator_list
        text = ast.unparse(decorator)
        assert "region=REGION" in text and "min_containers=0" in text
    assert 'REGION = "eu"' in source
    pools = set(re.findall(r'_serve\("([\w-]+)"\)', source))
    assert pools == {"cpu-light", "cpu-heavy", "gpu", "export"}


def test_the_autoscaler_scales_exactly_the_functions_the_modal_app_deploys():
    """`MODAL_FUNCTIONS` is the one mapping; each name must be a deployed function serving that
    pool, every pool in pools.json needs one, and a pool with a fallback launch needs both."""
    import json

    from selecta.work.autoscale_leader import MODAL_FUNCTIONS, POOLS_FILE

    functions = modal_functions()
    named = set()
    for pool, (primary, fallback) in MODAL_FUNCTIONS.items():
        for name in filter(None, (primary, fallback)):
            assert name in functions, (pool, name)
            assert served_pool(functions[name]) == pool, (pool, name)
            named.add(name)
    assert named == set(functions)
    pools = json.loads(POOLS_FILE.read_text("utf-8"))["pools"]
    assert set(MODAL_FUNCTIONS) == set(pools)
    for pool, config in pools.items():
        assert (MODAL_FUNCTIONS[pool][1] is not None) == bool(config.get("fallback")), pool
    (gpu,) = [node for name, node in functions.items() if name == MODAL_FUNCTIONS["gpu"][0]]
    assert "gpu='T4'" in ast.unparse(gpu.decorator_list[0])
    assert "gpu=" not in ast.unparse(functions[MODAL_FUNCTIONS["gpu"][1]].decorator_list[0])


def test_the_modal_app_name_is_the_one_maintenance_scales():
    source = (INFRA / "modal" / "selecta_workers.py").read_text("utf-8")
    assert 'modal.App(f"selecta-workers-{ENVIRONMENT}"' in source
    for name, env in environments().items():
        assert render_values(env, "maintain")["SELECTA_MODAL_APP"] == f"selecta-workers-{name}"


def test_the_worker_reads_the_pool_the_modal_function_names(monkeypatch):
    source = (ROOT / "src" / "selecta" / "workers" / "cloud.py").read_text("utf-8")
    assert 'os.environ.get("SELECTA_WORKER_POOL", "cpu-light")' in source


def test_the_service_image_runs_as_a_user_and_installs_the_locked_closure():
    dockerfile = (INFRA / "docker" / "service.Dockerfile").read_text("utf-8")
    assert "uv export --frozen --no-dev --extra observability" in dockerfile
    assert re.search(r"^USER selecta$", dockerfile, re.M)
    assert "SELECTA_MODE=cloud" in dockerfile


def test_the_service_image_can_install_every_index_the_lock_uses():
    """An exported requirements file drops pyproject's extra indexes, so the image must pass any
    the lock depends on, or the build can't find (for example) torch's CPU-only wheels."""
    import tomllib

    dockerfile = (INFRA / "docker" / "service.Dockerfile").read_text("utf-8")
    project = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))
    for index in project.get("tool", {}).get("uv", {}).get("index", []):
        assert f"--extra-index-url {index['url']}" in dockerfile, index["name"]


def test_the_service_image_copies_every_file_the_package_build_reads():
    """Building the package needs the readme (and any licence file) pyproject names; the deploy on
    main failed with 'Readme file does not exist: README.md' when the image left it out."""
    import tomllib

    dockerfile = (INFRA / "docker" / "service.Dockerfile").read_text("utf-8")
    project = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))["project"]
    copied = " ".join(re.findall(r"^COPY (.+)$", dockerfile, re.M))
    needed = [project["readme"]] if isinstance(project.get("readme"), str) else []
    needed += project.get("license-files", [])
    for name in needed:
        assert re.search(rf"(^|\s){re.escape(name)}(\s|$)", copied), name
        assert (ROOT / name).exists(), name


# --- Smoke test -------------------------------------------------------------------------------


def _bridge(apps: dict[str, object]) -> httpx.MockTransport:
    clients = {host: TestClient(app) for host, app in apps.items()}

    def forward(request: httpx.Request) -> httpx.Response:
        answer = clients[request.url.host].request(
            request.method, request.url.path, headers={
                key: value for key, value in request.headers.items() if key.lower() != "host"})
        return httpx.Response(answer.status_code, headers=answer.headers,
                              content=answer.content, request=request)

    return httpx.MockTransport(forward)


def test_the_smoke_test_passes_against_the_real_api_and_fails_when_a_service_is_down(tmp_path):
    app, engine, _ = make_cloud_app(tmp_path)
    try:
        def gateway(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/ready":
                return httpx.Response(200, json={"status": "ready"})
            return httpx.Response(401, json={"detail": {"code": "worker_auth_required"}})

        api = _bridge({"api.test": app})
        transport = httpx.MockTransport(
            lambda request: gateway(request) if request.url.host == "gateway.test"
            else api.handle_request(request))
        results = smoke.run("https://api.test", "https://gateway.test", transport=transport)
        assert [check.ok for check in results] == [True] * 4, results

        down = httpx.MockTransport(
            lambda request: httpx.Response(503) if request.url.host == "gateway.test"
            else api.handle_request(request))
        results = smoke.run("https://api.test", "https://gateway.test", transport=down)
        assert not all(check.ok for check in results)
    finally:
        engine.dispose()
