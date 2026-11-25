"""Make SelectaDJ's Cloudflare error pages from one template (docs/engineering/branded-surfaces.md).

    uv run python infra/cloudflare/error-pages/build.py

Writes one self-contained HTML file per page next to this script: no outside files, so the page
still works when the site behind it is down, and well under Cloudflare's 1.5 MB limit. Each
carries the mark, plain words, Try again, a short reference to quote to support (made in the
browser, with the time, since Cloudflare's own pages never reach our servers) and the support
address. The mark settles into place once (CSS only, never looping, still under reduced motion);
no page retries on a timer, so none draws a countdown. Upload: Cloudflare dashboard, the zone,
Error Pages (or a Custom Error Rule for 5xx), "Fetch from URL" pointing at the published copy under https://selectadj.app/errors/.
"""

from __future__ import annotations

from html import escape
from pathlib import Path

HERE = Path(__file__).parent
# The published copy Cloudflare fetches from (https://selectadj.app/errors/...)
PUBLISHED = HERE.parents[2] / "web" / "public" / "errors"
SUPPORT = "support@selectadj.app"  # the one address, as web/src/support.ts

PAGES = {
    "5xx.html": (
        "SelectaDJ isn't answering",
        "SelectaDJ's service didn't answer just now. Your music, mixes and account are safe. "
        "Try again in a moment.",
        "",
    ),
    "1xxx.html": (
        "This address isn't working",
        "Something between you and SelectaDJ stopped this page from opening. Try again, or "
        "open selectadj.app.",
        "",
    ),
    "blocked.html": (
        "This request was stopped",
        "SelectaDJ's protection stopped this request. If you think it shouldn't have, write to "
        "support with the reference below.",
        "",
    ),
    "rate-limited.html": (
        "That's a lot of requests at once",
        "Wait a minute, then try again. If you keep seeing this, write to support with the "
        "reference below.",
        "",
    ),
    "challenge.html": (
        "One moment",
        "SelectaDJ is checking this browser before it carries on.",
        "::CF_WIDGET_BOX::",
    ),
}

MARK = (
    '<svg class="mark" width="40" height="40" viewBox="0 0 512 512" aria-hidden="true">'
    '<rect width="512" height="512" rx="96" fill="#100f0c"/>'
    '<circle class="disc" cx="256" cy="256" r="192" fill="#e8ff3a"/>'
    '<circle class="hole" cx="256" cy="256" r="51" fill="#100f0c"/></svg>'
)

STYLE = """
:root{color-scheme:dark light;--bg:#100f0c;--card:#1a1814;--ink:#f4f0e4;--soft:#a8a292;
--line:#3a362c;--lime:#e8ff3a;--lime-ink:#14140a}
@media (prefers-color-scheme:light){:root{--bg:#f5f2e9;--card:#fffdf6;--ink:#16140e;
--soft:#6a6555;--line:#d5cfbd}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);
color:var(--ink);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:520px;width:100%;padding:28px;border:1px solid var(--line);border-radius:10px;
background:var(--card)}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 20px;
font:900 20px/1 'Arial Black','Helvetica Neue',Impact,sans-serif}
h1{margin:0 0 12px;font:900 clamp(1.5rem,5vw,2rem)/1.15 'Arial Black','Helvetica Neue',Impact,
sans-serif}
p{margin:0 0 16px}
.soft{color:var(--soft);font-size:14px}
button{min-height:44px;padding:10px 18px;border:1px solid #16140e;border-radius:8px;
background:var(--lime);color:var(--lime-ink);font:600 16px/1 inherit;cursor:pointer}
button[aria-busy=true]{cursor:progress;opacity:.8}
a{color:inherit}
code{user-select:all}
.mark .disc,.mark .hole{transform-box:fill-box;transform-origin:center}
@media (prefers-reduced-motion:no-preference){
.mark .disc{animation:feel-mark-settle .56s cubic-bezier(.2,.9,.3,1.16) both}
.mark .hole{animation:feel-mark-settle .4s .2s cubic-bezier(.2,.9,.3,1.16) both}}
@keyframes feel-mark-settle{from{opacity:0;transform:scale(.4)}}
"""

SCRIPT = """
(function(){var l='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=new Uint8Array(8),c='';
if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(r);
for(var i=0;i<8;i++)c+=l[r[i]%l.length];var ref='R-'+c.slice(0,4)+'-'+c.slice(4),
t=new Date().toISOString();document.getElementById('ref').textContent=ref+' at '+t;
var a=document.getElementById('mail');a.href='mailto:SUPPORT?subject='+
encodeURIComponent(document.title)+'&body='+encodeURIComponent('Reference: '+ref+' at '+t+
'\\nPage: '+location.host+location.pathname);})();
"""


def page(title: str, words: str, widget: str) -> str:
    retry = (
        "" if widget else
        # the press says it is working while the page reloads, since a slow site can take a while
        "<p><button type=\"button\" onclick=\"this.setAttribute('aria-busy','true');"
        "this.textContent='Trying again…';location.reload()\">Try again</button></p>"
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)} | SelectaDJ</title><style>{STYLE}</style></head><body>"
        f'<main><p class="brand">{MARK}SelectaDJ</p><h1>{escape(title)}</h1>'
        f"<p>{escape(words)}</p>{widget}{retry}"
        f'<p class="soft">Reference to quote: <code id="ref"></code></p>'
        f'<p class="soft"><a id="mail" href="mailto:{SUPPORT}">Contact support</a> '
        f"at {SUPPORT}</p></main>"
        f"<script>{SCRIPT.replace('SUPPORT', SUPPORT)}</script></body></html>\n"
    )


def main() -> None:
    PUBLISHED.mkdir(parents=True, exist_ok=True)
    for name, (title, words, widget) in PAGES.items():
        html = page(title, words, widget)
        for folder in (HERE, PUBLISHED):
            (folder / name).write_text(html, encoding="utf-8", newline="\n")
        print(name)


if __name__ == "__main__":
    main()
