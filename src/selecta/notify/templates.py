"""The words of every SelectaDJ email, as plain text and simple HTML.

Each email says what happened, what (if anything) the person can do, and links back to the app
when `SELECTA_EMAIL_SITE_URL` is set. Nothing private beyond what the person already owns goes
in: no song titles, file names or other people's details. Sizes are decimal GB, as the app shows.
"""

from __future__ import annotations

from datetime import UTC, datetime
from html import escape

from selecta.notify.mail import COMPANY, SENDER_NAME, Message

FOOTER = f"{SENDER_NAME} is a {COMPANY} product. You get this email about your own account."


def _link(site_url: str, path: str) -> str:
    return f"{site_url.rstrip('/')}{path}" if site_url else ""


def _gb(size: int) -> str:
    return f"{size / 1e9:.1f} GB"


def _day(epoch_s: float) -> str:
    moment = datetime.fromtimestamp(epoch_s, UTC)
    return f"{moment.day} {moment:%B %Y}"


def _message(
    *, to: str, kind: str, key: str, subject: str, lines: list[str], action: tuple[str, str]
) -> Message:
    label, url = action
    text = "\n\n".join([*lines, *([f"{label}: {url}"] if url else []), FOOTER])
    html = _branded_html(subject, lines, label, url)
    return Message(to=to, subject=subject, text=text, html=html, kind=kind, idempotency_key=key)


# The brand kit's colours (web/public/brand/BRAND.md). Emails use the Light palette, which every
# mail client renders, and say `color-scheme: light dark` so a client in dark mode may adapt it;
# the button keeps its dark ink on the lime and its dark edge either way.
_PAGE, _CARD, _INK, _SOFT, _LIME, _LIME_INK, _EDGE = (
    "#f5f2e9", "#fffdf6", "#16140e", "#6a6555", "#e8ff3a", "#14140a", "#16140e"
)
_FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _branded_html(subject: str, lines: list[str], label: str, url: str) -> str:
    """One email page in the brand: the mark and name, the words, one button, the footer."""
    origin = "/".join(url.split("/")[:3]) if url.startswith("https://") else ""
    mark = (
        f'<img src="{escape(origin, quote=True)}/brand/png/email-logo-96.png" width="32" '
        'height="32" alt="" style="vertical-align:middle;border:0;margin-right:10px">'
        if origin else ""
    )
    paragraphs = "".join(
        f'<p style="margin:0 0 16px;color:{_INK};font:16px/1.5 {_FONT}">{escape(line)}</p>'
        for line in lines
    )
    button = (
        f'<p style="margin:24px 0 8px"><a href="{escape(url, quote=True)}" '
        f'style="display:inline-block;padding:12px 20px;border:1px solid {_EDGE};'
        f"border-radius:8px;background:{_LIME};color:{_LIME_INK};font:600 16px/1.2 {_FONT};"
        f'text-decoration:none">{escape(label)}</a></p>'
        if url else ""
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        f"<title>{escape(subject)}</title></head>"
        f'<body style="margin:0;padding:24px 12px;background:{_PAGE}">'
        f'<div style="max-width:560px;margin:0 auto">'
        f'<p style="margin:0 0 16px;font:900 20px/1 {_FONT};color:{_INK}">{mark}SelectaDJ</p>'
        f'<div style="padding:24px;border:1px solid #d5cfbd;border-radius:10px;'
        f'background:{_CARD}">{paragraphs}{button}</div>'
        f'<p style="margin:16px 0 0;color:{_SOFT};font:12px/1.5 {_FONT}">{escape(FOOTER)}</p>'
        "</div></body></html>"
    )


def job_label(job_type: str) -> str:
    """A person's words for a job type (`render_mix` becomes "render mix")."""
    return job_type.replace("_", " ").replace(".", " ").strip() or "job"


def long_job_finished(
    *, to: str, key: str, job_type: str, minutes: int, site_url: str = ""
) -> Message:
    label = job_label(job_type)
    return _message(
        to=to,
        kind="long_job_finished",
        key=key,
        subject=f"Your {label} is ready",
        lines=[
            f"Your {label} finished after about {minutes} minutes.",
            f"It is ready in {SENDER_NAME} whenever you are.",
        ],
        action=(f"Open {SENDER_NAME}", _link(site_url, "/")),
    )


def over_quota(
    *, to: str, key: str, used_bytes: int, limit_bytes: int, site_url: str = ""
) -> Message:
    over = max(0, used_bytes - limit_bytes)
    return _message(
        to=to,
        kind="over_quota",
        key=key,
        subject=f"Your {SENDER_NAME} storage is full",
        lines=[
            f"You are using {_gb(used_bytes)} of your plan's {_gb(limit_bytes)}, "
            f"{_gb(over)} over.",
            "Nothing has been deleted. You can still play, mix and download everything, "
            "but new uploads and exports wait until you free some space or change your plan.",
        ],
        action=("Manage storage", _link(site_url, "/workshop/storage")),
    )


def storage_deletion_warning(
    *, to: str, key: str, days_left: int, delete_on: float, site_url: str = ""
) -> Message:
    """Sent 60, 30 and 7 days before the published retention policy would delete originals
    (docs/saas/05-storage-uploads-playback.md)."""
    day = _day(delete_on)
    return _message(
        to=to,
        kind="storage_deletion_warning",
        key=key,
        subject=f"Your {SENDER_NAME} uploads will be deleted in {days_left} days",
        lines=[
            "Your account has been over its storage limit for a long time with no plan that "
            "covers it.",
            f"Under our published retention policy, your uploaded songs will be deleted on "
            f"{day} unless you free some space or choose a plan that fits.",
            "You can download everything before then.",
        ],
        action=("Download or keep your music", _link(site_url, "/workshop/storage")),
    )


def silent_zone_alert(
    *, to: str, key: str, venue: str, zone: str, silent_minutes: int, site_url: str = ""
) -> Message:
    """For venue staff when a zone that should be playing has been silent
    (docs/saas/19a-venue-operations.md)."""
    return _message(
        to=to,
        kind="silent_zone_alert",
        key=key,
        subject=f"{zone} at {venue} is silent",
        lines=[
            f"{zone} at {venue} should be playing but has been silent for "
            f"{silent_minutes} minutes.",
            "Check the player in that zone is on and connected.",
        ],
        action=("Open the venue", _link(site_url, "/business/zones")),
    )


__all__ = [
    "FOOTER",
    "job_label",
    "long_job_finished",
    "over_quota",
    "silent_zone_alert",
    "storage_deletion_warning",
]
