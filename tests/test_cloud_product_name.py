"""Cloud names the product as users see it, SelectaDJ; local mode keeps its own wording.

Lucy's fixed instructions and the evaluation subject's system prompt pick their opening by
`SELECTA_MODE`; the rules after it are the same in both modes. The Cloud API and worker gateway
publish their OpenAPI titles as SelectaDJ.
"""

from __future__ import annotations

from pathlib import Path
import re

from selecta.ai import eval_subject
from selecta.lucy import context

ROOT = Path(__file__).resolve().parents[1]


def test_lucy_says_selectadj_in_cloud_and_keeps_local_wording(monkeypatch):
    monkeypatch.delenv("SELECTA_MODE", raising=False)
    local = context.invariant()
    assert local == context.INVARIANT
    assert "inside Selecta, a local auto-DJ for one person's own music library." in local
    assert "SelectaDJ" not in local
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    cloud = context.invariant()
    assert cloud == context.CLOUD_INVARIANT
    assert cloud.startswith("You are Lucy, the mix-making helper inside SelectaDJ")
    assert "local auto-DJ" not in cloud
    # Everything after the opening sentence is the same rules in both modes.
    assert cloud.split("music library.", 1)[1] == local.split("music library.", 1)[1]


def test_the_evaluation_prompt_follows_the_mode(monkeypatch):
    monkeypatch.delenv("SELECTA_MODE", raising=False)
    assert eval_subject.system_prompt() == eval_subject.SYSTEM
    assert eval_subject.SYSTEM.startswith("You are Lucy, the DJ assistant in Selecta. ")
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    assert eval_subject.system_prompt() == eval_subject.CLOUD_SYSTEM
    assert eval_subject.CLOUD_SYSTEM.startswith("You are Lucy, the DJ assistant in SelectaDJ. ")
    assert eval_subject.CLOUD_SYSTEM.endswith(eval_subject.SYSTEM.split("Selecta.", 1)[1])


def test_cloud_services_title_themselves_selectadj():
    api = (ROOT / "src" / "selecta" / "api_cloud.py").read_text("utf-8")
    gateway = (ROOT / "src" / "selecta" / "gateway_cloud.py").read_text("utf-8")
    assert 'FastAPI(title="SelectaDJ API"' in api
    assert re.search(r'FastAPI\(\s*title="SelectaDJ Worker Gateway"', gateway)
