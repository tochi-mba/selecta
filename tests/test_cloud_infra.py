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
        read |= set(re.findall(r'"((?:SELECTA|OTEL)_[A-Z0-9_]+)"', path.read_text("utf-8")))
    read.add("OTEL_EXPORTER_OTLP_HEADERS")  # read by the OpenTelemetry exporter itself
    set_by_render = {item["key"] for group in blueprint()["envVarGroups"]
                     for item in group["envVars"]}
    for env in environments().values():
        for service in env["services"]:
            set_by_render |= {item["key"] for item in service["envVars"] if "key" in item}
    assert sorted(set_by_render - read) == []


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


# --- Modal and the image ----------------------------------------------------------------------


def test_the_modal_app_runs_every_pool_in_the_eu_and_scales_to_zero():
    source = (INFRA / "modal" / "selecta_workers.py").read_text("utf-8")
    tree = ast.parse(source)
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and any("app.function" in ast.unparse(d) for d in node.decorator_list)}
    assert set(functions) == {"cpu_light", "cpu_heavy", "gpu_stems"}
    for node in functions.values():
        (decorator,) = node.decorator_list
        text = ast.unparse(decorator)
        assert "region=REGION" in text and "min_containers=0" in text
    assert 'REGION = "eu"' in source
    pools = set(re.findall(r'_serve\("([\w-]+)"\)', source))
    assert pools == {"cpu-light", "cpu-heavy", "gpu"}


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
