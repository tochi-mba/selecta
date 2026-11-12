"""The look of the local stand-in pages (sign-in, inbox, pretend checkout): SelectaDJ's own palette
in both themes, and a plain "Local developer" ribbon so nobody mistakes them for the real thing."""

from __future__ import annotations

from html import escape

from fastapi.responses import HTMLResponse

STYLE = """
:root{color-scheme:dark;--bg:#100f0c;--panel:#1a1814;--panel-2:#24211b;--line:#3a362c;
--ink:#f4f0e4;--soft:#a8a292;--accent:#e8ff3a;--accent-ink:#14140a;--warn:#ff7a4d;--ok:#9ed46a}
@media (prefers-color-scheme: light){:root{color-scheme:light;--bg:#f5f2e9;--panel:#fffdf6;
--panel-2:#ece8db;--line:#d5cfbd;--ink:#16140e;--soft:#6a6555;--accent:#2b2a14;
--accent-ink:#f5f2e9;--warn:#b93d10;--ok:#3d6b1c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);
font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
.dev-ribbon{background:var(--panel-2);color:var(--soft);font-size:.78rem;letter-spacing:.08em;
text-transform:uppercase;font-weight:700;padding:6px 16px;text-align:center;
border-bottom:1px solid var(--line)}
main{width:min(440px,100% - 32px);margin:48px auto;background:var(--panel);
border:1px solid var(--line);border-radius:16px;padding:28px}
main.wide{width:min(760px,100% - 32px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:850;font-size:1.1rem;margin-bottom:20px}
.mark{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;
background:var(--accent);color:var(--accent-ink);font-weight:900;font-size:19px}
h1{font-size:1.5rem;margin:0 0 8px;line-height:1.2}
p{margin:0 0 14px}.soft{color:var(--soft)}
form{display:grid;gap:14px;margin:18px 0}
label{display:grid;gap:6px;font-weight:600;font-size:.95rem}
label.check{display:flex;gap:10px;align-items:flex-start;font-weight:500}
input[type=email],input[type=password],input[type=text]{font:inherit;color:var(--ink);
background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);
outline-offset:2px}
button,.button{font:inherit;font-weight:700;border-radius:999px;padding:10px 18px;cursor:pointer;
border:1px solid var(--line);background:var(--panel-2);color:var(--ink);text-decoration:none;
display:inline-block;text-align:center}
button.primary,.button.primary{background:var(--accent);color:var(--accent-ink);
border-color:var(--accent)}
button.danger{border-color:var(--warn);color:var(--warn)}
a{color:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.divider{display:flex;align-items:center;gap:10px;color:var(--soft);font-size:.85rem;margin:16px 0}
.divider::before,.divider::after{content:"";flex:1;border-top:1px solid var(--line)}
.problem{color:var(--warn);font-weight:600}
.ok{color:var(--ok);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--soft);font-weight:600}
code{background:var(--panel-2);padding:1px 6px;border-radius:6px;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;font:inherit;color:var(--soft)}
"""

RIBBON = "Local developer stand-in. Nothing here leaves this computer."


def page(
    title: str,
    body: str,
    *,
    status: int = 200,
    wide: bool = False,
    ribbon: str = RIBBON,
) -> HTMLResponse:
    """A complete page. `body` is trusted HTML built by the caller with `escape()`."""
    return HTMLResponse(
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{escape(title)} | SelectaDJ</title><style>{STYLE}</style></head><body>"
        f"<div class='dev-ribbon' role='note'>{escape(ribbon)}</div>"
        f"<main class='{'wide' if wide else ''}'>"
        "<div class='brand'><span class='mark' aria-hidden='true'>S</span>SelectaDJ</div>"
        f"<h1>{escape(title)}</h1>{body}</main></body></html>",
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


__all__ = ["page"]
