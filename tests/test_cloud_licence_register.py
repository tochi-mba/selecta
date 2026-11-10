"""Every package, tool and model the Cloud images ship has a licence row (SC-0405-01, ADR-0405).

The worker image installs the runtime closure of `uv.lock` (see `infra/modal/selecta_workers.py`),
so a row per locked package is a row per thing in the image. Models go through the allowlist,
and every weights loader in the source asks it first.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from selecta.audit import licence_register
from selecta.modes import models

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "saas" / "licence-register.md"
WORKER_IMAGE = ROOT / "infra" / "modal" / "selecta_workers.py"
LOADS_WEIGHTS = re.compile(
    r"torch\.load\(|load_state_dict\(|torch\.hub|from_pretrained\(|\.get_model\(|File2Beats|"
    r"Audio2Beats|WAV2VEC2|demucs\.(separate|pretrained|api)|-m\", \"demucs"
)


def test_every_locked_runtime_package_has_a_row_with_its_locked_version():
    register = licence_register.load()
    locked = licence_register.locked_packages()
    rows = register["packages"]
    assert sorted(set(locked) - set(rows)) == [], "run licence_register.py --write"
    assert sorted(set(rows) - set(locked)) == [], "rows for packages that left the lock"
    stale = {name: (rows[name]["version"], version) for name, version in locked.items()
             if rows[name]["version"] != version}
    assert stale == {}
    assert licence_register.refreshed(register) == register


def test_every_row_has_a_licence_and_a_known_status():
    register = licence_register.load()
    for section in ("packages", "system_tools"):
        for name, row in register[section].items():
            assert row["status"] in licence_register.STATUSES, name
            assert row["licence"], name
            if row["status"] != "allowed":
                assert row.get("note"), f"{name}: say why it needs review"


def test_the_observability_extra_is_part_of_the_image_and_the_register():
    locked = licence_register.locked_packages()
    assert {"opentelemetry-sdk", "opentelemetry-exporter-otlp-proto-http"} <= set(locked)


def test_the_worker_image_installs_exactly_the_locked_closure_and_ffmpeg():
    source = WORKER_IMAGE.read_text("utf-8")
    assert "uv export" in source and "--no-dev" in source and "--extra observability" in source
    assert "--frozen" in source
    tools = licence_register.load()["system_tools"]
    for tool in re.findall(r'apt_install\(([^)]*)\)', source):
        for name in re.findall(r'"([^"]+)"', tool):
            assert name in tools, f"system tool {name} has no licence row"


def test_the_human_register_names_only_packages_the_machine_register_has():
    table = DOC.read_text("utf-8").split("## Python dependencies (runtime)", 1)[1].split("\n## ")[0]
    named = set()
    for line in table.splitlines():
        if line.startswith("| ") and "---" not in line and not line.startswith("| Package"):
            first = line.strip("|").split("|")[0].strip()
            named |= {part.strip() for part in first.split(",") if part.strip()}
    named -= {"Rubber Band (via pedalboard)"}
    assert named and sorted(named - set(licence_register.load()["packages"])) == []
    assert "licence_register.json" in DOC.read_text("utf-8")


def _loaders() -> list[Path]:
    return sorted(
        path for path in (ROOT / "src" / "selecta").rglob("*.py")
        if LOADS_WEIGHTS.search(path.read_text("utf-8"))
        and path.name not in {"licence_register.py"}
    )


def test_every_weights_loader_asks_the_model_allowlist_first():
    loaders = _loaders()
    assert {path.name for path in loaders} >= {"key.py", "beats.py", "align.py"}
    missing = [str(path.relative_to(ROOT)) for path in loaders
               if "require_model(" not in path.read_text("utf-8")]
    assert missing == []


def test_every_model_id_a_loader_names_is_in_the_register():
    named: set[str] = set()
    for path in (ROOT / "src" / "selecta").rglob("*.py"):
        named |= set(re.findall(r'require_model\(f?"([^"]+)"', path.read_text("utf-8")))
    assert named
    register = models.register()
    for model_id in named:
        if "{" in model_id:
            prefix = model_id.split("{", 1)[0]
            assert any(known.startswith(prefix) for known in register), model_id
        else:
            assert model_id in register, model_id


@pytest.mark.parametrize("model_id", ["someone.elses_model", "skey", "demucs.htdemucs"])
def test_cloud_mode_refuses_a_model_the_register_does_not_allow(model_id):
    with pytest.raises(models.ModelNotAllowed):
        models.require_model(model_id, "cloud")


def test_the_register_file_is_valid_json_with_its_pointer_to_the_models():
    data = json.loads(licence_register.REGISTER.read_text("utf-8"))
    assert (ROOT / data["models"]).is_file()
