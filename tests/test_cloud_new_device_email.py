"""A new device signed in: one email per device, never for the first, never to a kiosk
(product audit item 3, docs/saas/16-edge-cases.md Accounts)."""

from __future__ import annotations

import time

from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.notify import device_mail, emails
from selecta.notify.mail import RecordingSender
from selecta.persistence import new_id, transaction
from selecta.playback.schema import devices


def _person(engine):
    now = time.time()
    claims = Claims(subject="user_devices", issued_at=now, expires_at=now + 3600,
                    email="person@example.com", email_verified=True)
    with transaction(engine) as conn:
        return accounts.provision(conn, claims, age_confirmed=True, timezone="Europe/London")


def _device(engine, principal, name, created_at, person=True):
    with transaction(engine) as conn:
        conn.execute(devices.insert().values(
            id=new_id(), workspace_id=principal.workspace.id,
            user_id=principal.user.id if person else None,
            principal="person" if person else "kiosk", name=name, kind="laptop",
            capabilities={}, created_at=created_at, last_seen_at=created_at,
        ))


def test_the_second_device_mails_once_and_the_first_does_not(cloud_engine, monkeypatch):
    monkeypatch.setattr(emails, "enabled", lambda: True)
    monkeypatch.setattr(device_mail, "on", lambda: True)
    principal = _person(cloud_engine)
    now = time.time()
    _device(cloud_engine, principal, "Chrome on Windows", now - 60)
    sender = RecordingSender()
    emails.run(cloud_engine, sender)
    assert [m.kind for m in sender.sent if m.kind == "new_device"] == []
    _device(cloud_engine, principal, "Safari on iPhone", now)
    emails.run(cloud_engine, sender)
    emails.run(cloud_engine, sender)
    mailed = [m for m in sender.sent if m.kind == "new_device"]
    assert len(mailed) == 1
    assert "Safari on iPhone" in mailed[0].text
    assert "sign out everywhere" in mailed[0].text


def test_a_kiosk_never_mails_and_the_flag_off_sends_nothing(cloud_engine, monkeypatch):
    monkeypatch.setattr(emails, "enabled", lambda: True)
    principal = _person(cloud_engine)
    now = time.time()
    _device(cloud_engine, principal, "Chrome on Windows", now - 60)
    _device(cloud_engine, principal, "Kiosk", now, person=False)
    monkeypatch.setattr(device_mail, "on", lambda: True)
    with transaction(cloud_engine) as conn:
        assert device_mail.due(conn, now) == []
    _device(cloud_engine, principal, "Firefox on Linux", now)
    monkeypatch.setattr(device_mail, "on", lambda: False)
    sender = RecordingSender()
    emails.run(cloud_engine, sender)
    assert [m for m in sender.sent if m.kind == "new_device"] == []
