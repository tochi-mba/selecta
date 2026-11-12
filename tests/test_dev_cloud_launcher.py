"""Cloud development launcher regression tests: safety, ports, services and cleanup."""

from __future__ import annotations

import argparse
from pathlib import Path
from types import SimpleNamespace

from selecta.devstack import launcher as cloud


def options(**overrides):
    data = dict(
        api_port=8733,
        identity_port=8742,
        site_port=5173,
        no_browser=True,
        check=True,
        verbose=False,
        startup_timeout=30.0,
        reuse_server=False,
        isolated=False,
        data_dir=None,
        seed=False,
    )
    data.update(overrides)
    return argparse.Namespace(**data)


def ops(tmp_path):
    records = {"start": [], "stop": [], "say": [], "install": 0}
    services = []
    script = SimpleNamespace(
        ROOT=tmp_path,
        WEB=tmp_path / "web",
        StartupError=RuntimeError,
        Probe=__import__("collections").namedtuple("Probe", "ok detail"),
        shutil=SimpleNamespace(which=lambda _name: "ffmpeg"),
        webbrowser=SimpleNamespace(open=lambda _url: True),
        require_pnpm=lambda: "pnpm",
        port_is_free=lambda _port: True,
        phase=lambda *_a: None,
        say=lambda *args: records["say"].append(args),
        install_site_tools=lambda _pnpm: records.__setitem__("install", records["install"] + 1),
        check_exits=lambda _services: None,
        format_service_state=lambda service, _now: service.name,
    )

    def start(name, command, cwd, env):
        process = SimpleNamespace(pid=1, poll=lambda: None)
        service = SimpleNamespace(
            name=name, process=process,
            last_lines=["[WORKER] Ready: claiming Cloud jobs from the local database."],
        )
        records["start"].append((name, command, cwd, env))
        services.append(service)
        return service

    script.start_service = start
    script.stop = lambda service: records["stop"].append(service.name)
    return script, records


def test_cloud_start_uses_real_api_worker_and_dev_only_identity(tmp_path, monkeypatch):
    host, records = ops(tmp_path)
    monkeypatch.setattr(cloud.guard, "problems", lambda _env: [])
    monkeypatch.setattr(cloud, "wait_cloud_ready", lambda *_a, **_kw: None)

    assert cloud.run_cloud(options(), host) == 0
    assert [row[0] for row in records["start"]] == ["IDENTITY", "API", "WORKER", "SITE"]
    assert records["stop"] == ["SITE", "WORKER", "API", "IDENTITY"]
    assert records["install"] == 1

    identity, api, worker, site = records["start"]
    assert "selecta.devstack.identity_server:application" in identity[1]
    assert "selecta.devstack.cloud_app:application" in api[1]
    assert worker[1][-1] == "selecta.devstack.worker"
    assert "vite.cloud-dev.config.ts" in site[1]
    for _name, _cmd, _cwd, env in records["start"]:
        assert env["SELECTA_ENV"] == "development"
        assert env["SELECTA_MODE"] == "cloud"
        assert env["SELECTA_DEV_API_URL"] == "http://127.0.0.1:8733"
        assert env["SELECTA_DEV_IDENTITY_URL"] == "http://127.0.0.1:8742"
        assert env["SELECTA_DEV_DATA"] == str(tmp_path / ".cache" / "selecta-cloud")
    assert site[3]["VITE_WORKOS_CLIENT_ID"] == cloud.CLIENT_ID


def test_seed_runs_only_after_api_migration_readiness(tmp_path, monkeypatch):
    host, _ = ops(tmp_path)
    steps = []
    monkeypatch.setattr(cloud.guard, "problems", lambda _env: [])
    monkeypatch.setattr(
        cloud, "wait_cloud_ready",
        lambda *args, **kwargs: steps.append(("ready", kwargs.get("worker_required", True))),
    )
    monkeypatch.setattr(
        cloud.subprocess, "run",
        lambda cmd, **kwargs: (
            steps.append(("seed", cmd, kwargs["env"]["SELECTA_DEV_DATA"]))
            or SimpleNamespace(returncode=0)
        ),
    )
    assert cloud.run_cloud(options(seed=True), host) == 0
    assert [item[0] for item in steps] == ["ready", "seed", "ready"]
    assert steps[0][1] is False
    assert steps[1][1][2] == "-c"
    assert "selecta.devstack.seed" in steps[1][1][-1]


def test_no_cloud_launch_when_live_credentials_are_configured(tmp_path, monkeypatch):
    host, records = ops(tmp_path)
    monkeypatch.setattr(
        cloud.guard, "problems",
        lambda _env: ["Live payment or identity credentials are not allowed."],
    )
    assert cloud.run_cloud(options(), host) == 1
    assert records["start"] == []
    assert any("Unsafe Cloud development environment" in line[1] for line in records["say"])


def test_reuse_server_and_shared_isolation_are_refused(tmp_path, monkeypatch):
    host, records = ops(tmp_path)
    monkeypatch.setattr(cloud.guard, "problems", lambda _env: [])
    assert cloud.run_cloud(options(reuse_server=True), host) == 1
    assert cloud.run_cloud(options(isolated=True, data_dir=str(tmp_path)), host) == 1
    assert records["start"] == []


def test_ports_do_not_collide_and_invalid_ports_fail(tmp_path):
    host, records = ops(tmp_path)
    taken = set()
    assert cloud._port(8733, taken, host) == 8733
    assert cloud._port(8733, taken, host) == 8734
    assert taken == {8733, 8734}
    try:
        cloud._port(0, taken, host)
        raise AssertionError("An invalid port was accepted.")
    except RuntimeError:
        pass
    assert any("using 8734" in line[1] for line in records["say"])


def test_cloud_site_config_is_dev_only_and_proxies_workos_and_objects():
    root = Path(__file__).resolve().parents[1]
    config = (root / "web/vite.cloud-dev.config.ts").read_text(encoding="utf-8")
    for name in ("'/api'", "'/dev-stripe'", "'/dev-objects'",
                 "'/user_management'", "'/dev/mail'"):
        assert name in config
    assert "src/devcloud/authkit.tsx" in config
    assert "@workos-inc/authkit-react" in config
    production = (root / "web/vite.config.ts").read_text(encoding="utf-8")
    assert "devcloud/authkit.tsx" not in production


def test_dev_cloud_auth_requires_matching_callback_state():
    root = Path(__file__).resolve().parents[1]
    adapter = (root / "web/src/devcloud/authkit.tsx").read_text(encoding="utf-8")
    assert "flow.state !== returnedState" in adapter
    assert "code_challenge_method: 'S256'" in adapter
    assert "grant_type: 'authorization_code'" in adapter
    assert "grant_type: 'refresh_token'" in adapter
    assert "localStorage.setItem(REFRESH_KEY" in adapter
