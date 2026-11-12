"""T0001: archive what the pre-redesign app looked like and did, from a running main `911c981`.

    python tests/baseline_capture.py path/to/911c981/checkout [port]

The older checkout must have its page built (`web/dist`). A made-up library is built with this
checkout's `tests/e2e_server.py` (no real music), then the older checkout's own server serves it in
its own process, as `tests/rollback_check.py` does. From that running build this saves, into
`docs/baseline/911c981/`:

* `settings.json`: the older Settings defaults and what its server reports for steering, storage
  and status, plus what its page keeps in the browser;
* `api/*.json`: its answers to the main read routes (the route list and response shapes are also
  kept in `tests/fixtures/api_contracts_baseline.json`);
* `screens/*.png`: each main view at desktop and phone width;
* `playback-trace.json`: every sound the page started while playing the mix, and every audio file it
  fetched, as `web/e2e/baseline-capture.mjs` records them;
* `manifest.json`: the pinned commit, when and how it was captured, and every file above.

`tests/test_baseline_archive.py` checks the archive is complete.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "911c98106795e9ce0154afc8d9a53a886a8643ef"
OUT = ROOT / "docs" / "baseline" / "911c981"
READS = ["/api/status", "/api/storage", "/api/mix", "/api/drafts", "/api/requests", "/api/memory"]
SERVE = """
import sys, uvicorn
from pathlib import Path
from selecta.api import create_app
from selecta.config import Settings
home, dist, port = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
uvicorn.run(create_app(Settings(home), dist, prepare_links=False), host="127.0.0.1", port=port,
            log_level="warning")
"""
SETTINGS = """
import dataclasses, json, sys
from pathlib import Path
import selecta
from selecta.config import Settings
fields = {f.name: f.default for f in dataclasses.fields(Settings) if f.name != "home"}
print(json.dumps({"code_from": str(Path(selecta.__file__).parent), "defaults": fields}))
"""


def _get(base: str, path: str) -> object:
    with urllib.request.urlopen(base + path, timeout=30) as answer:  # noqa: S310 - local server
        return json.loads(answer.read().decode("utf-8"))


def _post(base: str, path: str) -> None:
    ask = urllib.request.Request(base + path, data=b"{}", method="POST")
    ask.add_header("content-type", "application/json")
    try:
        urllib.request.urlopen(ask, timeout=30).close()  # noqa: S310 - local server
    except OSError:
        pass


def main(argv: list[str]) -> int:
    older = Path(argv[0]).resolve()
    port = int(argv[1]) if len(argv) > 1 else 8931
    dist = older / "web" / "dist"
    if not (dist / "index.html").is_file():
        raise SystemExit(f"build the older page first: {dist} has no index.html")
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "PYTHONPATH": str(older / "src")}
    with tempfile.TemporaryDirectory(prefix="selecta-baseline-", ignore_cleanup_errors=True) as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        os.environ["SELECTA_HOME"] = str(home)
        sys.path.insert(0, str(Path(__file__).parent))
        from e2e_server import build

        build(home)
        older_settings = json.loads(
            subprocess.run(
                [sys.executable, "-c", SETTINGS],
                env=env,
                cwd=tmp,
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .splitlines()[-1]
        )
        if not older_settings["code_from"].startswith(str(older)):
            raise SystemExit(f"the settings came from {older_settings['code_from']}, not {older}")
        server = subprocess.Popen(
            [sys.executable, "-c", SERVE, str(home), str(dist), str(port)], env=env, cwd=tmp
        )
        try:
            for _ in range(120):
                try:
                    _get(base, "/api/status")
                    break
                except OSError:
                    time.sleep(1)
            else:
                raise SystemExit("the older server never answered")
            if OUT.exists():
                shutil.rmtree(OUT)
            (OUT / "api").mkdir(parents=True)
            files = []
            for path in READS:
                name = f"api/{path.removeprefix('/api/').replace('/', '-')}.json"
                (OUT / name).write_text(json.dumps(_get(base, path), indent=1), "utf-8")
                files.append(name)
            status = _get(base, "/api/status")
            settings = {
                "settings_defaults": older_settings["defaults"],
                "steering": status.get("steering") if isinstance(status, dict) else None,
                "storage": _get(base, "/api/storage"),
            }
            # every seam rendered first, so the trace includes a transition being played
            _post(base, "/api/mix/render")
            browser = subprocess.run(
                ["node", "e2e/baseline-capture.mjs", base, str(OUT)],
                cwd=ROOT / "web",
                capture_output=True,
                text=True,
                check=False,
                shell=os.name == "nt",
            )
            if browser.returncode:
                raise SystemExit(f"the browser capture failed:\n{browser.stdout}{browser.stderr}")
            captured = json.loads(browser.stdout.strip().splitlines()[-1])
            settings["browser_storage"] = captured["storage"]
            (OUT / "settings.json").write_text(json.dumps(settings, indent=1), "utf-8")
            files += ["settings.json", "playback-trace.json", *captured["screens"]]
            manifest = {
                "task": "T0001",
                "commit": BASELINE,
                "captured": time.strftime("%Y-%m-%d"),
                "how": "tests/baseline_capture.py: the 911c981 checkout's own server and built page, "
                "serving a made-up library from tests/e2e_server.py, in headless Edge",
                "contracts": "tests/fixtures/api_contracts_baseline.json",
                "files": sorted(files),
            }
            (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), "utf-8")
            print(f"archived {len(files)} files in {OUT}")
            return 0
        finally:
            server.terminate()
            server.wait(timeout=30)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
