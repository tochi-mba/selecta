"""Telling members before Lucy's allowance changes (ADR-0487 rule 11, LM-0487-05).

A paid workspace's owner gets one email per switch, however often the task runs and however
long ago the first run was; Free gets the note in the product only. The record that an email
went is `lucy_usage_state.notice_sent_at`, not the outbox (which forgets after seven days).
Nothing is sent for real: `RecordingSender` keeps the messages.
"""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, CAROL, auth
from test_lucy_cloud import lucy, songs  # noqa: F401

from selecta import flags
from selecta.ai import usage_mode, usage_rollout
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_state
from selecta.billing.schema import entitlement_snapshots
from selecta.flags.matching import Rule, RuleKind, RuleSnapshot
from selecta.identity.schema import users, workspaces
from selecta.notify import billing_mail, emails, lucy_usage_mail, mail
from selecta.notify.mail import EmailError, RecordingSender
from selecta.persistence import db_now, new_id, transaction
from selecta.work.schema import outbox_events

pytest_plugins = ("cloud_party",)

NOW = 1_800_000_000.0
DAY = 86_400.0
SWITCH = NOW + 20 * DAY + 6 * 3600  # 5 February in Auckland, 4 February in Los Angeles
PAID, FREE = "ws-paid", "ws-free"
ZONE = "Pacific/Auckland"
NO_RULES = RuleSnapshot(1, {})


def add_workspace(conn, workspace: str, plan: str | None, *, zone: str = ZONE) -> None:
    owner = f"owner-{workspace}"
    conn.execute(users.insert().values(
        id=owner, auth_subject=f"auth|{owner}", email=f"{owner}@example.com",
        email_verified=True, timezone=zone, age_confirmed=True, created_at=NOW - DAY,
    ))
    conn.execute(workspaces.insert().values(
        id=workspace, name="Mine", kind="personal", owner_user_id=owner, created_at=NOW - DAY,
    ))
    if plan is not None:
        conn.execute(entitlement_snapshots.insert().values(
            id=new_id(), workspace_id=workspace, version=1, plan_id=plan, plan_version=None,
            source="stripe", reason="active", computed_at=NOW - DAY, verified_at=NOW - DAY,
        ))


def set_switch(engine, workspace: str, at: float = SWITCH, plan: str = "standard",
               now: float = NOW) -> None:
    with transaction(engine, workspace) as conn:
        usage_mode.set_cutover(conn, workspace, at=at, plan_id=plan, now=now)


@pytest.fixture
def engine(cloud_engine, monkeypatch):
    """A Standard workspace and a Free one, both with a switch twenty days ahead, email on."""
    monkeypatch.setattr(mail, "enabled", lambda: True)
    with transaction(cloud_engine) as conn:
        add_workspace(conn, PAID, "standard")
        add_workspace(conn, FREE, None)
    set_switch(cloud_engine, PAID)
    set_switch(cloud_engine, FREE, plan="free")
    return cloud_engine


def noticed(engine, workspace: str = PAID) -> float | None:
    with transaction(engine) as conn:
        return conn.execute(sa.select(lucy_usage_state.c.notice_sent_at).where(
            lucy_usage_state.c.workspace_id == workspace)).scalar_one()


def forget_outbox(engine) -> None:
    """What seven days do to the outbox: the `email.sent` events are gone."""
    with transaction(engine) as conn:
        conn.execute(outbox_events.delete().where(outbox_events.c.topic == emails.TOPIC))


def test_a_paid_workspace_is_emailed_once_however_often_the_task_runs_and_free_never(engine):
    sender = RecordingSender()
    first = lucy_usage_mail.run(engine, sender, now=NOW)
    again = lucy_usage_mail.run(engine, sender, now=NOW + 60)

    assert (first.sent, again.sent) == (1, 0)
    assert [message.to for message in sender.sent] == [f"owner-{PAID}@example.com"]
    assert [message.kind for message in sender.sent] == [lucy_usage_mail.KIND]
    assert noticed(engine) == NOW and noticed(engine, FREE) is None


def test_the_email_is_not_repeated_after_the_outbox_has_forgotten_it(engine):
    sender = RecordingSender()
    lucy_usage_mail.run(engine, sender, now=NOW)
    forget_outbox(engine)

    later = lucy_usage_mail.run(engine, sender, now=NOW + 8 * DAY)

    assert later.sent == 0 and len(sender.sent) == 1


def test_the_email_names_the_date_in_the_owners_zone_and_says_the_price_does_not_change(engine):
    sender = RecordingSender()
    lucy_usage_mail.run(engine, sender, "https://app.example", now=NOW)
    message = sender.sent[0]
    day = billing_mail.day_in(SWITCH, ZONE)

    assert day != billing_mail.day_in(SWITCH, "America/Los_Angeles")  # the zone matters here
    assert day in message.subject and day in message.text and day in message.html
    assert "The price of your plan does not change." in message.text
    assert "five-hour session" in message.text and "each week" in message.text
    assert "Standard" in message.text
    assert "https://app.example/account" in message.text
    assert chr(0x2014) not in message.text + message.subject
    assert message.idempotency_key == lucy_usage_mail.key_for(PAID, SWITCH)


@pytest.mark.parametrize("at", [None, NOW - 60, NOW], ids=["none", "past", "this instant"])
def test_no_switch_ahead_means_no_email(engine, at):
    with transaction(engine) as conn:
        conn.execute(sa.update(lucy_usage_state).values(cutover_at=at))
    sender = RecordingSender()
    assert lucy_usage_mail.run(engine, sender, now=NOW).sent == 0
    assert sender.sent == [] and noticed(engine) is None


@pytest.mark.parametrize("undo", ["withdraw", "cancel"])
def test_a_switch_that_is_taken_away_and_set_again_is_told_again(engine, undo):
    sender = RecordingSender()
    lucy_usage_mail.run(engine, sender, now=NOW)
    with transaction(engine) as conn:
        if undo == "withdraw":
            assert usage_rollout.withdraw(conn, NO_RULES, NOW + DAY) == 2
        else:
            assert usage_rollout.cancel(conn, PAID, NOW + DAY) is True
    assert noticed(engine) is None
    assert lucy_usage_mail.run(engine, sender, now=NOW + 2 * DAY).sent == 0  # no switch now

    set_switch(engine, PAID, at=SWITCH + 31 * DAY, now=NOW + 3 * DAY)
    assert lucy_usage_mail.run(engine, sender, now=NOW + 3 * DAY).sent == 1
    assert len(sender.sent) == 2
    assert sender.sent[0].idempotency_key != sender.sent[1].idempotency_key


@pytest.mark.parametrize("change", [
    {"email_verified": False}, {"deleted_at": NOW - 5}, {"email": None}, {"email": "not-an-email"},
], ids=["unverified", "deleted", "no address", "bad address"])
def test_an_owner_who_cannot_be_mailed_gets_nothing_and_is_not_tried_again(engine, change):
    with transaction(engine) as conn:
        conn.execute(users.update().where(users.c.id == f"owner-{PAID}").values(**change))
    sender = RecordingSender()

    first = lucy_usage_mail.run(engine, sender, now=NOW)
    again = lucy_usage_mail.run(engine, sender, now=NOW + 60)

    assert sender.sent == []
    assert (first.sent, first.unreachable) == (0, 1)
    assert (again.sent, again.unreachable) == (0, 0)  # marked, so not looked at again
    assert noticed(engine) == NOW


def test_with_the_email_flag_off_nothing_is_sent_and_nothing_is_marked(engine, monkeypatch):
    monkeypatch.setattr(mail, "enabled", lambda: False)
    sender = RecordingSender()
    assert lucy_usage_mail.run(engine, sender, now=NOW) == lucy_usage_mail.RunResult()
    assert sender.sent == [] and noticed(engine) is None

    monkeypatch.setattr(mail, "enabled", lambda: True)  # switched on later, it still goes
    assert lucy_usage_mail.run(engine, sender, now=NOW + DAY).sent == 1


class Failing:
    def __init__(self, retry: bool) -> None:
        self.retry, self.tries = retry, 0

    def send(self, message) -> str:
        self.tries += 1
        raise EmailError("no", retry=self.retry)


def test_a_send_the_provider_cannot_take_yet_is_tried_again_next_run(engine):
    busy = Failing(retry=True)
    assert lucy_usage_mail.run(engine, busy, now=NOW).deferred == 1
    assert noticed(engine) is None

    sender = RecordingSender()
    assert lucy_usage_mail.run(engine, sender, now=NOW + 60).sent == 1
    assert noticed(engine) == NOW + 60


def test_a_send_refused_for_good_is_not_tried_again(engine):
    refusing = Failing(retry=False)
    assert lucy_usage_mail.run(engine, refusing, now=NOW).refused == 1
    assert lucy_usage_mail.run(engine, refusing, now=NOW + 60).refused == 0
    assert refusing.tries == 1 and noticed(engine) == NOW


def test_a_crash_after_the_mark_cannot_send_a_second_email(engine):
    class Crash(Exception):
        pass

    class Dying:
        def send(self, message) -> str:
            raise Crash

    with pytest.raises(Crash):
        lucy_usage_mail.run(engine, Dying(), now=NOW)
    sender = RecordingSender()
    assert lucy_usage_mail.run(engine, sender, now=NOW + 60).sent == 0
    assert noticed(engine) == NOW


def test_only_one_caller_wins_the_mark(engine):
    with transaction(engine) as conn:
        assert usage_rollout.mark_noticed(conn, PAID, NOW) is True
        assert usage_rollout.mark_noticed(conn, PAID, NOW + 1) is False
        assert usage_rollout.mark_noticed(conn, "nobody", NOW) is False
        assert [due.workspace_id for due in usage_rollout.due_notices(conn, NOW)] == []


def test_a_plan_that_became_paid_before_the_switch_is_told(engine):
    with transaction(engine) as conn:
        assert [due.workspace_id for due in usage_rollout.due_notices(conn, NOW)] == [PAID]
        conn.execute(entitlement_snapshots.insert().values(
            id=new_id(), workspace_id=FREE, version=1, plan_id="premium", plan_version=None,
            source="stripe", reason="active", computed_at=NOW, verified_at=NOW,
        ))
        found = {due.workspace_id: due.plan_id for due in usage_rollout.due_notices(conn, NOW)}
    assert found == {PAID: "standard", FREE: "premium"}


def test_the_emails_task_sends_the_notice_once(cloud_engine, monkeypatch):
    monkeypatch.setattr(mail, "enabled", lambda: True)
    monkeypatch.setattr(emails, "enabled", lambda: True)
    monkeypatch.setattr(billing_mail, "on", lambda: False)  # only this notice is looked at
    with transaction(cloud_engine) as conn:
        add_workspace(conn, PAID, "standard")
        real_now = db_now(conn)
    set_switch(cloud_engine, PAID, at=real_now + 20 * DAY, now=real_now)
    sender = RecordingSender()

    assert emails.run(cloud_engine, sender).sent == 1
    assert emails.run(cloud_engine, sender).sent == 0
    assert [message.kind for message in sender.sent] == [lucy_usage_mail.KIND]


def test_two_task_runs_racing_send_one_email(postgres_engine, monkeypatch):
    monkeypatch.setattr(mail, "enabled", lambda: True)
    with transaction(postgres_engine) as conn:
        add_workspace(conn, PAID, "standard")
    set_switch(postgres_engine, PAID)
    sender, ready, errors, sent = RecordingSender(), threading.Barrier(4), [], []

    def one() -> None:
        try:
            ready.wait(timeout=30)
            sent.append(lucy_usage_mail.run(postgres_engine, sender, now=NOW).sent)
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert sorted(sent) == [0, 0, 0, 1] and len(sender.sent) == 1


# In the product ----------------------------------------------------------------------------------


def test_the_settings_route_tells_free_and_paid_alike_of_a_switch_ahead(lucy):  # noqa: F811
    flags.use("+cloud.local_media +lucy.cloud_conversation +lucy.usage_shadow")
    granted = [lucy.workspaces[ALICE], lucy.workspaces[CAROL]]  # Premium and Free
    rule = Rule(RuleKind.WORKSPACES, {"ids": granted, "on": True})
    lucy.app.state.flag_rules = RuleSnapshot(1, {WINDOWS_FLAG: (rule,)})
    ahead = {}
    for token, plan in ((ALICE, "premium"), (CAROL, "free")):
        workspace = lucy.workspaces[token]
        with transaction(lucy.engine, workspace) as conn:
            now = db_now(conn)
            ahead[token] = now + 20 * DAY
            usage_mode.set_cutover(conn, workspace, at=ahead[token], plan_id=plan, now=now)

    for token in (ALICE, CAROL):
        body = lucy.client.get("/api/account/lucy", headers=auth(token)).json()
        assert body["usage_cutover"]["at"] == ahead[token]
        assert body["usage_cutover"]["time_zone"]
        assert "usage_windows" not in body  # still on turns until the date
    assert "usage_cutover" not in lucy.client.get("/api/account/lucy", headers=auth(BOB)).json()

    lucy.app.state.flag_rules = NO_RULES  # the grant went: no promise is left on the page
    assert "usage_cutover" not in lucy.client.get("/api/account/lucy", headers=auth(ALICE)).json()
