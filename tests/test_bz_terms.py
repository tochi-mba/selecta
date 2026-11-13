"""ADR-0449 BZ-0449-04/09: business terms acceptance, upload attestation, takedown strikes."""

from __future__ import annotations

import pytest

from selecta.business import terms
from selecta.business.commercial_audit import audit_rows
from selecta.business.commercial_facts import MemberFacts, OrgFacts, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES
from selecta.persistence import make_engine, metadata

T0 = 1_780_000_000.0
ORG = OrgFacts(
    "org1", "ws1", "Bar Group", venues=(VenueFacts("v1", "Soho"),),
    members=(MemberFacts("owner1", "owner"), MemberFacts("admin1", "admin"),
             MemberFacts("mgr1", "venue_manager", ("v1",)), MemberFacts("staff1", "staff")),
)
OTHER = OrgFacts("org2", "ws2", "New Owner", venues=(VenueFacts("v1", "Soho"),),
                 members=(MemberFacts("owner2", "owner"),))
V = terms.CURRENT_UPLOAD_STATEMENT_VERSION


@pytest.fixture()
def conn(tmp_path, monkeypatch):
    monkeypatch.delenv("SELECTA_REPEAT_INFRINGER_NOTICES", raising=False)
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


# BZ-0449-09 --------------------------------------------------------------------------------


def test_terms_constants():
    assert terms.CURRENT_BUSINESS_TERMS_VERSION in terms.BUSINESS_TERMS_VERSIONS
    assert terms.B2B_REFUND_POLICY_PATH.startswith("/")
    assert "SelectaDJ does not supply music" in terms.TERMS_SUMMARY


def test_accept_at_checkout_stores_version_time_actor(conn):
    assert terms.needs_acceptance(conn, "org1")
    assert terms.access(conn, "org1").management_blocked
    assert terms.access(conn, "org1").playback_allowed
    assert terms.accept(conn, ORG, terms.CURRENT_BUSINESS_TERMS_VERSION, "owner1", "checkout",
                        "abc123", now=T0)
    row = terms.acceptance(conn, "org1")
    assert (row["terms_version"], row["accepted_by"], row["accepted_at"], row["context"]) == (
        terms.CURRENT_BUSINESS_TERMS_VERSION, "owner1", T0, "checkout")
    assert row["ip_hash"] == "abc123"
    assert not terms.needs_acceptance(conn, ORG)
    access = terms.access(conn, "org1")
    assert not access.management_blocked and access.playback_allowed
    assert not terms.accept(conn, ORG, terms.CURRENT_BUSINESS_TERMS_VERSION, "admin1",
                            "sign_in", None, now=T0 + 1)
    assert len(audit_rows(conn, "org1", "terms.accepted")) == 1


def test_changed_version_blocks_management_not_playback(conn, monkeypatch):
    terms.accept(conn, ORG, terms.CURRENT_BUSINESS_TERMS_VERSION, "owner1", "checkout", None,
                 now=T0)
    monkeypatch.setattr(terms, "CURRENT_BUSINESS_TERMS_VERSION", "2027-01-01")
    monkeypatch.setattr(terms, "BUSINESS_TERMS_VERSIONS", ("2026-11-12", "2027-01-01"))
    assert terms.needs_acceptance(conn, "org1", "2027-01-01")
    blocked = terms.access(conn, "org1")
    assert blocked.management_blocked and blocked.playback_allowed
    terms.accept(conn, ORG, "2027-01-01", "admin1", "sign_in", None, now=T0 + 5)
    assert not terms.needs_acceptance(conn, "org1", "2027-01-01")


def test_accept_rules(conn):
    v = terms.CURRENT_BUSINESS_TERMS_VERSION
    with pytest.raises(terms.TermsForbidden):
        terms.accept(conn, ORG, v, "mgr1", "sign_in", None, now=T0)
    with pytest.raises(terms.TermsForbidden):
        terms.accept(conn, ORG, v, "staff1", "sign_in", None, now=T0)
    with pytest.raises(terms.TermsError):
        terms.accept(conn, ORG, "1999-01-01", "owner1", "sign_in", None, now=T0)
    with pytest.raises(terms.TermsError):
        terms.accept(conn, ORG, v, "owner1", "email", None, now=T0)


# BZ-0449-04 --------------------------------------------------------------------------------


def test_upload_attestation_recorded_and_required(conn):
    with pytest.raises(terms.UploadRefused):
        terms.require_upload_attestation(conn, "org1", "b1")
    with pytest.raises(terms.UploadRefused):
        terms.require_upload_attestation(conn, "org1", None)
    row = terms.record_upload_attestation(conn, ORG, "b1", "mgr1", 3, V, now=T0)
    assert row["uploader_id"] == "mgr1" and row["file_count"] == 3
    assert terms.require_upload_attestation(conn, "org1", "b1", uploader="mgr1",
                                            files_so_far=3)["batch_id"] == "b1"
    with pytest.raises(terms.UploadRefused):
        terms.require_upload_attestation(conn, "org1", "b1", files_so_far=4)
    with pytest.raises(terms.UploadRefused):
        terms.require_upload_attestation(conn, "org1", "b1", uploader="staff1")
    assert len(audit_rows(conn, "org1", "upload.attested")) == 1


def test_upload_attestation_rules(conn):
    with pytest.raises(terms.UploadRefused):
        terms.record_upload_attestation(conn, ORG, "b1", "mgr1", 3, V, now=T0, attested=False)
    with pytest.raises(terms.UploadRefused):
        terms.record_upload_attestation(conn, ORG, "b1", "mgr1", 3, "old", now=T0)
    with pytest.raises(terms.UploadRefused):
        terms.record_upload_attestation(conn, ORG, "b1", "mgr1", 0, V, now=T0)
    with pytest.raises(terms.TermsForbidden):
        terms.record_upload_attestation(conn, ORG, "b1", "stranger", 1, V, now=T0)
    terms.record_upload_attestation(conn, ORG, "b1", "mgr1", 1, V, now=T0)
    with pytest.raises(terms.UploadRefused):
        terms.record_upload_attestation(conn, ORG, "b1", "owner1", 1, V, now=T0)


def test_transferred_venue_new_org_must_reattest(conn):
    terms.record_upload_attestation(conn, ORG, "b1", "owner1", 2, V, now=T0, venue_id="v1")
    with pytest.raises(terms.UploadRefused):
        terms.require_upload_attestation(conn, "org2", "b1")
    terms.record_upload_attestation(conn, OTHER, "b2", "owner2", 2, V, now=T0, venue_id="v1")
    assert terms.require_upload_attestation(conn, "org2", "b2")


def test_takedown_strikes_follow_adr0413_threshold(conn, monkeypatch):
    from selecta.admin.takedowns import DEFAULT_REPEAT_NOTICES

    assert terms.repeat_threshold() == DEFAULT_REPEAT_NOTICES == 3
    terms.record_upload_attestation(conn, ORG, "b1", "owner1", 1, V, now=T0)
    for n in range(2):
        terms.record_takedown_strike(conn, ORG, notice_id=f"n{n}", actor="staff", now=T0)
    # The same notice never counts twice.
    assert terms.record_takedown_strike(conn, ORG, notice_id="n1", actor="staff", now=T0) == 2
    assert not terms.uploads_restricted(conn, "org1")
    assert terms.require_upload_attestation(conn, "org1", "b1")
    assert terms.record_takedown_strike(conn, ORG, notice_id="n2", actor="staff", now=T0) == 3
    assert terms.uploads_restricted(conn, "org1")
    assert not terms.uploads_restricted(conn, "org2")
    with pytest.raises(terms.UploadRefused) as err:
        terms.require_upload_attestation(conn, "org1", "b1")
    assert err.value.code == "uploads_restricted"
    with pytest.raises(terms.UploadRefused):
        terms.record_upload_attestation(conn, ORG, "b9", "owner1", 1, V, now=T0)
    monkeypatch.setenv("SELECTA_REPEAT_INFRINGER_NOTICES", "5")
    assert not terms.uploads_restricted(conn, "org1")
