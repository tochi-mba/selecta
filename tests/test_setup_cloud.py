from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("setup_cloud", ROOT / "setup_cloud.py")
assert SPEC and SPEC.loader
setup_cloud = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = setup_cloud
SPEC.loader.exec_module(setup_cloud)


def test_inventory_names_are_unique_and_cover_launch_credentials():
    names = [item.name for item in setup_cloud.SETTINGS]
    assert len(names) == len(set(names))
    assert {
        "ANTHROPIC_API_KEY",
        "SELECTA_DATABASE_URL",
        "SELECTA_WORKOS_API_KEY",
        "SELECTA_STRIPE_SECRET_KEY",
        "SELECTA_R2_SECRET_ACCESS_KEY",
        "SELECTA_WORKER_BOOTSTRAP_TOKEN",
        "VITE_SELECTA_API_ORIGIN",
        "RENDER_API_KEY",
    } <= set(names)


def test_vite_settings_are_never_marked_secret():
    assert all(not item.secret for item in setup_cloud.SETTINGS if item.name.startswith("VITE_"))


def test_vault_round_trip_with_isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_SETUP_HOME", str(tmp_path))
    values = {"ANTHROPIC_API_KEY": "secret", "VITE_WORKOS_CLIENT_ID": "client_1"}
    setup_cloud.save_values("staging", values)
    assert setup_cloud.load_values("staging") == values
    if setup_cloud.os.name != "nt":
        assert setup_cloud.vault_path("staging").stat().st_mode & 0o777 == 0o600


def test_dotenv_quote_escapes_multiline_values():
    assert setup_cloud.dotenv_quote('a"b\\c\nd') == '"a\\"b\\\\c\\nd"'


def test_every_group_has_an_acquisition_guide():
    assert {item.group for item in setup_cloud.SETTINGS} == set(setup_cloud.SETUP_GUIDES)


def test_every_setting_has_field_level_instructions():
    names = {item.name for item in setup_cloud.SETTINGS}
    assert set(setup_cloud.FIELD_GUIDES) == names
    assert all(setup_cloud.FIELD_GUIDES[name] for name in names)


def test_workos_guide_explains_issuer_and_audience_source():
    guide = setup_cloud.SETUP_GUIDES["WorkOS"][1]
    # the issuer is WorkOS's per-client address, and a token is tied to the application by its
    # client_id claim (37bee97b); the guide used to send the reader to the discovery document
    assert "https://api.workos.com/user_management/<client_id>" in guide
    assert "client_id claim" in guide
    assert "client ID" in guide


def test_values_for_domain_uses_consistent_production_and_staging_hosts():
    production = setup_cloud.values_for_domain("selectadj.app", "production")
    staging = setup_cloud.values_for_domain("selectadj.app", "staging")
    assert production["SELECTA_ALLOWED_ORIGINS"] == "https://app.selectadj.app"
    assert production["VITE_SELECTA_API_ORIGIN"] == "https://api.selectadj.app"
    assert production["VITE_WORKOS_API_HOSTNAME"] == "auth.selectadj.app"
    assert staging["SELECTA_ALLOWED_ORIGINS"] == "https://app.staging.selectadj.app"
    assert staging["SELECTA_WORKER_GATEWAY_URL"] == "https://gateway.staging.selectadj.app"


def test_values_for_domain_rejects_urls():
    try:
        setup_cloud.values_for_domain("https://selectadj.app", "production")
    except ValueError:
        pass
    else:
        raise AssertionError("a URL must not be accepted as an apex domain")


def test_fill_known_values_preserves_existing_and_copies_workos_client(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_SETUP_HOME", str(tmp_path))
    setup_cloud.save_values(
        "staging",
        {
            "SELECTA_WORKOS_CLIENT_ID": "client_staging",
            "SELECTA_ROOMS_PEPPER": "keep-me",
        },
    )
    setup_cloud.fill_known_values("resend", "SelectaDJ <mail@selectadj.app>")
    staging = setup_cloud.load_values("staging")
    production = setup_cloud.load_values("production")
    assert staging["SELECTA_ROOMS_PEPPER"] == "keep-me"
    assert staging["VITE_WORKOS_CLIENT_ID"] == "client_staging"
    assert staging["SELECTA_R2_BUCKET_ORIGINALS"] == "selecta-staging-originals"
    assert production["SELECTA_R2_BUCKET_ORIGINALS"] == "selecta-production-originals"
    assert production["SELECTA_EMAIL_PROVIDER"] == "resend"
    assert production["SELECTA_EMAIL_FROM"] == "SelectaDJ <mail@selectadj.app>"
    generated = {item.name for item in setup_cloud.SETTINGS if item.generated}
    assert generated <= staging.keys()
    assert generated <= production.keys()


def test_stripe_test_catalog_matches_the_accepted_adr_prices():
    assert setup_cloud.STRIPE_TEST_CATALOG["standard"]["prices"] == {
        "month": 699,
        "year": 5900,
    }
    assert setup_cloud.STRIPE_TEST_CATALOG["premium"]["prices"] == {
        "month": 1299,
        "year": 10900,
    }


def test_stripe_business_catalog_matches_the_accepted_adr_prices():
    assert setup_cloud.STRIPE_BUSINESS_TEST_CATALOG["business_venue"]["prices"] == {
        "month": 7900,
        "year": 79000,
    }
    assert setup_cloud.STRIPE_BUSINESS_TEST_CATALOG["business_extra_zone"]["prices"] == {
        "month": 2500,
        "year": 25000,
    }
    assert setup_cloud.STRIPE_BUSINESS_TEST_CATALOG["business_extra_seat"]["prices"] == {
        "month": 500,
        "year": 5000,
    }
    assert len(setup_cloud.STRIPE_REQUIRED_WEBHOOK_EVENTS) == 12


def test_checklist_hides_configured_names_by_default(capsys):
    setup_cloud.checklist("staging", {"ANTHROPIC_API_KEY": "never print me"})
    output = capsys.readouterr().out
    assert "ANTHROPIC_API_KEY" not in output
    assert "never print me" not in output
    assert "Get it from:" in output
